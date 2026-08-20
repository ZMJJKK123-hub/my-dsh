// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
// Type-only: pulls the LocaleNamespaceMap augmentation declared by the plugin entry.
import type {} from '../src/client/index.ts'
import { VoiceInput, type VoiceInputProps } from '../src/client/VoiceInput.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t = makeTranslate(zh)

interface FakeEngine {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: unknown) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

function installFakeEngine(): { engine: FakeEngine; ctor: () => FakeEngine } {
  const engine: FakeEngine = {
    lang: '',
    continuous: false,
    interimResults: false,
    onresult: null,
    onerror: null,
    onend: null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  }
  const ctor = function (): FakeEngine { return engine }
  Object.defineProperty(globalThis, 'SpeechRecognition', { value: ctor, configurable: true, writable: true })
  return { engine, ctor }
}

function removeEngine(): void {
  Reflect.deleteProperty(globalThis, 'SpeechRecognition')
  Reflect.deleteProperty(globalThis, 'webkitSpeechRecognition')
}

/** A complete InputActions mock; only setDraft is exercised by these specs. */
function actions(setDraft: (text: string) => void = vi.fn()): VoiceInputProps['inputActions'] {
  return {
    setDraft,
    addImages: vi.fn(() => true),
    removeImage: vi.fn(),
    pruneImages: vi.fn(),
    submit: vi.fn(),
  }
}

function props(inputActions: VoiceInputProps['inputActions']): VoiceInputProps {
  return {
    useInput: (() => '') as unknown as VoiceInputProps['useInput'],
    inputActions,
    t,
  } as unknown as VoiceInputProps
}

describe('VoiceInput', () => {
  it('renders nothing when SpeechRecognition is unsupported', () => {
    removeEngine()
    const { container } = render(<VoiceInput {...props(actions())} />)
    expect(container.innerHTML).toBe('')
  })

  it('starts and stops recognition on click', () => {
    const { engine } = installFakeEngine()
    const { container } = render(<VoiceInput {...props(actions())} />)
    const button = container.querySelector('[data-voice-input]')!
    fireEvent.click(button)
    expect(engine.start).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('data-listening')).toBe('true')
    fireEvent.click(button)
    expect(engine.stop).toHaveBeenCalledTimes(1)
  })

  it('appends a final transcript to the draft', () => {
    const { engine } = installFakeEngine()
    const setDraft = vi.fn<(text: string) => void>()
    render(<VoiceInput {...props(actions(setDraft))} />)
    fireEvent.click(document.querySelector('[data-voice-input]')!)
    act(() => {
      engine.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: '帮我看看这个文件' } }],
      })
    })
    expect(setDraft).toHaveBeenCalledWith('帮我看看这个文件')
  })

  it('surfaces a permission error through the title', () => {
    const { engine } = installFakeEngine()
    const { container } = render(<VoiceInput {...props(actions())} />)
    fireEvent.click(container.querySelector('[data-voice-input]')!)
    act(() => {
      engine.onerror?.({ error: 'not-allowed' })
    })
    const button = container.querySelector('[data-voice-input]')!
    expect(button.getAttribute('data-error')).toBe('permission')
    expect(button.getAttribute('title')).toBe('麦克风权限被拒绝')
  })

  it('ignores an aborted error caused by a user stop', () => {
    const { engine } = installFakeEngine()
    const { container } = render(<VoiceInput {...props(actions())} />)
    fireEvent.click(container.querySelector('[data-voice-input]')!)
    fireEvent.click(container.querySelector('[data-voice-input]')!)
    act(() => {
      engine.onerror?.({ error: 'aborted' })
    })
    expect(container.querySelector('[data-voice-input]')!.getAttribute('data-error')).toBeNull()
  })
})
