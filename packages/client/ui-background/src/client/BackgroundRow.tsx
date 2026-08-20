/**
 * BackgroundRow: the General-settings row for the custom background. Shows a
 * preview when one is set, an upload button (photo picker), and a remove
 * button. The applied background is global — closing settings keeps it.
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  applyBackground, clearAppliedBackground, clearBackground, encodeImage,
  loadBackground, saveBackground,
} from './background.ts'
import { NS } from './locales.ts'
import css from './BackgroundRow.module.css'

/** Full props of the background settings row. */
export type BackgroundRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<typeof NS>

/**
 * Render the background settings row.
 * @param props - the runtime share and the locale seat.
 * @returns the row element tree.
 */
export function BackgroundRow({ t }: BackgroundRowProps) {
  const [image, setImage] = useState<string | null>(() => loadBackground())
  const [failed, setFailed] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Keep the persisted background applied across remounts (settings panel
  // open/close). Unmount does NOT clear it: the background is global.
  useEffect(() => {
    const saved = loadBackground()
    if (saved !== null) applyBackground(saved)
  }, [])

  const pick = (file: File | undefined): void => {
    if (file === undefined) return
    setFailed(false)
    void encodeImage(file).then((url) => {
      saveBackground(url)
      applyBackground(url)
      setImage(url)
    }).catch(() => {
      setFailed(true)
    })
  }

  const remove = (): void => {
    clearBackground()
    clearAppliedBackground()
    setImage(null)
    setFailed(false)
  }

  return (
    <div className={css.group} data-background-row>
      <div className={css.title}>{t('row.title')}</div>
      {image !== null && (
        <img className={css.preview} src={image} alt={t('row.previewAlt')} data-testid="background-preview" />
      )}
      <div className={css.actions}>
        <button type="button" className={css.button} onClick={() => { fileRef.current?.click() }}>
          {t('row.upload')}
        </button>
        {image !== null && (
          <button type="button" className={css.button} onClick={remove}>
            {t('row.remove')}
          </button>
        )}
      </div>
      {failed && <div className={css.error}>{t('error.encode')}</div>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className={css.fileInput}
        onChange={(event) => {
          pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
