/**
 * The ported Zai theme definitions: ZCode's `theme-zai-light` and
 * `theme-zai-dark` palettes mapped onto the 14 documented dsh alias tokens.
 *
 * @module @dsh-custom/dsh-client-ui-theme-zai/client
 */

import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client'

/** The light Zai palette: near-white surfaces, ink foreground, black brand. */
export const ZAI_LIGHT: ThemeDefinition = {
  id: 'zai-light',
  colorScheme: 'light',
  tokens: {
    '--dsw-alias-bg-base': '#f8f8f8',
    '--dsw-alias-bg-layer-1': '#ffffff',
    '--dsw-alias-bg-layer-2': '#f0f0f0',
    '--dsw-alias-bg-overlay': '#ffffff',
    '--dsw-alias-border-l1': 'rgba(13, 13, 13, 0.1)',
    '--dsw-alias-border-l2': 'rgba(13, 13, 13, 0.15)',
    '--dsw-alias-brand-primary': '#000000',
    '--dsw-alias-label-primary': '#0d0d0d',
    '--dsw-alias-label-secondary': 'rgba(13, 13, 13, 0.6)',
    '--dsw-alias-state-error-primary': '#dc2626',
    '--dsw-alias-state-success-primary': '#16a34a',
    '--dsw-alias-state-warn-primary': '#ca8a04',
    '--dsw-specific-sidebar-fill': '#f0f0f0',
  },
}

/** The dark Zai palette: near-black surfaces, white foreground, white brand. */
export const ZAI_DARK: ThemeDefinition = {
  id: 'zai-dark',
  colorScheme: 'dark',
  tokens: {
    '--dsw-alias-bg-base': '#161616',
    '--dsw-alias-bg-layer-1': '#202020',
    '--dsw-alias-bg-layer-2': '#2b2b2b',
    '--dsw-alias-bg-overlay': '#2b2b2b',
    '--dsw-alias-border-l1': 'rgba(255, 255, 255, 0.1)',
    '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.15)',
    '--dsw-alias-brand-primary': '#ffffff',
    '--dsw-alias-label-primary': '#ffffff',
    '--dsw-alias-label-secondary': 'rgba(255, 255, 255, 0.6)',
    '--dsw-alias-state-error-primary': '#f87171',
    '--dsw-alias-state-success-primary': '#4ade80',
    '--dsw-alias-state-warn-primary': '#facc15',
    '--dsw-specific-sidebar-fill': '#161616',
  },
}
