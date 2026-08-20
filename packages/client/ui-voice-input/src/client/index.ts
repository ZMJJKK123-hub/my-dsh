/**
 * Voice input plugin, browser half: registers the mic button into the
 * composer's tool-row right seat. No Remote, no Host state — everything runs
 * in the browser through the Web Speech API and the session input actions.
 * @module @dsh-custom/dsh-client-ui-voice-input/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (input.right).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { VoiceInput } from './VoiceInput.tsx'
import { en, NS, zh, type VoiceInputKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Voice-input button copy. */
    'voiceInput': VoiceInputKey
  }
}

/** Required services: the slot registry and the locale dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the composer mic entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-voice-input: dictionaries')
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'voice-input',
    order: 5,
    locale: NS,
  }, VoiceInput))
}
