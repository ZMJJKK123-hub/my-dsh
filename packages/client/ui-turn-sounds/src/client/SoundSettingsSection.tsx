/**
 * Settings page for turn sounds: master switch, volume, and per-slot sound
 * selection (built-in chime or a user-uploaded mp3/wav/ogg ≤1MB).
 *
 * @module @deepseek-ai/dsh-client-ui-turn-sounds/client/SoundSettingsSection
 */

import { useState } from 'react'
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings, type SoundChoice, type SoundSettings,
} from './sounds.ts'

const MAX_UPLOAD_BYTES = 1024 * 1024
const ACCEPT = 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,.mp3,.wav,.ogg'

const rowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l1, #ccc)',
}
const labelStyle: React.CSSProperties = { fontWeight: 600 }
const controlStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
const selectStyle: React.CSSProperties = { padding: '4px 8px' }
const inputStyle: React.CSSProperties = { flex: 1, minWidth: 200 }
const smallStyle: React.CSSProperties = { fontSize: 12, opacity: 0.7 }

function SoundSlotEditor(props: {
  title: string
  choice: SoundChoice
  onChange: (choice: SoundChoice) => void
}): React.JSX.Element {
  const { title, choice, onChange } = props
  const handleFile = (file: File | undefined): void => {
    if (file === undefined) return
    if (file.size > MAX_UPLOAD_BYTES) {
      alert('音效文件不能超过 1MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      onChange({ mode: 'custom', customName: file.name, customDataUrl: reader.result })
    }
    reader.readAsDataURL(file)
  }

  return (
    <div style={rowStyle}>
      <div style={labelStyle}>{title}</div>
      <div style={controlStyle}>
        <select
          style={selectStyle}
          value={choice.mode}
          onChange={(event) => {
            onChange(event.target.value === 'default'
              ? { mode: 'default' }
              : { mode: 'custom', ...(choice.customName === undefined ? {} : { customName: choice.customName }), ...(choice.customDataUrl === undefined ? {} : { customDataUrl: choice.customDataUrl }) })
          }}
        >
          <option value="default">默认音效</option>
          <option value="custom">自定义音效</option>
        </select>
        {choice.mode === 'custom' && (
          <>
            <input
              type="file"
              accept={ACCEPT}
              style={inputStyle}
              onChange={(event) => { handleFile(event.target.files?.[0]) }}
            />
            {choice.customName !== undefined && <span style={smallStyle}>{choice.customName}</span>}
          </>
        )}
      </div>
    </div>
  )
}

/** The "提示音" settings section. */
export function SoundSettingsSection(): React.JSX.Element {
  const [settings, setSettings] = useState<SoundSettings>(() => loadSettings())

  const update = (next: SoundSettings): void => {
    setSettings(next)
    saveSettings(next)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h3 style={{ margin: '0 0 8px' }}>提示音</h3>
      <p style={smallStyle}>Agent 完成一轮回复时播放完成音；Agent 向你提问时播放提问音。</p>
      <div style={rowStyle}>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => { update({ ...settings, enabled: event.target.checked }) }}
          />
          启用提示音
        </label>
        <div style={controlStyle}>
          <span>音量</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.volume * 100)}
            onChange={(event) => { update({ ...settings, volume: Number(event.target.value) / 100 }) }}
          />
          <span>{Math.round(settings.volume * 100)}%</span>
        </div>
      </div>
      <SoundSlotEditor
        title="完成音（Agent 回复结束）"
        choice={settings.completion}
        onChange={(completion) => { update({ ...settings, completion }) }}
      />
      <SoundSlotEditor
        title="提问音（Agent 向你提问）"
        choice={settings.question}
        onChange={(question) => { update({ ...settings, question }) }}
      />
      <button
        type="button"
        onClick={() => { update(DEFAULT_SETTINGS) }}
        style={{ marginTop: 12, padding: '6px 12px' }}
      >
        恢复默认
      </button>
    </div>
  )
}
