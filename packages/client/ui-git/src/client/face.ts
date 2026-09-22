/**
 * The panel's asynchronous half: every git Remote call, unwrapped from the
 * two envelopes (the carrier {@link RemoteResult}, then the host's own
 * `GitRemoteResult`) and written through the store's actions — the component
 * never awaits anything. Mutations guard on `busy`, then refresh the status.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GitRemoteCommitRequest, GitRemoteCommitView, GitRemoteDiffRequest, GitRemoteDiffView,
  GitRemoteGeneratedMessageView, GitRemotePushRequest, GitRemotePushView, GitRemoteResult,
  GitRemoteSessionRequest, GitRemoteStageRequest, GitRemoteStageView, GitRemoteStatusView,
} from '@dsh-custom/dsh-git-remote/types'
import type { createGitStore } from './store.ts'

/** The gitRemote namespace's wire shape as the panel consumes it. */
export interface GitRemoteFace {
  status(request: GitRemoteSessionRequest): Promise<RemoteResult<GitRemoteResult<GitRemoteStatusView>>>
  diff(request: GitRemoteDiffRequest): Promise<RemoteResult<GitRemoteResult<GitRemoteDiffView>>>
  stage(request: GitRemoteStageRequest): Promise<RemoteResult<GitRemoteResult<GitRemoteStageView>>>
  unstage(request: GitRemoteStageRequest): Promise<RemoteResult<GitRemoteResult<GitRemoteStageView>>>
  commit(request: GitRemoteCommitRequest): Promise<RemoteResult<GitRemoteResult<GitRemoteCommitView>>>
  push(request: GitRemotePushRequest): Promise<RemoteResult<GitRemoteResult<GitRemotePushView>>>
  generateCommitMessage(request: GitRemoteSessionRequest): Promise<RemoteResult<GitRemoteResult<GitRemoteGeneratedMessageView>>>
}

/** One unwrapped domain answer: the view, or the renderable failure. */
type Answer<T> = { ok: true; view: T } | { ok: false; message: string; denied: boolean }

/** Unwrap the two envelopes into one answer. */
async function unwrap<T>(carried: RemoteResult<GitRemoteResult<T>>): Promise<Answer<T>> {
  if (!carried.ok) return { ok: false, message: carried.error.message, denied: false }
  const domain = carried.value
  if (!domain.ok) return { ok: false, message: domain.error, denied: domain.denied === true }
  return { ok: true, view: domain.value }
}

/** Localized notice strings the component supplies to commit and push. */
export interface GitNoticeLabels {
  /** Compose the success line from the commit's short hash and subject. */
  readonly committed: (hash: string, subject: string) => string
  /** Compose the success line from the push target. */
  readonly pushed: (remote: string, branch: string) => string
  /** The policy-blocked line. */
  readonly denied: string
  /** Compose the failure line from the transport or domain message. */
  readonly failed: (message: string) => string
}

/** What the tab's body calls; every gesture is fire-and-forget. */
export interface GitInjected {
  /** Seed the bucket and read the status. */
  readonly start: (tabId: TabId, signal: AbortSignal) => void
  /** Re-read the status. */
  readonly refresh: (tabId: TabId, signal: AbortSignal) => void
  /** Open one file's diff (staged or work-tree side). */
  readonly openDiff: (tabId: TabId, path: string, staged: boolean, signal: AbortSignal) => void
  /** Stage one path, then refresh. */
  readonly stage: (tabId: TabId, path: string, signal: AbortSignal) => void
  /** Stage everything, then refresh. */
  readonly stageAll: (tabId: TabId, signal: AbortSignal) => void
  /** Unstage one path, then refresh. */
  readonly unstage: (tabId: TabId, path: string, signal: AbortSignal) => void
  /** Commit the staged index with a message; the notice line carries the outcome. */
  readonly commit: (tabId: TabId, message: string, labels: GitNoticeLabels, signal: AbortSignal) => void
  /** Push the current branch; the notice line carries the outcome. */
  readonly push: (tabId: TabId, labels: GitNoticeLabels, signal: AbortSignal) => void
  /** Draft the commit message from the staged diff; the draft fills the commit box. */
  readonly generateMessage: (tabId: TabId, labels: GitNoticeLabels, signal: AbortSignal) => void
}

/**
 * Bind the panel's face to the gitRemote namespace.
 * @param remote - the mounted gitRemote Remote namespace.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function gitFace(
  remote: GitRemoteFace,
): (sessionId: string, actions: BoundActions<ReturnType<typeof createGitStore>>) => GitInjected {
  return (sessionId: string, actions: BoundActions<ReturnType<typeof createGitStore>>): GitInjected => {
    // The seat hands the raw session id string; the wire requests carry the brand.
    const session = sessionId as SessionId
    /** Read the status into the store; failures land renderable. */
    const refresh = (tabId: TabId, signal: AbortSignal): void => {
      if (signal.aborted) return
      actions.statusLoading(tabId)
      void remote.status({ sessionId: session }).then(async (carried) => {
        if (signal.aborted) return
        const answer = await unwrap(carried)
        if (answer.ok) actions.statusReady(tabId, answer.view)
        else actions.statusFailed(tabId, answer.message, answer.denied)
      })
    }
    /** Run one mutation under the busy guard, then refresh. */
    const mutate = (tabId: TabId, signal: AbortSignal, run: () => Promise<void>): void => {
      if (signal.aborted) return
      actions.busy(tabId, true)
      void run().catch(() => {}).finally(() => {
        if (!signal.aborted) {
          actions.busy(tabId, false)
          refresh(tabId, signal)
        }
      })
    }
    return {
      start(tabId, signal) {
        actions.start(tabId)
        signal.addEventListener('abort', () => actions.forget(tabId), { once: true })
        refresh(tabId, signal)
      },
      refresh,
      openDiff(tabId, path, staged, signal) {
        if (signal.aborted) return
        actions.select(tabId, path, staged)
        void remote.diff({ sessionId: session, staged, path }).then(async (carried) => {
          if (signal.aborted) return
          const answer = await unwrap(carried)
          if (answer.ok) actions.diffReady(tabId, answer.view.patch, answer.view.truncated)
          else actions.diffFailed(tabId, answer.message)
        })
      },
      stage(tabId, path, signal) {
        mutate(tabId, signal, async () => { await remote.stage({ sessionId: session, paths: [path] }) })
      },
      stageAll(tabId, signal) {
        mutate(tabId, signal, async () => { await remote.stage({ sessionId: session, all: true }) })
      },
      unstage(tabId, path, signal) {
        mutate(tabId, signal, async () => { await remote.unstage({ sessionId: session, paths: [path] }) })
      },
      commit(tabId, message, labels, signal) {
        mutate(tabId, signal, async () => {
          const answer = await unwrap(await remote.commit({ sessionId: session, message }))
          actions.notice(tabId, answer.ok
            ? labels.committed(answer.view.shortHash, answer.view.subject)
            : answer.denied ? labels.denied : labels.failed(answer.message))
        })
      },
      push(tabId, labels, signal) {
        mutate(tabId, signal, async () => {
          const answer = await unwrap(await remote.push({ sessionId: session }))
          actions.notice(tabId, answer.ok
            ? labels.pushed(answer.view.remote, answer.view.branch)
            : answer.denied ? labels.denied : labels.failed(answer.message))
        })
      },
      generateMessage(tabId, labels, signal) {
        if (signal.aborted) return
        actions.generating(tabId, true)
        void remote.generateCommitMessage({ sessionId: session }).then(async (carried) => {
          if (signal.aborted) return
          const answer = await unwrap(carried)
          actions.generating(tabId, false)
          if (answer.ok) actions.generated(tabId, answer.view.message)
          else actions.notice(tabId, answer.denied ? labels.denied : labels.failed(answer.message))
        }).catch(() => {
          if (!signal.aborted) actions.generating(tabId, false)
        })
      },
    }
  }
}
