/**
 * The automations panel's body: the task list with per-row actions and a
 * create form. Everything the panel keeps lives in its store, bucketed by
 * tab; everything it asks for goes through its injected face.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAlarmClockOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AutomationView } from '@dsh-custom/dsh-automations-remote/types'
import type { AutomationsInjected } from './face.ts'
import type { createAutomationsStore } from './store.ts'
import type {} from './locales.ts'
import css from './AutomationsBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type AutomationsBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createAutomationsStore>>
  & AutomationsInjected
  & PropsLocale<'automationsPanel'>

/** Local time, minute precision — the schedule's own resolution. */
function shortTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

/** One task row: title, cron, schedule facts, and the four gestures. */
function Row({
  automation, busy, t, onRunNow, onToggle, onDelete,
}: {
  automation: AutomationView
  busy: boolean
  t: TranslateNS<'automationsPanel'>
  onRunNow: () => void
  onToggle: () => void
  onDelete: () => void
}): ReactNode {
  return (
    <li className={css.item} data-automation-id={automation.id}>
      <div className={css.rowHead}>
        <span className={clsx(css.title, !automation.enabled && css.muted)}>{automation.title}</span>
        <button type="button" className={css.gesture} disabled={busy} onClick={onToggle}>
          {automation.enabled ? t('action.toggleOff') : t('action.toggleOn')}
        </button>
        <button type="button" className={css.gesture} disabled={busy} onClick={onRunNow}>
          {t('action.runNow')}
        </button>
        <button type="button" className={css.gesture} disabled={busy} onClick={onDelete}>
          {t('action.delete')}
        </button>
      </div>
      <div className={css.rowBody}>
        <span className={css.cron}>{automation.cron}</span>
        {!automation.enabled && <span className={css.muted}>{t('row.disabled')}</span>}
        {automation.enabled && automation.nextRunAt !== null && (
          <span className={css.fact}>{t('row.nextRun', { time: shortTime(automation.nextRunAt) })}</span>
        )}
        {automation.lastOutcome === 'ok' && <span className={css.ok}>{t('row.lastOk')}</span>}
        {automation.lastOutcome === 'error' && (
          <span className={css.err}>{t('row.lastError', { message: automation.lastError ?? '' })}</span>
        )}
      </div>
      <div className={clsx(css.rowBody, css.muted)} title={automation.workspacePath}>{automation.workspacePath}</div>
    </li>
  )
}

/** The automations panel: everything one tab of this kind draws. */
export function AutomationsBody({
  useTabInfo, useStore, start, refresh, create, setEnabled, remove, runNow, t,
}: AutomationsBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal } = tab
  const tabId = tab.id
  const state = useStore(store => store.byTab[tabId])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [cron, setCron] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (state !== undefined || signal.aborted) return
    start(tabId, signal)
  }, [state, tabId, signal, start])

  if (state === undefined) {
    return <div className={css.panel} data-automations-panel="loading">{t('loading')}</div>
  }

  const submitCreate = (): void => {
    create(tabId, {
      title: title.trim(),
      workspacePath: workspace.trim(),
      prompt: prompt.trim(),
      cron: cron.trim(),
    }, signal)
    setOpen(false)
    setTitle('')
    setCron('')
    setWorkspace('')
    setPrompt('')
  }

  return (
    <div className={css.panel} data-automations-panel="ready">
      <header className={css.header}>
        <span className={css.headTitle}><IconAlarmClockOutline16 /> {t('type.label')}</span>
        <span className={css.headerActions}>
          <button type="button" className={css.gesture} disabled={state.busy} onClick={() => { setOpen(!open) }}>
            {t('create.open')}
          </button>
          <button
            type="button" className={css.iconAction} disabled={state.busy}
            aria-label={t('action.refresh')} title={t('action.refresh')}
            onClick={() => { refresh(tabId, signal) }}
          >
            <IconRefreshOutline16 />
          </button>
        </span>
      </header>
      {state.notice !== undefined && <div className={css.notice} data-automations-notice>{state.notice}</div>}

      {open && (
        <section className={css.form} data-automations-form>
          <div className={css.formTitle}>{t('create.title')}</div>
          <input className={css.input} placeholder={t('create.namePlaceholder')} value={title}
            onChange={(event) => { setTitle(event.target.value) }} data-automations-input="title" />
          <input className={clsx(css.input, css.mono)} placeholder={t('create.cronPlaceholder')} value={cron}
            onChange={(event) => { setCron(event.target.value) }} data-automations-input="cron" />
          <input className={clsx(css.input, css.mono)} placeholder={t('create.workspacePlaceholder')} value={workspace}
            onChange={(event) => { setWorkspace(event.target.value) }} data-automations-input="workspace" />
          <textarea className={css.textarea} rows={3} placeholder={t('create.promptPlaceholder')} value={prompt}
            onChange={(event) => { setPrompt(event.target.value) }} data-automations-input="prompt" />
          <div className={css.formRow}>
            <button type="button" onClick={() => { setOpen(false) }}>{t('create.cancel')}</button>
            <button
              type="button" className={css.primary}
              disabled={state.busy || title.trim() === '' || cron.trim() === '' || workspace.trim() === '' || prompt.trim() === ''}
              onClick={submitCreate}
            >
              {t('create.submit')}
            </button>
          </div>
        </section>
      )}

      {state.list.kind === 'loading' && <div className={css.note}>{t('loading')}</div>}
      {state.list.kind === 'failed' && <div className={css.note} data-automations-panel="failed">{state.list.message}</div>}
      {state.list.kind === 'ready' && state.list.automations.length === 0 && (
        <div className={css.note}>{t('empty')}</div>
      )}
      {state.list.kind === 'ready' && state.list.automations.length > 0 && (
        <ul className={css.list}>
          {state.list.automations.map(automation => (
            <Row
              key={automation.id} automation={automation} busy={state.busy} t={t}
              onRunNow={() => { runNow(tabId, automation.id, signal) }}
              onToggle={() => { setEnabled(tabId, automation.id, !automation.enabled, signal) }}
              onDelete={() => { remove(tabId, automation.id, signal) }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
