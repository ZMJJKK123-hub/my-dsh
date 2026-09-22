/**
 * Remote exposure of the `ctx.git` capability seam as the `gitRemote` Typert
 * Remote namespace for the Web Client: every request carries the session id —
 * this service resolves the workspace root from the live session, so the
 * panel always means the session's own repository — and every answer is a
 * discriminated result (`ok` carries the wire view, `false` carries the
 * panel-renderable error, with `denied` when the standing sandbox policy
 * blocked a mutation). A Remote call never rejects.
 *
 * `generateCommitMessage` adds one auxiliary model call: it frames the staged
 * diff, streams exactly one completion through `ctx.llm` under the configured
 * provider+model route, and normalizes the reply into commit-message text.
 * With no route configured it answers the honest not-configured failure.
 *
 * @module @dsh-custom/dsh-git-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
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
  GitRemoteBranchListView, GitRemoteCheckpointListView, GitRemoteCheckpointListRequest,
  GitRemoteCheckpointRestoreRequest, GitRemoteCommitRequest, GitRemoteCommitView,
  GitRemoteDiffRequest, GitRemoteDiffView, GitRemoteGeneratedMessageView, GitRemoteLogRequest,
  GitRemoteLogView, GitRemotePushRequest, GitRemotePushView, GitRemoteResult,
  GitRemoteSessionRequest, GitRemoteStageRequest, GitRemoteStageView, GitRemoteStatusView,
} from './types.ts'

export type {
  GitRemoteBranch, GitRemoteBranchListView, GitRemoteCheckpoint, GitRemoteCheckpointListView,
  GitRemoteCheckpointListRequest, GitRemoteCheckpointRestoreRequest, GitRemoteCommitRequest,
  GitRemoteCommitView, GitRemoteDiffRequest, GitRemoteDiffView, GitRemoteGeneratedMessageView,
  GitRemoteLogEntry, GitRemoteLogRequest, GitRemoteLogView, GitRemotePushRequest,
  GitRemotePushView, GitRemoteResult, GitRemoteSessionRequest, GitRemoteStageRequest,
  GitRemoteStageView, GitRemoteStatusEntry, GitRemoteStatusView,
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

/** System prompt for the auxiliary commit-message completion. */
const COMMIT_MESSAGE_SYSTEM = [
  'You write git commit messages.',
  'Reply with ONLY the commit message: one concise subject line (at most 72 characters, imperative mood, no trailing period),',
  'optionally followed by a blank line and a short body explaining what changed and why.',
  'No surrounding quotes, no markdown code fences, no commentary.',
].join(' ')

/** Cap of the normalized message the service ever returns. */
const MAX_MESSAGE_LENGTH = 1_000

/**
 * Normalize one model reply into commit-message text: strip code fences and
 * stray quoting, collapse blank runs, and cap the length.
 * @param text - the assembled model text.
 * @returns the normalized message.
 */
function normalizeCommitMessage(text: string): string {
  let message = text.trim()
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(message)
  if (fenced !== null) message = fenced[1]?.trim() ?? message
  message = message.replace(/^["'`]+|[`"']+$/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return message.slice(0, MAX_MESSAGE_LENGTH)
}

/**
 * Translate one terminal finish reason into the auxiliary-call failure.
 * @param finish - the assembled stream's terminal reason.
 * @returns the failure, or undefined for a clean stop.
 */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted':
      return new Error(finish.failure.message)
    case 'max-tokens':
      return new Error('git-remote: commit message reached maxOutputTokens')
    case 'tool-calls':
      return new Error('git-remote: commit message model unexpectedly requested a tool')
  }
}

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Provider route for commit-message generation; must be paired with `model`. */
  provider?: string
  /** Model id for commit-message generation; must be paired with `provider`. */
  model?: string
  /** Cap of the staged diff fed to the model, in bytes. */
  maxDiffBytes?: number
  /** Generation output-token cap. */
  maxOutputTokens?: number
  /** End-to-end generation deadline in milliseconds. */
  timeoutMs?: number
}

type ResolvedConfig = Required<Pick<Config, 'maxDiffBytes' | 'maxOutputTokens' | 'timeoutMs'>> & Config

export class GitRemoteService extends TypertRemoteService {
  static inject = ['sessions', 'git', 'llm']

  static Config: z<Config> = z.object({
    provider: z.string(),
    model: z.string(),
    maxDiffBytes: z.number().default(65_536),
    maxOutputTokens: z.number().default(128),
    timeoutMs: z.number().default(60_000),
  })

  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'gitRemote')
    this.config = {
      maxDiffBytes: config.maxDiffBytes ?? 65_536,
      maxOutputTokens: config.maxOutputTokens ?? 128,
      timeoutMs: config.timeoutMs ?? 60_000,
      ...config.provider !== undefined ? { provider: config.provider } : {},
      ...config.model !== undefined ? { model: config.model } : {},
    }
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

  /**
   * `gitRemote.generateCommitMessage`: one auxiliary model completion that
   * drafts the commit message from the staged diff. Requires the
   * provider+model route to be configured on this row; without it the answer
   * is the honest not-configured failure.
   * @param request - the session whose staged diff to frame.
   * @returns the drafted message, or the failure the panel renders.
   */
  @Remote('generateCommitMessage')
  async generateCommitMessage(request: GitRemoteSessionRequest): Promise<GitRemoteResult<GitRemoteGeneratedMessageView>> {
    const provider = this.config.provider
    const model = this.config.model
    if (provider === undefined || model === undefined) {
      return { ok: false, error: 'git-remote: commit-message generation is not configured; set provider and model together on the git-remote row' }
    }
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    return await answer(async () => {
      const diff = await this.ctx.git.diff(cwd, { staged: true, maxBytes: this.config.maxDiffBytes })
      if (diff.patch.trim() === '') {
        throw new GitError('nothing is staged; stage changes before generating a commit message', 1, '')
      }
      const userText = `Write the commit message for these staged changes:\n\n${diff.patch}\n${diff.truncated ? '\n(the diff was truncated at its tail)\n' : ''}`
      const messages: Message[] = [createUserMessage({
        content: [{ type: 'text', text: userText }],
        source: { kind: 'plugin', plugin: 'dsh-git-remote' },
      })]
      using callDeadline = deadline(undefined, this.config.timeoutMs, 'GIT_COMMIT_MESSAGE_TIMEOUT')
      const options: GenerateOptions = {
        provider,
        model,
        messages,
        system: COMMIT_MESSAGE_SYSTEM,
        maxTokens: this.config.maxOutputTokens,
        signal: callDeadline.signal,
      }
      const assembler = new BlockAssembler()
      for await (const chunk of this.ctx.llm.stream(options)) {
        callDeadline.signal.throwIfAborted()
        assembler.push(chunk)
      }
      const terminalError = finishError(assembler.finish)
      if (terminalError !== undefined) throw terminalError
      const blocks = assembler.blocks()
      if (blocks.some(block => block.type === 'tool-call')) {
        throw new Error('git-remote: the commit-message model returned a tool call')
      }
      const text = blocks
        .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join(' ')
      const message = normalizeCommitMessage(text)
      if (message === '') throw new Error('git-remote: the commit-message model produced no text')
      return { message }
    })
  }

  /**
   * `gitRemote.checkpoints`: the session's checkpoint series, newest first.
   * @param request - the session whose checkpoint series to read.
   * @returns the checkpoint list view, or the failure the panel renders.
   */
  @Remote('checkpoints')
  async checkpoints(request: GitRemoteCheckpointListRequest): Promise<GitRemoteResult<GitRemoteCheckpointListView>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    // The session id is the series key: one checkpoint timeline per session.
    const series = String(request.sessionId)
    return await answer(async () => {
      const listed = await this.ctx.git.checkpoints(cwd, series)
      return { checkpoints: listed.checkpoints.map(checkpoint => ({ ...checkpoint })) }
    })
  }

  /**
   * `gitRemote.restoreCheckpoint`: return work-tree files to one checkpoint.
   * @param request - the session, the checkpoint ordinal, and optional paths.
   * @returns the restored echo, or the failure the panel renders.
   */
  @Remote('restoreCheckpoint')
  async restoreCheckpoint(
    request: GitRemoteCheckpointRestoreRequest,
  ): Promise<GitRemoteResult<{ restored: readonly string[] }>> {
    const resolved = this.resolve(request.sessionId)
    if ('failure' in resolved) return resolved.failure
    const cwd = resolved.cwd
    const series = String(request.sessionId)
    const paths = request.paths?.filter(path => path.trim() !== '') ?? []
    return await answer(async () => {
      const result = await this.ctx.git.checkpointRestore(cwd, {
        series,
        index: request.index,
        ...paths.length > 0 ? { paths } : {},
      })
      return { restored: result.restored.map(path => path) }
    })
  }
}

export default GitRemoteService
