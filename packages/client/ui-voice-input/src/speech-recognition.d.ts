/**
 * Minimal Web Speech API declarations. TypeScript's DOM lib ships
 * `SpeechRecognitionEvent` but not the `SpeechRecognition` constructor
 * (removed from lib.dom when the spec left the standards track); browsers
 * still expose it as `SpeechRecognition` / `webkitSpeechRecognition`.
 * @module @dsh-custom/dsh-client-ui-voice-input
 */

interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  readonly transcript: string
}

declare const SpeechRecognition: {
  new (): SpeechRecognition
} | undefined
