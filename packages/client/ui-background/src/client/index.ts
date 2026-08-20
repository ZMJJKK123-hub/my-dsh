/**
 * Background plugin, browser half: registers the General-settings background
 * row and injects the global style that reveals the body background image by
 * making the page-level surfaces transparent while `data-dsh-bg` is set.
 * Everything runs in the browser — localStorage persistence, no Host state.
 * @module @dsh-custom/dsh-client-ui-background/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings SlotMap merge (settings.general.item).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { applyBackground, BACKGROUND_STYLE_ID, clearAppliedBackground, loadBackground } from './background.ts'
import { BackgroundRow } from './BackgroundRow.tsx'
import { en, NS, zh, type BackgroundKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background row copy. */
    'background': BackgroundKey
  }
}

/**
 * Global rule: with `data-dsh-bg` on the body, the page-level surfaces
 * (frame, chat area, details panel) go transparent so the body image shows
 * through, while message bubbles, inputs, and the sidebar keep their own
 * fills. `--dsh-bg-url` is published by {@link applyBackground}.
 */
const BACKGROUND_STYLES = `
body[data-dsh-bg] {
  --dsw-alias-bg-base: transparent !important;
  background-image: var(--dsh-bg-url);
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  background-repeat: no-repeat;
}
`

/** Required services: the slot registry and the locale dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries, the background row, and the
 * global style; restore the persisted background on boot.
 * @param ctx - client root context.
 * @returns disposer removing the style and the applied background.
 */
export function apply(ctx: ClientContext): () => void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-background: dictionaries')

  const restore = (): void => {
    const saved = loadBackground()
    if (saved !== null) applyBackground(saved)
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.id = BACKGROUND_STYLE_ID
    style.textContent = BACKGROUND_STYLES
    document.head.appendChild(style)
    restore()
    return () => {
      style.remove()
      clearAppliedBackground()
    }
  }, 'ui-background: global style')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'background',
    // After Appearance (order 10): General rows stack in order.
    order: 20,
    locale: NS,
  }, BackgroundRow))

  return () => {
    // The effect cleanup above already removed the style and the applied
    // background; nothing else is held.
  }
}
