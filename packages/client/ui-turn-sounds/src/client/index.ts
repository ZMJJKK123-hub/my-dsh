/**
 * Turn sound notifications, browser half: plays a completion chime when a
 * turn ends and a question chime when the agent asks the user, with settings
 * under a dedicated "提示音" settings page.
 *
 * @module @deepseek-ai/dsh-client-ui-turn-sounds/client
 */

import type {
  ClientContext, ConversationSnapshot, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the settings slot declaration lives in ui-settings.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { loadSettings, playSound, primeAudioOnInteraction } from './sounds.ts'
import { SoundSettingsSection } from './SoundSettingsSection.tsx'

/** Services required by the browser plugin. */
export const inject = ['slots', 'sessions']

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
  // running.
  const knownTurns = new Map<SessionId, Set<number>>()
  const knownQuestions = new Map<SessionId, Set<string>>()
  const seeded = new Set<SessionId>()
  const unsubscribers = new Map<SessionId, () => void>()

  const handleSnapshot = (sessionId: SessionId, snapshot: ConversationSnapshot): void => {
    const settings = loadSettings()
    const turns = knownTurns.get(sessionId) ?? new Set<number>()
    const questions = knownQuestions.get(sessionId) ?? new Set<string>()

    if (!seeded.has(sessionId)) {
      // Wait for the session to finish loading before establishing the
      // baseline; otherwise a refresh would seed an empty snapshot and then
      // replay history as new turns when the conversation opens.
      if (snapshot.openState === 'cold' || snapshot.openState === 'loading') return
      for (const turn of snapshot.turnEnds.keys()) turns.add(turn)
      for (const pending of snapshot.pending) {
        if (pending.kind === 'question') questions.add(pending.key)
      }
      seeded.add(sessionId)
    } else {
      for (const turn of snapshot.turnEnds.keys()) {
        if (!turns.has(turn)) {
          turns.add(turn)
          playSound('completion', settings)
        }
      }
      for (const pending of snapshot.pending) {
        if (pending.kind === 'question' && !questions.has(pending.key)) {
          questions.add(pending.key)
          playSound('question', settings)
        }
      }
    }

    knownTurns.set(sessionId, turns)
    knownQuestions.set(sessionId, questions)
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
        seeded.delete(sessionId)
        knownTurns.delete(sessionId)
        knownQuestions.delete(sessionId)
      }
    }
    for (const sessionId of ids) attachSession(sessionId)
  }

  const unsubscribeList = ctx.sessions.list.subscribe(syncSessions)
  syncSessions()

  ctx.effect(() => () => {
    unsubscribeList()
    for (const unsubscribe of unsubscribers.values()) unsubscribe()
    unsubscribers.clear()
  }, 'ui-turn-sounds: session listener')
}
