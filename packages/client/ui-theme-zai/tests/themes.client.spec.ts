import { describe, expect, it } from 'vitest'
import { ZAI_DARK, ZAI_LIGHT } from '../src/client/themes.ts'

/** The alias tokens dsh documents (from ui-theme's builtin inspection list). */
const DOCUMENTED_TOKENS = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
]

describe('Zai themes', () => {
  it('each theme overrides exactly the documented alias tokens', () => {
    for (const theme of [ZAI_LIGHT, ZAI_DARK]) {
      expect(Object.keys(theme.tokens).sort()).toEqual([...DOCUMENTED_TOKENS].sort())
    }
  })

  it('declares the matching base scheme and stable ids', () => {
    expect(ZAI_LIGHT.id).toBe('zai-light')
    expect(ZAI_LIGHT.colorScheme).toBe('light')
    expect(ZAI_DARK.id).toBe('zai-dark')
    expect(ZAI_DARK.colorScheme).toBe('dark')
  })

  it('every value is a non-empty string', () => {
    for (const theme of [ZAI_LIGHT, ZAI_DARK]) {
      for (const [token, value] of Object.entries(theme.tokens)) {
        expect(typeof value === 'string' && value.trim() !== '', `${theme.id} ${token}`).toBe(true)
      }
    }
  })
})
