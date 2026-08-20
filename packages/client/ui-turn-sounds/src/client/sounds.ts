/**
 * Sound settings persistence and browser audio playback for the turn-sounds
 * plugin. Settings live in localStorage so custom uploads stay in the browser;
 * default sounds are synthesized with Web Audio (no audio files shipped).
 *
 * @module @deepseek-ai/dsh-client-ui-turn-sounds/client/sounds
 */

/** One sound slot's choice: a built-in synthesized chime or a user upload. */
export interface SoundChoice {
  readonly mode: 'default' | 'custom'
  /** Display name for a custom upload. */
  readonly customName?: string
  /** Data URL (mp3/wav/ogg) for a custom upload. */
  readonly customDataUrl?: string
}

/** Persistent settings for the turn-sounds plugin. */
export interface SoundSettings {
  readonly enabled: boolean
  /** 0..1 playback volume. */
  readonly volume: number
  readonly completion: SoundChoice
  readonly question: SoundChoice
}

const STORAGE_KEY = 'dsh.turn-sounds'

/** Default settings: sounds on, 70% volume, built-in chimes. */
export const DEFAULT_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.7,
  completion: { mode: 'default' },
  question: { mode: 'default' },
}

function isSoundChoice(value: unknown): value is SoundChoice {
  if (typeof value !== 'object' || value === null) return false
  const choice = value as { mode?: unknown; customName?: unknown; customDataUrl?: unknown }
  return choice.mode === 'default' || choice.mode === 'custom'
}

function parseSettings(raw: string | null): SoundSettings {
  if (raw === null) return DEFAULT_SETTINGS
  try {
    const value = JSON.parse(raw) as Partial<SoundSettings>
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
      volume: typeof value.volume === 'number' && value.volume >= 0 && value.volume <= 1
        ? value.volume
        : DEFAULT_SETTINGS.volume,
      completion: isSoundChoice(value.completion) ? value.completion : DEFAULT_SETTINGS.completion,
      question: isSoundChoice(value.question) ? value.question : DEFAULT_SETTINGS.question,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Read the persisted sound settings, falling back to defaults. */
export function loadSettings(): SoundSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS
  return parseSettings(localStorage.getItem(STORAGE_KEY))
}

/** Persist sound settings to localStorage. */
export function saveSettings(settings: SoundSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage failures (private mode, quota) only disable persistence.
  }
}

let audioContext: AudioContext | undefined

function ensureAudioContext(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (Ctor === undefined) return undefined
  if (audioContext === undefined) audioContext = new Ctor()
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}

/** Resume the audio context on the first user gesture (autoplay policy). */
export function primeAudioOnInteraction(): void {
  if (typeof window === 'undefined') return
  const resume = (): void => {
    void ensureAudioContext()?.resume()
    window.removeEventListener('pointerdown', resume)
    window.removeEventListener('keydown', resume)
  }
  window.addEventListener('pointerdown', resume)
  window.addEventListener('keydown', resume)
}

function playTone(
  context: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  volume: number,
): void {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(startAt)
  oscillator.stop(startAt + duration + 0.02)
}

function playDefault(kind: 'completion' | 'question', volume: number): void {
  const context = ensureAudioContext()
  if (context === undefined) return
  const now = context.currentTime + 0.01
  if (kind === 'completion') {
    playTone(context, 660, now, 0.18, volume)
    playTone(context, 880, now + 0.15, 0.22, volume)
  } else {
    playTone(context, 520, now, 0.18, volume)
    playTone(context, 390, now + 0.15, 0.24, volume)
  }
}

function playCustom(dataUrl: string, volume: number): void {
  const audio = new Audio(dataUrl)
  audio.volume = Math.max(0, Math.min(1, volume))
  void audio.play().catch(() => undefined)
}

/** Play the configured sound for one event kind. */
export function playSound(kind: 'completion' | 'question', settings: SoundSettings): void {
  if (!settings.enabled || settings.volume <= 0) return
  const choice = kind === 'completion' ? settings.completion : settings.question
  if (choice.mode === 'custom' && choice.customDataUrl !== undefined) {
    playCustom(choice.customDataUrl, settings.volume)
  } else {
    playDefault(kind, settings.volume)
  }
}
