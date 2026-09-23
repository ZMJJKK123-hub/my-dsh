/**
 * The panel's asynchronous half: every automationsRemote call, unwrapped from
 * the two envelopes (the carrier {@link RemoteResult}, then the namespace's
 * own discriminated result) and written through the store's actions. The
 * component never awaits anything.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AutomationCreateRequest, AutomationListView, AutomationUpdateRequest, AutomationView,
  AutomationsRemoteResult,
} from '@dsh-custom/dsh-automations-remote/types'
import type { createAutomationsStore } from './store.ts'

/** The automationsRemote namespace's wire shape as the panel consumes it. */
export interface AutomationsRemoteFace {
  list(): Promise<RemoteResult<AutomationsRemoteResult<AutomationListView>>>
  create(request: AutomationCreateRequest): Promise<RemoteResult<AutomationsRemoteResult<AutomationView>>>
  update(request: AutomationUpdateRequest): Promise<RemoteResult<AutomationsRemoteResult<AutomationView>>>
  deleteAutomation(request: { id: string }): Promise<RemoteResult<AutomationsRemoteResult<null>>>
  runNow(request: { id: string }): Promise<RemoteResult<AutomationsRemoteResult<null>>>
}

/** One unwrapped answer: the value, or the renderable message. */
type Answer<T> = { ok: true; view: T } | { ok: false; message: string }

/** Unwrap the two envelopes into one answer. */
async function unwrap<T>(carried: RemoteResult<AutomationsRemoteResult<T>>): Promise<Answer<T>> {
  if (!carried.ok) return { ok: false, message: carried.error.message }
  const domain = carried.value
  if (!domain.ok) return { ok: false, message: domain.error }
  return { ok: true, view: domain.value }
}

/** What the tab's body calls; every gesture is fire-and-forget. */
export interface AutomationsInjected {
  readonly start: (tabId: TabId, signal: AbortSignal) => void
  readonly refresh: (tabId: TabId, signal: AbortSignal) => void
  readonly create: (tabId: TabId, request: AutomationCreateRequest, signal: AbortSignal) => void
  readonly setEnabled: (tabId: TabId, id: string, enabled: boolean, signal: AbortSignal) => void
  readonly remove: (tabId: TabId, id: string, signal: AbortSignal) => void
  readonly runNow: (tabId: TabId, id: string, signal: AbortSignal) => void
}

/** Localized failure line the component supplies. */
export interface AutomationsLabels {
  readonly failed: (message: string) => string
}

/**
 * Bind the panel's face to the automationsRemote namespace.
 * @param remote - the mounted automationsRemote Remote namespace.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function automationsFace(
  remote: AutomationsRemoteFace,
): (sessionId: string, actions: BoundActions<ReturnType<typeof createAutomationsStore>>) => AutomationsInjected {
  return (
    sessionId: string,
    actions: BoundActions<ReturnType<typeof createAutomationsStore>>,
  ): AutomationsInjected => {
    void sessionId
    /** Read the list into the store; failures land renderable. */
    const refresh = (tabId: TabId, signal: AbortSignal): void => {
      if (signal.aborted) return
      actions.loading(tabId)
      void remote.list().then(async (carried) => {
        if (signal.aborted) return
        const answer = await unwrap(carried)
        if (answer.ok) actions.ready(tabId, answer.view.automations)
        else actions.failed(tabId, answer.message)
      })
    }
    /** Run one mutation, then refresh the list. */
    const mutate = (tabId: TabId, signal: AbortSignal, run: () => Promise<Answer<unknown>>, labels?: AutomationsLabels): void => {
      if (signal.aborted) return
      actions.busy(tabId, true)
      void run().then(async (answer) => {
        if (!signal.aborted) {
          actions.busy(tabId, false)
          if (!answer.ok && labels !== undefined) actions.notice(tabId, labels.failed(answer.message))
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
      create(tabId, request, signal) {
        mutate(tabId, signal, () => remote.create(request).then(unwrap))
      },
      setEnabled(tabId, id, enabled, signal) {
        mutate(tabId, signal, () => remote.update({ id, enabled }).then(unwrap))
      },
      remove(tabId, id, signal) {
        mutate(tabId, signal, () => remote.deleteAutomation({ id }).then(unwrap))
      },
      runNow(tabId, id, signal) {
        mutate(tabId, signal, () => remote.runNow({ id }).then(unwrap))
      },
    }
  }
}
