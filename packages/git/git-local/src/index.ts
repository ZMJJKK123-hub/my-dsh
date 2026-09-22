/**
 * Local Service Provider for the git capability seam over the subprocess
 * seam: read-only git facts (root/status/diff/log/branches) from the git
 * executable on this host's PATH. Every command runs argv-direct through
 * `ctx.subprocess` — never through a shell — and is confined by
 * `ctx.sandbox` under the standing policy resolved from `ctx.sandboxPolicy`
 * (falling back to unconfined only when the host mounted no sandbox or the
 * standing mode is full access). Write operations (stage/commit/push) do not
 * belong here; a later seam owns them.
 *
 * @module @dsh-custom/dsh-git-local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subprocess'
import { GitError, GitService } from '@dsh-custom/dsh-git'
import type { GitDiffOptions, GitLogOptions } from '@dsh-custom/dsh-git'
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
}

type ResolvedConfig = Required<Config>

const BRANCHES_FORMAT = '%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)'
const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e'

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
   * @param cwd - the repository directory this call reads.
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
}

export default LocalGitService
