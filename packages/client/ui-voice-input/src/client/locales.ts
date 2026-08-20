/**
 * Dictionary namespace of the voice input button.
 * @module @dsh-custom/dsh-client-ui-voice-input/client
 */

export const NS = 'voiceInput'

/** Dictionary keys owned by this plugin. */
export type VoiceInputKey =
  | 'trigger.start'
  | 'trigger.stop'
  | 'error.unsupported'
  | 'error.permission'
  | 'error.network'
  | 'error.noSpeech'
  | 'error.aborted'

/** English copy. */
export const en: Record<VoiceInputKey, string> = {
  'trigger.start': 'Start voice input',
  'trigger.stop': 'Stop voice input',
  'error.unsupported': 'Voice input is not supported in this browser',
  'error.permission': 'Microphone permission was denied',
  'error.network': 'Speech recognition failed — check your connection',
  'error.noSpeech': 'No speech was detected',
  'error.aborted': 'Voice input was interrupted',
}

/** Chinese copy. */
export const zh: Record<VoiceInputKey, string> = {
  'trigger.start': '开始语音输入',
  'trigger.stop': '停止语音输入',
  'error.unsupported': '当前浏览器不支持语音输入',
  'error.permission': '麦克风权限被拒绝',
  'error.network': '语音识别失败，请检查网络连接',
  'error.noSpeech': '没有检测到语音',
  'error.aborted': '语音输入被中断',
}
