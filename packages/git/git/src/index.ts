/**
 * Service Definition for the `ctx.git` capability seam: repository facts
 * (status, diff, log, branches) and index/commit/push mutations shared by
 * model-facing tools and UI panels. Read methods take the repository
 * directory per call — the caller resolves the session workspace — and never
 * write to the repository; write methods (stage, unstage, commit, push) run
 * under the caller's standing sandbox policy and deny honestly under a
 * read-only mode.
 *
 * @module @dsh-custom/dsh-git
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  GitBranchListResult, GitCheckpoint, GitCheckpointCreateOptions, GitCheckpointListResult,
  GitCheckpointRestoreOptions, GitCheckpointRestoreResult, GitCommitOptions, GitCommitResult,
  GitDiffOptions, GitDiffResult, GitLogOptions, GitLogResult, GitPushOptions, GitPushResult,
  GitStageResult, GitStageSelection, GitStatusSummary,
} from './types.ts'

export { GitError } from './types.ts'
export type {
  GitBranch, GitBranchListResult, GitCheckpoint, GitCheckpointCreateOptions,
  GitCheckpointListResult, GitCheckpointRestoreOptions, GitCheckpointRestoreResult,
  GitCommitOptions, GitCommitResult, GitDiffOptions, GitDiffResult, GitLogEntry,
  GitLogOptions, GitLogResult, GitPushOptions, GitPushResult, GitStageResult,
  GitStageSelection, GitStatusEntry, GitStatusSummary,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    git: GitService
  }
}

/**
 * Abstract git repository service. Subclass, implement the abstract methods,
 * and load the subclass as a plugin — it registers as `ctx.git` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - The fact methods (root/status/diff/log/branches) only read; they create
 *   no commits, touch no index, and move no HEAD.
 * - The mutation methods (stage/unstage/commit/push) change the index, the
 *   commit graph, or the remote, and must enforce the caller's standing file
 *   policy: a read-only policy denies them with a {@link GitError} whose
 *   `denied` flag is set.
 * - Methods reject with {@link GitError} when git itself fails (nonzero exit,
 *   bad revision); infrastructure failures (spawn failure) reject with the
 *   underlying error. A directory outside any repository makes
 *   {@link GitService.resolveRoot} resolve `undefined` and the other methods
 *   reject with a {@link GitError}.
 */
export abstract class GitService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'git')
  }

  /**
   * Absolute path of the repository root containing `cwd`, or `undefined`
   * when the directory is not inside a git repository.
   * @param cwd - any directory inside the candidate repository.
   * @param signal - aborts the lookup.
   * @returns the absolute repository root, or `undefined` outside any repository.
   */
  abstract resolveRoot(cwd: string, signal?: AbortSignal): Promise<string | undefined>

  /**
   * Working-tree and index status of the repository containing `cwd`.
   * @param cwd - any directory inside the repository.
   * @param signal - aborts the run.
   * @returns the branch header facts and every reported entry.
   * @throws {@link GitError} when `cwd` is not inside a repository.
   */
  abstract status(cwd: string, signal?: AbortSignal): Promise<GitStatusSummary>

  /**
   * Unified diff patch of the repository containing `cwd`.
   * @param cwd - any directory inside the repository.
   * @param options - staged/worktree selection, optional path filter, byte cap.
   * @param signal - aborts the run.
   * @returns the unified diff patch, possibly truncated at the byte cap.
   * @throws {@link GitError} when git fails.
   */
  abstract diff(cwd: string, options?: GitDiffOptions, signal?: AbortSignal): Promise<GitDiffResult>

  /**
   * Commit history of the repository containing `cwd`; an unborn branch
   * resolves with an empty entry list.
   * @param cwd - any directory inside the repository.
   * @param options - count bound, optional starting revision and path filter.
   * @param signal - aborts the run.
   * @returns the commits, newest first; an empty list on an unborn branch.
   * @throws {@link GitError} when git fails for a reason other than an unborn branch.
   */
  abstract log(cwd: string, options?: GitLogOptions, signal?: AbortSignal): Promise<GitLogResult>

  /**
   * Local branches of the repository containing `cwd`.
   * @param cwd - any directory inside the repository.
   * @param signal - aborts the run.
   * @returns the local branches with the current branch marked.
   * @throws {@link GitError} when git fails.
   */
  abstract branches(cwd: string, signal?: AbortSignal): Promise<GitBranchListResult>

  /**
   * Stage work-tree changes (including untracked files) into the index.
   * @param cwd - any directory inside the repository.
   * @param options - explicit paths or the whole work tree.
   * @param signal - aborts the run.
   * @returns the cumulative staged paths after the operation.
   * @throws {@link GitError} when git fails or a read-only policy denies the write.
   */
  abstract stage(cwd: string, options?: GitStageSelection, signal?: AbortSignal): Promise<GitStageResult>

  /**
   * Unstage indexed changes back into the work tree (the index entry returns
   * to HEAD, the file content is untouched).
   * @param cwd - any directory inside the repository.
   * @param options - explicit paths or the whole index.
   * @param signal - aborts the run.
   * @returns the cumulative staged paths after the operation.
   * @throws {@link GitError} when git fails or a read-only policy denies the write.
   */
  abstract unstage(cwd: string, options?: GitStageSelection, signal?: AbortSignal): Promise<GitStageResult>

  /**
   * Create one commit from the staged index.
   * @param cwd - any directory inside the repository.
   * @param options - the commit message (non-empty; first line is the subject).
   * @param signal - aborts the run.
   * @returns the created commit's hash and subject.
   * @throws {@link GitError} when there is nothing staged, git fails, or a read-only policy denies the write.
   */
  abstract commit(cwd: string, options: GitCommitOptions, signal?: AbortSignal): Promise<GitCommitResult>

  /**
   * Push the current (or given) branch to a remote.
   * @param cwd - any directory inside the repository.
   * @param options - optional remote, branch, and upstream setup.
   * @param signal - aborts the run.
   * @returns the remote and branch the push targeted.
   * @throws {@link GitError} when there is no upstream, the remote rejects, or a policy denies the write.
   */
  abstract push(cwd: string, options?: GitPushOptions, signal?: AbortSignal): Promise<GitPushResult>

  /**
   * Create one shadow checkpoint: a parentless commit capturing the whole
   * work tree (untracked files included, ignored files excluded) under
   * `refs/dsh/checkpoints/<series>/<index>`, never touching HEAD or the
   * user's index. Creating prunes the series to the provider's keep-last bound.
   * @param cwd - any directory inside the repository.
   * @param options - series key, ordinal, and label.
   * @param signal - aborts the run.
   * @returns the created checkpoint.
   * @throws {@link GitError} when outside a repository or a policy denies the write.
   */
  abstract checkpointCreate(cwd: string, options: GitCheckpointCreateOptions, signal?: AbortSignal): Promise<GitCheckpoint>

  /**
   * List one series' checkpoints, newest (highest ordinal) first.
   * @param cwd - any directory inside the repository.
   * @param series - the sanitized series key.
   * @param signal - aborts the run.
   * @returns the checkpoints; an empty list for an unknown series.
   * @throws {@link GitError} when outside a repository or git fails.
   */
  abstract checkpoints(cwd: string, series: string, signal?: AbortSignal): Promise<GitCheckpointListResult>

  /**
   * Restore work-tree files from one checkpoint (`git restore --source`):
   * file contents return to the captured state, HEAD and the user's index
   * stay untouched, and files created after the checkpoint remain.
   * @param cwd - any directory inside the repository.
   * @param options - the checkpoint and optional explicit paths.
   * @param signal - aborts the run.
   * @returns the checkpoint and the explicit paths restored.
   * @throws {@link GitError} when the checkpoint is unknown or a policy denies the write.
   */
  abstract checkpointRestore(cwd: string, options: GitCheckpointRestoreOptions, signal?: AbortSignal): Promise<GitCheckpointRestoreResult>
}

export default GitService
