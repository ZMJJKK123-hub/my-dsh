/**
 * VoiceInput: the composer tool-row mic button. Toggles the browser's
 * SpeechRecognition (Web Speech API; Edge/Chrome) and appends each final
 * transcript to the draft through `inputActions.setDraft`, composing with
 * whatever is already typed. Unsupported browsers render nothing;
 * permission/network failures surface through the button's title and a
 * transient `data-error` state instead of a modal.
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './VoiceInput.module.css'

/** Full props of the composer mic button. */
export type VoiceInputProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<typeof NS>

/** One SpeechRecognition failure category mapped to a localized message. */
type RecognitionError =
  | 'unsupported'
  | 'permission'
  | 'network'
  | 'noSpeech'
  | 'aborted'

/**
 * Resolve the browser's speech recognition constructor, if any.
 * @returns the constructor, or undefined when the API is absent.
 */
function recognitionCtor(): (new () => SpeechRecognition) | undefined {
  const windowRef = globalThis as typeof globalThis & {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }
  return windowRef.SpeechRecognition ?? windowRef.webkitSpeechRecognition
}

/** Map a Web Speech error event to a stable category. */
function categoryOf(error: string): RecognitionError {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed': return 'permission'
    case 'network': return 'network'
    case 'no-speech': return 'noSpeech'
    case 'aborted': return 'aborted'
    default: return 'network'
  }
}

/**
 * Render the composer mic button.
 * @param props - owner zone, the session standard kit (`useInput`,
 * `inputActions`), and the locale seat.
 * @returns the mic button, or null when speech recognition is unsupported.
 */
export function VoiceInput({ useInput, inputActions, t }: VoiceInputProps) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<RecognitionError | null>(null)
  const engineRef = useRef<SpeechRecognition | null>(null)
  const listeningRef = useRef(false)
  const errorTimer = useRef<number | undefined>(undefined)
  // Live draft for the append math: every final transcript is spliced onto
  // the current draft at commit time (recognition runs async, so the draft
  // may have moved since the utterance started).
  const draft = useInput(snapshot => snapshot.draft)
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  useEffect(() => () => {
    if (errorTimer.current !== undefined) clearTimeout(errorTimer.current)
    engineRef.current?.abort()
  }, [])

  const Ctor = recognitionCtor()
  if (Ctor === undefined) return null

  const flashError = (category: RecognitionError): void => {
    setError(category)
    if (errorTimer.current !== undefined) clearTimeout(errorTimer.current)
    errorTimer.current = window.setTimeout(() => { setError(null) }, 3000)
  }

  const start = (): void => {
    const engine = new Ctor()
    engine.lang = navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US'
    engine.continuous = true
    engine.interimResults = false
    listeningRef.current = true
    setListening(true)
    setError(null)

    engine.onresult = (event: SpeechRecognitionEvent): void => {
      let transcript = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result !== undefined && result.isFinal) transcript += result[0]?.transcript ?? ''
      }
      if (transcript === '') return
      const prefix = draftRef.current
      const separator = prefix === '' || /[\s，。！？；：、,.!?;:]$/.test(prefix) ? '' : ' '
      inputActions.setDraft(`${prefix}${separator}${transcript}`)
    }
    engine.onerror = (event: SpeechRecognitionErrorEvent): void => {
      // A user-initiated stop aborts the engine; that is not an error.
      if (event.error === 'aborted' && !listeningRef.current) return
      flashError(categoryOf(event.error))
    }
    engine.onend = (): void => {
      listeningRef.current = false
      setListening(false)
    }
    engineRef.current = engine
    try {
      engine.start()
    } catch {
      flashError('network')
    }
  }

  const stop = (): void => {
    listeningRef.current = false
    engineRef.current?.stop()
  }

  return (
    <button
      type="button"
      className={`${css.trigger} ${listening ? css.listening : ''}`}
      data-voice-input
      data-listening={listening || undefined}
      data-error={error ?? undefined}
      aria-label={listening ? t('trigger.stop') : t('trigger.start')}
      aria-pressed={listening}
      title={error === null ? (listening ? t('trigger.stop') : t('trigger.start')) : t(`error.${error}`)}
      onClick={() => { if (listening) stop(); else start() }}
    >
      <svg viewBox="0 0 16 16" className={css.icon} aria-hidden="true">
        <path
          d="M8 1.5a2.25 2.25 0 0 0-2.25 2.25v4a2.25 2.25 0 0 0 4.5 0v-4A2.25 2.25 0 0 0 8 1.5Zm-3.5 6.25a3.5 3.5 0 0 0 7 0h-1a2.5 2.5 0 0 1-5 0h-1Zm4 4.4V14h2v1H5.5v-1h2v-1.85A4.75 4.75 0 0 1 3.25 7.5h1a3.75 3.75 0 0 0 7.5 0h1a4.75 4.75 0 0 1-4.25 4.65Z"
          fill="currentColor"
        />
      </svg>
    </button>
  )
}
