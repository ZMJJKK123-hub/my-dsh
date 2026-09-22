/**
 * Local Service Provider for the git capability seam over the subprocess
 * seam: repository facts (root/status/diff/log/branches) and index/commit/push
 * mutations from the git executable on this host's PATH. Every command runs
 * argv-direct through `ctx.subprocess` — never through a shell — and is
 * confined by `ctx.sandbox` under the standing policy resolved from
 * `ctx.sandboxPolicy` (falling back to unconfined only when the host mounted
 * no sandbox or the standing mode is full access). Mutations run at the
 * repository root with the repository as the writable root, so a read-only
 * standing policy denies them honestly.
 *
 * @module @dsh-custom/dsh-git-local
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subprocess'
import { GitError, GitService } from '@dsh-custom/dsh-git'
import type {
  GitCheckpoint, GitCheckpointCreateOptions, GitCheckpointListResult,
  GitCheckpointRestoreOptions, GitCheckpointRestoreResult, GitCommitOptions, GitCommitResult,
  GitDiffOptions, GitLogOptions, GitPushOptions, GitPushResult, GitStageResult,
  GitStageSelection,
} from '@dsh-custom/dsh-git'
import { parseBranches, parseLog, parseStatusZ } from './parse.ts'
import { runGitCommand, type GitRunResult } from './run.ts'

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Git executable: absolute path or bare PATH name. */
  gitBinary?: string
  /** Per-command deadline in milliseconds. */
  timeoutMs?: number
  /** Default cap of `diff` patch text in bytes. */
  maxDiffBytes?: number
  /** Upper bound of commits one `log` call may return. */
  maxLogCount?: number
  /** Per-stream in-memory collection cap for non-diff commands, in bytes. */
  maxOutputBytes?: number
  /** Grace period handed to the subprocess termination procedure. */
  graceMs?: number
  /** Confine commands under the standing sandbox policy; false runs everything unconfined. */
  confine?: boolean
  /** Checkpoints kept per series; creating prunes beyond this bound. */
  checkpointKeepLast?: number
}

type ResolvedConfig = Required<Config>

const BRANCHES_FORMAT = '%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)'
const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e'

/** Ref namespace every checkpoint lives under; HEAD, branches, and the user's index stay untouched. */
const CHECKPOINT_REF_PREFIX = 'refs/dsh/checkpoints'

/** Fixed synthetic identity for shadow commits: they are host artifacts, not user commits. */
const CHECKPOINT_AUTHOR = 'dsh-checkpoint'
const CHECKPOINT_EMAIL = 'dsh-checkpoint@local'

/** Sanitize a series key into a refname-safe segment. */
function checkpointSeries(series: string): string {
  return series.replace(/[^A-Za-z0-9._-]+/g, '-')
}

/** The ref one checkpoint lives at; the zero-padded ordinal keeps refname order numeric. */
function checkpointRef(series: string, index: number): string {
  return `${CHECKPOINT_REF_PREFIX}/${series}/${String(index).padStart(6, '0')}`
}

/**
 * Throw the honest failure for one finished-but-unsuccessful run.
 * @param what - the git subcommand name, for the message.
 * @param result - the run outcome.
 */
function failRun(what: string, result: GitRunResult): never {
  if (result.denied) {
    throw new GitError(`git ${what} was blocked by the sandbox policy`, result.exitCode, result.stderr, true)
  }
  if (result.timedOut) {
    throw new GitError(`git ${what} timed out`, result.exitCode, result.stderr)
  }
  const detail = result.stderr.trim() !== '' ? result.stderr.trim() : `exit code ${result.exitCode ?? 'null'}`
  throw new GitError(`git ${what} failed: ${detail}`, result.exitCode, result.stderr)
}

export class LocalGitService extends GitService {
  static inject = ['subprocess']
  static Config: z<Config> = z.object({
    gitBinary: z.string().default('git'),
    timeoutMs: z.number().default(30_000),
    maxDiffBytes: z.number().default(262_144),
    maxLogCount: z.number().default(100),
    maxOutputBytes: z.number().default(65_536),
    graceMs: z.number().default(2_500),
    confine: z.boolean().default(true),
    checkpointKeepLast: z.number().default(50),
  })

  readonly resolvedConfig: ResolvedConfig
  gitPathCache: string | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // ctx.plugin validates through static Config, so every defaulted field is present.
    this.resolvedConfig = config as ResolvedConfig
  }

  /**
   * Resolve the git executable once per service lifetime.
   * @param signal - aborts the lookup.
   */
  private async executable(signal?: AbortSignal): Promise<string> {
    this.gitPathCache ??= await this.ctx.subprocess.resolveExecutable(this.resolvedConfig.gitBinary, undefined, signal)
    return this.gitPathCache
  }

  /**
   * Confinement for one call: the standing policy's mode with the call's own
   * repository as the writable root, skipped when disabled, unmounted, or the
   * standing mode is full access.
   * @param cwd - the repository directory this call reads or writes.
   */
  private confinement(cwd: string): { provider: SandboxProvider; policy: SandboxPolicy } | undefined {
    if (!this.resolvedConfig.confine) return undefined
    const provider = this.ctx.get('sandbox')
    const policyService = this.ctx.get('sandboxPolicy')
    if (provider === undefined || policyService === undefined) return undefined
    const standing = policyService.resolve()
    if (standing.mode === 'danger-full-access') return undefined
    return {
      provider,
      policy: {
        mode: standing.mode,
        workspaceRoot: cwd,
        ...standing.sessionId !== undefined ? { sessionId: standing.sessionId } : {},
      },
    }
  }

  /**
   * Run one read-only git command with opportunistic locking disabled, so
   * read commands take no index locks and survive read-only confinement.
   */
  private async read(cwd: string, argv: readonly string[], maxOutputBytes: number, signal?: AbortSignal): Promise<GitRunResult> {
    const gitPath = await this.executable(signal)
    return runGitCommand(this.ctx, gitPath, {
      argv: ['-c', 'core.quotepath=false', ...argv],
      cwd,
      timeoutMs: this.resolvedConfig.timeoutMs,
      maxOutputBytes,
      graceMs: this.resolvedConfig.graceMs,
      signal,
      env: { GIT_OPTIONAL_LOCKS: '0' },
      sandbox: this.confinement(cwd),
    })
  }

  override async resolveRoot(cwd: string, signal?: AbortSignal): Promise<string | undefined> {
    const result = await this.read(cwd, ['rev-parse', '--show-toplevel'], this.resolvedConfig.maxOutputBytes, signal)
    if (result.exitCode !== 0 || result.timedOut || result.aborted) return undefined
    const root = result.stdout.trim()
    return root === '' ? undefined : root
  }

  override async status(cwd: string, signal?: AbortSignal) {
    const root = await this.resolveRoot(cwd, signal)
    if (root === undefined) throw new GitError(`not a git repository: ${cwd}`, 128, '')
    const result = await this.read(
      root,
      ['status', '--porcelain=v1', '-z', '--branch'],
      this.resolvedConfig.maxOutputBytes,
      signal,
    )
    if (result.exitCode !== 0 || result.timedOut || result.aborted) failRun('status', result)
    return { ...parseStatusZ(result.stdout), root }
  }

  override async diff(cwd: string, options?: GitDiffOptions, signal?: AbortSignal) {
    const staged = options?.staged === true
    const path = options?.path === '' ? undefined : options?.path
    const maxBytes = options?.maxBytes ?? this.resolvedConfig.maxDiffBytes
    const result = await this.read(
      cwd,
      ['diff', '--no-color', ...staged ? ['--cached'] : [], ...path !== undefined ? ['--', path] : []],
      Math.max(maxBytes, 4_096),
      signal,
    )
    if (result.exitCode !== 0 || result.timedOut || result.aborted) failRun('diff', result)
    return { staged, path, patch: result.stdout, truncated: result.truncated }
  }

  override async log(cwd: string, options?: GitLogOptions, signal?: AbortSignal) {
    const maxCount = Math.min(options?.maxCount ?? this.resolvedConfig.maxLogCount, this.resolvedConfig.maxLogCount)
    const ref = options?.ref === '' ? undefined : options?.ref
    const path = options?.path === '' ? undefined : options?.path
    const result = await this.read(
      cwd,
      [
        'log', '--no-color', '--max-count', String(maxCount), `--format=${LOG_FORMAT}`,
        ...ref !== undefined ? [ref] : [], ...path !== undefined ? ['--', path] : [],
      ],
      this.resolvedConfig.maxOutputBytes,
      signal,
    )
    // An unborn branch has no history to list — everything else is a failure.
    if (result.exitCode !== 0 && result.stderr.includes('does not have any commits yet')) {
      return { entries: [] }
    }
    if (result.exitCode !== 0 || result.timedOut || result.aborted) failRun('log', result)
    return { entries: parseLog(result.stdout) }
  }

  override async branches(cwd: string, signal?: AbortSignal) {
    const result = await this.read(
      cwd,
      ['for-each-ref', `--format=${BRANCHES_FORMAT}`, 'refs/heads'],
      this.resolvedConfig.maxOutputBytes,
      signal,
    )
    if (result.exitCode !== 0 || result.timedOut || result.aborted) failRun('for-each-ref', result)
    return { branches: parseBranches(result.stdout) }
  }

  /**
   * Run one repository-mutating git command at the repository root: the same
   * standing-policy confinement as reads, with the repository itself as the
   * writable root, so a read-only policy denies the mutation honestly while
   * a workspace-write policy confines writes to the repository.
   */
  private async write(cwd: string, argv: readonly string[], signal?: AbortSignal): Promise<void> {
    await this.runEnv(cwd, argv, {}, signal)
  }

  /**
   * Run one confined git command with explicit environment entries (the
   * checkpoint plumbing's temp index and synthetic identity) and return its
   * output; a nonzero exit is the same honest failure as {@link write}.
   */
  private async runEnv(
    cwd: string,
    argv: readonly string[],
    env: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<GitRunResult> {
    const gitPath = await this.executable(signal)
    const result = await runGitCommand(this.ctx, gitPath, {
      argv: ['-c', 'core.quotepath=false', ...argv],
      cwd,
      timeoutMs: this.resolvedConfig.timeoutMs,
      maxOutputBytes: this.resolvedConfig.maxOutputBytes,
      graceMs: this.resolvedConfig.graceMs,
      signal,
      env,
      sandbox: this.confinement(cwd),
    })
    if (result.exitCode !== 0 || result.timedOut || result.aborted) failRun(argv[0] ?? 'git', result)
    return result
  }

  /** The cumulative staged path list after a staging mutation. */
  private async stagedPaths(cwd: string, signal?: AbortSignal): Promise<readonly string[]> {
    const result = await this.read(
      cwd,
      ['diff', '--cached', '--name-only', '-z'],
      this.resolvedConfig.maxOutputBytes,
      signal,
    )
    if (result.exitCode !== 0 || result.timedOut || result.aborted) failRun('diff', result)
    return result.stdout.split('\0').filter(path => path !== '')
  }

  /** Build the argv of one stage/unstage pass: explicit paths, or the whole work tree. */
  private static stageArgv(verb: 'add' | 'unstage', options?: GitStageSelection): readonly string[] {
    const all = options?.all === true
    const paths = options?.paths?.filter(path => path.trim() !== '') ?? []
    if (!all && paths.length === 0) {
      throw new GitError(`git ${verb} requires non-empty paths or all: true`, null, '')
    }
    if (verb === 'add') return all ? ['add', '--all'] : ['add', '--', ...paths]
    return all ? ['reset', '--quiet'] : ['restore', '--staged', '--', ...paths]
  }

  override async stage(cwd: string, options?: GitStageSelection, signal?: AbortSignal): Promise<GitStageResult> {
    await this.write(cwd, LocalGitService.stageArgv('add', options), signal)
    return { stagedPaths: await this.stagedPaths(cwd, signal) }
  }

  override async unstage(cwd: string, options?: GitStageSelection, signal?: AbortSignal): Promise<GitStageResult> {
    await this.write(cwd, LocalGitService.stageArgv('unstage', options), signal)
    return { stagedPaths: await this.stagedPaths(cwd, signal) }
  }

  override async commit(cwd: string, options: GitCommitOptions, signal?: AbortSignal): Promise<GitCommitResult> {
    const message = options.message.trim()
    if (message === '') {
      throw new GitError('git commit requires a non-empty message', null, '')
    }
    await this.write(cwd, ['commit', '-m', message], signal)
    const result = await this.read(
      cwd,
      ['log', '--max-count', '1', `--format=${LOG_FORMAT}`],
      this.resolvedConfig.maxOutputBytes,
      signal,
    )
    if (result.exitCode !== 0 || result.timedOut || result.aborted) failRun('log', result)
    const entry = parseLog(result.stdout)[0]
    if (entry === undefined) throw new GitError('git commit succeeded but the new commit is not readable', null, '')
    return { hash: entry.hash, shortHash: entry.shortHash, subject: entry.subject }
  }

  override async push(cwd: string, options?: GitPushOptions, signal?: AbortSignal): Promise<GitPushResult> {
    const setUpstream = options?.setUpstream === true
    const remote = options?.remote === '' ? undefined : options?.remote
    const branch = options?.branch === '' ? undefined : options?.branch
    const summary = await this.status(cwd, signal)
    const argv: string[] = ['push', ...setUpstream ? ['--set-upstream'] : []]
    if (remote !== undefined) {
      const effectiveBranch = branch ?? summary.branch
      if (effectiveBranch === undefined) {
        throw new GitError('git push with an explicit remote needs a branch name on a detached HEAD', null, '')
      }
      argv.push(remote, effectiveBranch)
    }
    await this.write(cwd, argv, signal)
    return {
      remote: remote ?? (summary.upstream !== undefined ? summary.upstream.split('/')[0] ?? 'origin' : 'origin'),
      branch: branch ?? summary.branch ?? 'HEAD',
      setUpstream,
    }
  }

  /** Read one series' checkpoints, newest (highest ordinal) first. */
  private async checkpointList(cwd: string, series: string, signal?: AbortSignal): Promise<readonly GitCheckpoint[]> {
    const root = await this.resolveRoot(cwd, signal)
    if (root === undefined) throw new GitError(`not a git repository: ${cwd}`, 128, '')
    const format = '%(refname)%00%(objectname)%00%(objectname:short)%00%(committerdate:iso8601-strict)%00%(contents:subject)'
    const result = await this.read(
      root,
      ['for-each-ref', '--sort=-refname', `--format=${format}`, `${CHECKPOINT_REF_PREFIX}/${series}`],
      this.resolvedConfig.maxOutputBytes,
      signal,
    )
    if (result.exitCode !== 0 || result.timedOut || result.aborted) failRun('for-each-ref', result)
    const checkpoints: GitCheckpoint[] = []
    for (const line of result.stdout.split('\n')) {
      if (line === '') continue
      const [ref, hash, shortHash, date, subject] = line.split('\0')
      const ordinal = ref?.split('/').at(-1)
      if (hash === undefined || shortHash === undefined || date === undefined || ordinal === undefined) continue
      checkpoints.push({ series, index: Number(ordinal), hash, shortHash, label: subject ?? '', date })
    }
    return checkpoints
  }

  /** Prune the series to the configured keep-last bound, oldest first. */
  private async pruneCheckpoints(root: string, series: string, signal?: AbortSignal): Promise<void> {
    const listed = await this.checkpointList(root, series, signal)
    for (const checkpoint of listed.slice(this.resolvedConfig.checkpointKeepLast)) {
      await this.runEnv(root, ['update-ref', '-d', checkpointRef(series, checkpoint.index)], {}, signal)
    }
  }

  override async checkpointCreate(
    cwd: string,
    options: GitCheckpointCreateOptions,
    signal?: AbortSignal,
  ): Promise<GitCheckpoint> {
    const series = checkpointSeries(options.series)
    if (options.series.trim() === '' || !/^[A-Za-z0-9._-]+$/.test(series)) {
      throw new GitError(`invalid checkpoint series "${options.series}"`, null, '')
    }
    const label = options.label.trim() === '' ? `checkpoint ${options.index}` : options.label
    const root = await this.resolveRoot(cwd, signal)
    if (root === undefined) throw new GitError(`not a git repository: ${cwd}`, 128, '')
    const scratch = await mkdtemp(join(tmpdir(), 'dsh-git-cp-'))
    try {
      // The temp index captures the whole work tree as it stands — untracked
      // files included, ignored files excluded by git's own rules.
      const env = {
        GIT_INDEX_FILE: join(scratch, 'index'),
        GIT_AUTHOR_NAME: CHECKPOINT_AUTHOR,
        GIT_AUTHOR_EMAIL: CHECKPOINT_EMAIL,
        GIT_COMMITTER_NAME: CHECKPOINT_AUTHOR,
        GIT_COMMITTER_EMAIL: CHECKPOINT_EMAIL,
      }
      await this.runEnv(root, ['add', '--all'], env, signal)
      const tree = (await this.runEnv(root, ['write-tree'], env, signal)).stdout.trim()
      if (tree === '') throw new GitError('git write-tree produced no tree', null, '')
      const hash = (await this.runEnv(root, ['commit-tree', tree, '-m', label], env, signal)).stdout.trim()
      if (hash === '') throw new GitError('git commit-tree produced no commit', null, '')
      await this.runEnv(root, ['update-ref', checkpointRef(series, options.index), hash], {}, signal)
      const date = (await this.runEnv(root, ['show', '-s', '--format=%cI', hash], {}, signal)).stdout.trim()
      await this.pruneCheckpoints(root, series, signal)
      return { series, index: options.index, hash, shortHash: hash.slice(0, 7), label, date }
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  override async checkpoints(cwd: string, series: string, signal?: AbortSignal): Promise<GitCheckpointListResult> {
    return { checkpoints: await this.checkpointList(cwd, checkpointSeries(series), signal) }
  }

  override async checkpointRestore(
    cwd: string,
    options: GitCheckpointRestoreOptions,
    signal?: AbortSignal,
  ): Promise<GitCheckpointRestoreResult> {
    const series = checkpointSeries(options.series)
    const root = await this.resolveRoot(cwd, signal)
    if (root === undefined) throw new GitError(`not a git repository: ${cwd}`, 128, '')
    const ref = checkpointRef(series, options.index)
    const resolved = await this.read(root, ['rev-parse', ref], this.resolvedConfig.maxOutputBytes, signal)
    if (resolved.exitCode !== 0 || resolved.timedOut || resolved.aborted) failRun('rev-parse', resolved)
    const hash = resolved.stdout.trim()
    if (hash === '') throw new GitError(`checkpoint ${series}/${options.index} not found`, 128, '')

    // Explicit paths restore only those present in the captured tree; the
    // whole-tree restore covers everything the checkpoint tracked. Files
    // created after the checkpoint are never touched (restore is corrective,
    // not destructive).
    const paths = options.paths?.filter(path => path.trim() !== '') ?? []
    let restored: readonly string[] = []
    if (paths.length > 0) {
      const listed = await this.read(
        root,
        ['ls-tree', '-r', '--name-only', '-z', hash, '--', ...paths],
        this.resolvedConfig.maxOutputBytes,
        signal,
      )
      if (listed.exitCode !== 0 || listed.timedOut || listed.aborted) failRun('ls-tree', listed)
      restored = listed.stdout.split('\0').filter(path => path !== '')
    }
    if (paths.length === 0) {
      await this.write(root, ['restore', '--source', hash, '--worktree', '--', '.'], signal)
    } else if (restored.length > 0) {
      await this.write(root, ['restore', '--source', hash, '--worktree', '--', ...restored], signal)
    }
    const checkpoint = (await this.checkpointList(root, series, signal)).find(entry => entry.index === options.index)
      ?? { series, index: options.index, hash, shortHash: hash.slice(0, 7), label: '', date: '' }
    return { checkpoint, restored }
  }
}

export default LocalGitService
