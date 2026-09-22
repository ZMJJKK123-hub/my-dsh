/**
 * Types of the `ctx.git` capability seam. This package is the Service
 * Definition only: it declares what repository facts a provider must supply
 * and never runs git itself. The local provider lives in
 * `@dsh-custom/dsh-git-local`; model-facing tools and UI panels consume this
 * interface so a future remote-provider swap needs no consumer changes.
 *
 * @module @dsh-custom/dsh-git
 */

/** One working-tree/index entry reported by `git status`. */
export interface GitStatusEntry {
  /** Two-character porcelain v1 code, e.g. `'M '`, `' M'`, `'??'`. */
  readonly code: string
  /** Repository-relative path of the entry's current name. */
  readonly path: string
  /** Repository-relative original path for renames/copies, when the code carries one. */
  readonly originPath: string | undefined
  /** True when the index differs from HEAD for this entry. */
  readonly staged: boolean
  /** True when the work tree differs from the index for this entry. */
  readonly unstaged: boolean
  /** True for untracked files (`??`). */
  readonly untracked: boolean
}

/** Branch-level facts plus the full entry list of one `git status` run. */
export interface GitStatusSummary {
  /** Absolute repository root as git reports it (`rev-parse --show-toplevel`). */
  readonly root: string
  /** Current branch name; undefined when HEAD is detached. */
  readonly branch: string | undefined
  /** Tracking branch short name (`origin/main`); undefined when none or gone. */
  readonly upstream: string | undefined
  /** Commits on the current branch not on the upstream. */
  readonly ahead: number
  /** Commits on the upstream not on the current branch. */
  readonly behind: number
  /** True when the current branch has no commits yet. */
  readonly initial: boolean
  /** True when HEAD is detached. */
  readonly detached: boolean
  /** All reported entries, in git's order. */
  readonly entries: readonly GitStatusEntry[]
}

/** Options of {@link GitService.diff}. */
export interface GitDiffOptions {
  /** Compare the index against HEAD instead of the work tree against the index. */
  readonly staged?: boolean | undefined
  /** Limit the diff to one repository-relative path. */
  readonly path?: string | undefined
  /** Cap the returned patch text in bytes; excess is dropped from the head with {@link GitDiffResult.truncated} set. */
  readonly maxBytes?: number | undefined
}

/** Patch text of one `git diff` run. */
export interface GitDiffResult {
  /** Whether this diff compared the index against HEAD. */
  readonly staged: boolean
  /** The path filter that produced this diff, when one was given. */
  readonly path: string | undefined
  /** Unified diff patch text (possibly truncated). */
  readonly patch: string
  /** True when the patch exceeded the byte cap and only the tail was kept. */
  readonly truncated: boolean
}

/** Options of {@link GitService.log}. */
export interface GitLogOptions {
  /** Maximum commits returned; the provider caps this at its own bound. */
  readonly maxCount?: number | undefined
  /** Starting revision (default `HEAD`). */
  readonly ref?: string | undefined
  /** Limit history to one repository-relative path. */
  readonly path?: string | undefined
}

/** One commit of {@link GitService.log}. */
export interface GitLogEntry {
  /** Full commit hash. */
  readonly hash: string
  /** Abbreviated commit hash. */
  readonly shortHash: string
  /** Author name. */
  readonly author: string
  /** Author date in ISO 8601. */
  readonly date: string
  /** Commit subject line. */
  readonly subject: string
}

/** Commit list of one `git log` run. */
export interface GitLogResult {
  readonly entries: readonly GitLogEntry[]
}

/** One local branch reported by {@link GitService.branches}. */
export interface GitBranch {
  /** Short branch name. */
  readonly name: string
  /** True when HEAD points at this branch. */
  readonly current: boolean
  /** Tracking branch short name, when configured. */
  readonly upstream: string | undefined
  /** Abbreviated hash of the branch tip. */
  readonly shortHash: string
}

/** Local branch list of one run. */
export interface GitBranchListResult {
  readonly branches: readonly GitBranch[]
}

/**
 * A git command failed. Carries the raw exit code and stderr so consumers can
 * surface the honest cause; `denied` marks a run the sandbox blocked before
 * git could finish, which is policy working, not a git error.
 */
export class GitError extends Error {
  /** git's exit code, or null when the process died from a signal. */
  readonly exitCode: number | null
  /** git's stderr text (possibly truncated by the output cap). */
  readonly stderr: string
  /** True when a sandbox denial, not a git failure, produced this error. */
  readonly denied: boolean

  constructor(message: string, exitCode: number | null, stderr: string, denied = false) {
    super(message)
    this.name = 'GitError'
    this.exitCode = exitCode
    this.stderr = stderr
    this.denied = denied
  }
}
