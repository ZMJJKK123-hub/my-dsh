// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/client/sounds.ts'

beforeEach(() => {
  localStorage.clear()
})

describe('turn-sounds settings persistence', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips saved settings', () => {
    const settings = {
      enabled: false,
      volume: 0.3,
      completion: { mode: 'custom' as const, customName: 'done.mp3', customDataUrl: 'data:audio/mpeg;base64,AAA' },
      question: { mode: 'default' as const },
    }
    saveSettings(settings)
    expect(loadSettings()).toEqual(settings)
  })

  it('falls back to defaults for malformed storage', () => {
    localStorage.setItem('dsh.turn-sounds', '{not-json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
})
