/**
 * Remote exposure of the `ctx.git` capability seam as the `gitRemote` Typert
 * Remote namespace for the Web Client: every request carries the session id —
 * this service resolves the workspace root from the live session, so the
 * panel always means the session's own repository — and every answer is a
 * discriminated result (`ok` carries the wire view, `false` carries the
 * panel-renderable error, with `denied` when the standing sandbox policy
 * blocked a mutation). A Remote call never rejects.
 *
 * @module @dsh-custom/dsh-git-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { GitError } from '@dsh-custom/dsh-git'
import type {} from '@dsh-custom/dsh-git'
import type {
  GitBranchListResult, GitCommitResult, GitDiffResult, GitLogResult, GitPushResult,
  GitStageResult, GitStatusSummary,
} from '@dsh-custom/dsh-git'
import type {
  GitRemoteBranchListView, GitRemoteCommitRequest, GitRemoteCommitView, GitRemoteDiffRequest,
  GitRemoteDiffView, GitRemoteLogRequest, GitRemoteLogView, GitRemotePushRequest,
  GitRemotePushView, GitRemoteResult, GitRemoteSessionRequest, GitRemoteStageRequest,
  GitRemoteStageView, GitRemoteStatusView,
} from './types.ts'

export type {
  GitRemoteBranch, GitRemoteBranchListView, GitRemoteCommitRequest, GitRemoteCommitView,
  GitRemoteDiffRequest, GitRemoteDiffView, GitRemoteLogEntry, GitRemoteLogRequest,
  GitRemoteLogView, GitRemotePushRequest, GitRemotePushView, GitRemoteResult,
  GitRemoteSessionRequest, GitRemoteStageRequest, GitRemoteStageView, GitRemoteStatusEntry,
  GitRemoteStatusView,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    gitRemote: GitRemoteService
  }
}

/**
 * Run one seam call and project it onto the wire result: a `GitError`
 * becomes the failure the panel renders (with `denied` for policy blocks),
 * any other throw becomes an honest infrastructure failure message.
 * @param body - one seam call returning the wire view.
 */
async function answer<T>(body: () => Promise<T>): Promise<GitRemoteResult<T>> {
  try {
    return { ok: true, value: await body() }
  } catch (error) {
    if (error instanceof GitError) {
      return {
        ok: false,
        error: error.message,
        ...error.denied ? { denied: true } : {},
      }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Project one status summary onto its wire view. */
function statusView(summary: GitStatusSummary): GitRemoteStatusView {
  return {
    root: summary.root,
    ahead: summary.ahead,
    behind: summary.behind,
    initial: summary.initial,
    detached: summary.detached,
    ...summary.branch !== undefined ? { branch: summary.branch } : {},
    ...summary.upstream !== undefined ? { upstream: summary.upstream } : {},
    entries: summary.entries.map(entry => ({
      code: entry.code,
      path: entry.path,
      staged: entry.staged,
      unstaged: entry.unstaged,
      untracked: entry.untracked,
      ...entry.originPath !== undefined ? { originPath: entry.originPath } : {},
    })),
  }
}

/** Project one diff result onto its wire view. */
function diffView(result: GitDiffResult): GitRemoteDiffView {
  return {
    staged: result.staged,
    patch: result.patch,
    truncated: result.truncated,
    ...result.path !== undefined ? { path: result.path } : {},
  }
}

/** Project one log result onto its wire view. */
function logView(result: GitLogResult): GitRemoteLogView {
  return { entries: result.entries.map(entry => ({ ...entry })) }
}

/** Project one branch list onto its wire view. */
function branchesView(result: GitBranchListResult): GitRemoteBranchListView {
  return {
    branches: result.branches.map(branch => ({
      name: branch.name,
      current: branch.current,
      shortHash: branch.shortHash,
      ...branch.upstream !== undefined ? { upstream: branch.upstream } : {},
    })),
  }
}

/** Project one staging result onto its wire view. */
function stageView(result: GitStageResult): GitRemoteStageView {
  return { stagedPaths: result.stagedPaths.map(path => path) }
}

export class GitRemoteService extends TypertRemoteService {
  static inject = ['sessions', 'git']

  constructor(ctx: Context) {
    super(ctx, 'gitRemote')
  }

  /**
   * Resolve the workspace directory of one live session.
   * @param sessionId - the session whose repository the call addresses.
   * @returns the cwd, or the ready-made failure answer when the session is
   * unknown or carries no cwd.
   */
  private resolve(sessionId: SessionId): { cwd: string } | { failure: { ok: false; error: string } } {
    const session = this.ctx.sessions.get(sessionId)
    const cwd = session?.header.cwd
    if (cwd === undefined || cwd === '') {
      return { failure: { ok: false, error: `session ${String(sessionId)} has no workspace directory` } }
    }
    return { cwd }
  }

  /**
   * `gitRemote.status`: the session repository's working-tree status.
   * @param request - the session whose repository to read.
   * @returns the status view, or the failure the panel renders.
   */
  @Remote('status')
  async status(request: GitRemoteSessionRequest): Promise<GitRemoteResult<GitRemoteStatusView>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    return await answer(async () => statusView(await this.ctx.git.status(cwd)))
  }

  /**
   * `gitRemote.diff`: one unified diff of the session repository.
   * @param request - the session, staged/work-tree selection, and optional path filter.
   * @returns the patch view, or the failure the panel renders.
   */
  @Remote('diff')
  async diff(request: GitRemoteDiffRequest): Promise<GitRemoteResult<GitRemoteDiffView>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    return await answer(async () => diffView(await this.ctx.git.diff(cwd, {
      staged: request.staged === true,
      ...request.path !== undefined && request.path !== '' ? { path: request.path } : {},
    })))
  }

  /**
   * `gitRemote.log`: the session repository's commit list.
   * @param request - the session, count bound, optional revision and path filter.
   * @returns the commit list view, or the failure the panel renders.
   */
  @Remote('log')
  async log(request: GitRemoteLogRequest): Promise<GitRemoteResult<GitRemoteLogView>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    return await answer(async () => logView(await this.ctx.git.log(cwd, {
      ...request.maxCount !== undefined ? { maxCount: request.maxCount } : {},
      ...request.ref !== undefined && request.ref !== '' ? { ref: request.ref } : {},
      ...request.path !== undefined && request.path !== '' ? { path: request.path } : {},
    })))
  }

  /**
   * `gitRemote.branches`: the session repository's local branches.
   * @param request - the session whose repository to read.
   * @returns the branch list view, or the failure the panel renders.
   */
  @Remote('branches')
  async branches(request: GitRemoteSessionRequest): Promise<GitRemoteResult<GitRemoteBranchListView>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    return await answer(async () => branchesView(await this.ctx.git.branches(cwd)))
  }

  /**
   * `gitRemote.stage`: stage work-tree changes into the index.
   * @param request - the session and the paths (or the whole work tree).
   * @returns the cumulative staged paths, or the failure the panel renders.
   */
  @Remote('stage')
  async stage(request: GitRemoteStageRequest): Promise<GitRemoteResult<GitRemoteStageView>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    return await answer(async () => stageView(await this.ctx.git.stage(cwd, {
      ...request.paths !== undefined && request.paths.length > 0 ? { paths: request.paths } : {},
      ...request.all === true ? { all: true } : {},
    })))
  }

  /**
   * `gitRemote.unstage`: return index entries to HEAD.
   * @param request - the session and the paths (or the whole index).
   * @returns the cumulative staged paths, or the failure the panel renders.
   */
  @Remote('unstage')
  async unstage(request: GitRemoteStageRequest): Promise<GitRemoteResult<GitRemoteStageView>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    return await answer(async () => stageView(await this.ctx.git.unstage(cwd, {
      ...request.paths !== undefined && request.paths.length > 0 ? { paths: request.paths } : {},
      ...request.all === true ? { all: true } : {},
    })))
  }

  /**
   * `gitRemote.commit`: create one commit from the staged index.
   * @param request - the session and the commit message.
   * @returns the created commit's identity, or the failure the panel renders.
   */
  @Remote('commit')
  async commit(request: GitRemoteCommitRequest): Promise<GitRemoteResult<GitRemoteCommitView>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    return await answer(async () => {
      const result: GitCommitResult = await this.ctx.git.commit(cwd, { message: request.message })
      return { hash: result.hash, shortHash: result.shortHash, subject: result.subject }
    })
  }

  /**
   * `gitRemote.push`: push the current branch to its upstream or an explicit remote.
   * @param request - the session, optional remote/branch, and upstream setup.
   * @returns the push target echo, or the failure the panel renders.
   */
  @Remote('push')
  async push(request: GitRemotePushRequest): Promise<GitRemoteResult<GitRemotePushView>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    return await answer(async () => {
      const result: GitPushResult = await this.ctx.git.push(cwd, {
        ...request.remote !== undefined && request.remote !== '' ? { remote: request.remote } : {},
        ...request.branch !== undefined && request.branch !== '' ? { branch: request.branch } : {},
        ...request.setUpstream === true ? { setUpstream: true } : {},
      })
      return { remote: result.remote, branch: result.branch, setUpstream: result.setUpstream }
    })
  }
}

export default GitRemoteService
