/**
 * Turn sound notifications, browser half: plays a completion chime when a
 * turn ends and a question chime when the agent asks the user, with settings
 * under a dedicated "提示音" settings page.
 *
 * @module @dsh-custom/dsh-client-ui-turn-sounds/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the settings slot declaration lives in ui-settings.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the uiSession service merge (ctx.uiSession.pendingInteractions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { loadSettings, playSound, primeAudioOnInteraction } from './sounds.ts'
import { SoundSettingsSection } from './SoundSettingsSection.tsx'

/** Services required by the browser plugin. */
export const inject = ['slots', 'sessions', 'uiSession']

/**
 * Register the settings page and the session-event sound listener.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  primeAudioOnInteraction()

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sounds',
    order: 30,
    label: () => '提示音',
  }, SoundSettingsSection))

  // ── global live sound listener ─────────────────────────────────────────
  // Listen to every listed session, not just the active one, so sounds reach
  // the user even when the dsh tab is in the background or another session is
  // running. A completed turn is the `running` flag's true→false edge, so the
  // first snapshot of a session only seeds the baseline and never replays
  // history as sound.
  const runningSeen = new Map<SessionId, boolean>()
  const unsubscribers = new Map<SessionId, () => void>()

  const handleSnapshot = (sessionId: SessionId, snapshot: SessionSnapshot): void => {
    const previous = runningSeen.get(sessionId)
    runningSeen.set(sessionId, snapshot.running)
    if (previous === undefined) return
    if (previous && !snapshot.running) playSound('completion', loadSettings())
  }

  const attachSession = (sessionId: SessionId): void => {
    if (unsubscribers.has(sessionId)) return
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) return
    const session = binding.session
    const unsubscribe = session.subscribe(() => {
      handleSnapshot(sessionId, session.getSnapshot())
    })
    unsubscribers.set(sessionId, unsubscribe)
    handleSnapshot(sessionId, session.getSnapshot())
  }

  const syncSessions = (): void => {
    const ids = new Set(ctx.sessions.list.getSnapshot().ids)
    for (const [sessionId, unsubscribe] of unsubscribers) {
      if (!ids.has(sessionId)) {
        unsubscribe()
        unsubscribers.delete(sessionId)
        runningSeen.delete(sessionId)
      }
    }
    for (const sessionId of ids) attachSession(sessionId)
  }

  const unsubscribeList = ctx.sessions.list.subscribe(syncSessions)
  syncSessions()

  // ── question chime over the global pending-interaction source ──────────
  // A question the agent asks surfaces as a 'question' entry in
  // ctx.uiSession.pendingInteractions across every session. The first read
  // only seeds the known keys; afterwards each newly published key chimes.
  // Replacement requests must publish a fresh key, so a key can never return.
  let questionsSeeded = false
  const knownQuestionKeys = new Set<string>()
  const notifyPending = (): void => {
    const current = ctx.uiSession.pendingInteractions.getSnapshot()
    const live = new Set<string>()
    for (const interaction of current.values()) {
      if (interaction.kind !== 'question') continue
      live.add(interaction.key)
      if (questionsSeeded && !knownQuestionKeys.has(interaction.key)) {
        playSound('question', loadSettings())
      }
    }
    knownQuestionKeys.clear()
    for (const key of live) knownQuestionKeys.add(key)
  }
  notifyPending()
  questionsSeeded = true
  const unsubscribePending = ctx.uiSession.pendingInteractions.subscribe(notifyPending)

  ctx.effect(() => () => {
    unsubscribeList()
    unsubscribePending()
    for (const unsubscribe of unsubscribers.values()) unsubscribe()
    unsubscribers.clear()
  }, 'ui-turn-sounds: session listener')
}
