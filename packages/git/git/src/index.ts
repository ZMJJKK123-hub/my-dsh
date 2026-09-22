/**
 * Service Definition for the `ctx.git` capability seam: read-only repository
 * facts (status, diff, log, branches) shared by model-facing tools and UI
 * panels. All methods take the repository directory per call — the caller
 * resolves the session workspace — and never write to the repository.
 *
 * @module @dsh-custom/dsh-git
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  GitBranchListResult, GitDiffOptions, GitDiffResult, GitLogOptions, GitLogResult,
  GitStatusSummary,
} from './types.ts'

export { GitError } from './types.ts'
export type {
  GitBranch, GitBranchListResult, GitDiffOptions, GitDiffResult, GitLogEntry, GitLogOptions,
  GitLogResult, GitStatusEntry, GitStatusSummary,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    git: GitService
  }
}

/**
 * Abstract git repository reader. Subclass, implement the abstract methods,
 * and load the subclass as a plugin — it registers as `ctx.git` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - Every method reads; none of them creates commits, touches the index, or
 *   changes HEAD. A provider that adds writes belongs on a separate seam.
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
   */
  abstract resolveRoot(cwd: string, signal?: AbortSignal): Promise<string | undefined>

  /**
   * Working-tree and index status of the repository containing `cwd`.
   * @param cwd - any directory inside the repository.
   * @param signal - aborts the run.
   * @throws {@link GitError} when `cwd` is not inside a repository.
   */
  abstract status(cwd: string, signal?: AbortSignal): Promise<GitStatusSummary>

  /**
   * Unified diff patch of the repository containing `cwd`.
   * @param cwd - any directory inside the repository.
   * @param options - staged/worktree selection, optional path filter, byte cap.
   * @param signal - aborts the run.
   * @throws {@link GitError} when git fails.
   */
  abstract diff(cwd: string, options?: GitDiffOptions, signal?: AbortSignal): Promise<GitDiffResult>

  /**
   * Commit history of the repository containing `cwd`; an unborn branch
   * resolves with an empty entry list.
   * @param cwd - any directory inside the repository.
   * @param options - count bound, optional starting revision and path filter.
   * @param signal - aborts the run.
   * @throws {@link GitError} when git fails for a reason other than an unborn branch.
   */
  abstract log(cwd: string, options?: GitLogOptions, signal?: AbortSignal): Promise<GitLogResult>

  /**
   * Local branches of the repository containing `cwd`.
   * @param cwd - any directory inside the repository.
   * @param signal - aborts the run.
   * @throws {@link GitError} when git fails.
   */
  abstract branches(cwd: string, signal?: AbortSignal): Promise<GitBranchListResult>
}

export default GitService
