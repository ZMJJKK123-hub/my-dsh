/**
 * The source-control panel's body: branch header, change groups, diff, and
 * the commit/push actions. Everything the panel keeps lives in its store,
 * bucketed by tab; everything it asks for goes through its injected face.
 * The component itself only decides what to draw and what a click means.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconBranchOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitRemoteStatusEntry, GitRemoteStatusView } from '@dsh-custom/dsh-git-remote/types'
import type { GitNoticeLabels, GitInjected } from './face.ts'
import type { GitStatusState, createGitStore } from './store.ts'
import type {} from './locales.ts'
import css from './GitBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type GitBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createGitStore>>
  & GitInjected
  & PropsLocale<'gitPanel'>

/** The notice strings every mutating action shares. */
function labelsOf(t: TranslateNS<'gitPanel'>): GitNoticeLabels {
  return {
    committed: (hash, subject) => t('notice.committed', { hash, subject }),
    pushed: (remote, branch) => t('notice.pushed', { remote, branch }),
    restored: () => t('notice.restored'),
    denied: t('error.denied'),
    failed: message => t('error.unavailable', { message }),
  }
}

/** Split one status view into the panel's two groups. */
function groupsOf(view: GitRemoteStatusView): { changes: GitRemoteStatusEntry[]; staged: GitRemoteStatusEntry[] } {
  const changes: GitRemoteStatusEntry[] = []
  const staged: GitRemoteStatusEntry[] = []
  for (const entry of view.entries) {
    if (entry.staged) staged.push(entry)
    if (entry.unstaged || entry.untracked) changes.push(entry)
  }
  return { changes, staged }
}

/** One branch line: name or detached marker, plus ahead/behind counts. */
function branchLine(view: GitRemoteStatusView, t: TranslateNS<'gitPanel'>): string {
  const name = view.detached
    ? t('status.detached')
    : (view.branch ?? '')
  const counts = [
    view.ahead > 0 ? t('status.ahead', { n: String(view.ahead) }) : '',
    view.behind > 0 ? t('status.behind', { n: String(view.behind) }) : '',
  ].filter(part => part !== '')
  const tail = [view.initial ? t('status.initial') : '', ...counts].filter(part => part !== '').join(', ')
  return tail === '' ? name : `${name} · ${tail}`
}

/** One change row: status letter, path, and the group's gesture button. */
function EntryRow({
  entry, staged, selected, busy, t, onSelect, onGesture,
}: {
  entry: GitRemoteStatusEntry
  staged: boolean
  selected: boolean
  busy: boolean
  t: TranslateNS<'gitPanel'>
  onSelect: () => void
  onGesture: () => void
}): ReactNode {
  return (
    <li className={clsx(css.item, selected && css.selected)} data-git-path={entry.path} data-git-staged={staged}>
      <button type="button" className={css.row} title={entry.path} onClick={onSelect}>
        <span className={css.code}>{entry.code.trim() === '' ? '·' : entry.code.trim()}</span>
        <span className={css.name}>{entry.path}</span>
      </button>
      <button
        type="button" className={css.gesture} disabled={busy}
        aria-label={staged ? t('action.unstage') : t('action.stage')}
        title={staged ? t('action.unstage') : t('action.stage')}
        onClick={onGesture}
      >
        {staged ? '−' : '+'}
      </button>
    </li>
  )
}

/** The source-control panel: everything one tab of this kind draws. */
export function GitBody({
  useTabInfo, useStore, start, refresh, openDiff, stage, stageAll, unstage, commit, push,
  generateMessage, loadCheckpoints, restoreCheckpoint, t,
}: GitBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal } = tab
  const tabId = tab.id
  const state = useStore(store => store.byTab[tabId])
  const [message, setMessage] = useState('')

  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || signal.aborted) return
    start(tabId, signal)
    loadCheckpoints(tabId, signal)
  }, [state, tabId, signal, start, loadCheckpoints])

  // The bucket appears with `start`; until then the panel is a loading line.
  if (state === undefined) {
    return <div className={css.panel} data-git-panel="loading">{t('loading')}</div>
  }

  // The panel is per-session; without a git workspace there is nothing to
  // show — guide the user instead of leaving a blank panel.
  if (state.status.kind === 'failed' && state.status.message.includes('not a git repository')) {
    return (
      <div className={css.panel} data-git-panel="no-workspace">
        <header className={css.header}>
          <span className={css.headTitle}><IconBranchOutline16 /> {t('type.label')}</span>
        </header>
        <div className={css.note}>{t('noWorkspace')}</div>
      </div>
    )
  }

  // A fresh draft lands in the commit box once; typing afterwards is the user's.
  useEffect(() => {
    if (state?.generated !== undefined) setMessage(state.generated)
  }, [state?.generated])

  const labels = labelsOf(t)
  const status: GitStatusState = state.status
  let header: ReactNode
  let body: ReactNode
  if (status.kind === 'ready') {
    const { changes, staged } = groupsOf(status.view)
    const clean = changes.length === 0 && staged.length === 0
    header = (
      <div className={css.branch}>
        <IconBranchOutline16 className={css.branchIcon} />
        <span className={css.branchName}>{branchLine(status.view, t)}</span>
        <span className={css.upstream}>{status.view.upstream ?? ''}</span>
      </div>
    )
    body = clean
      ? <div className={css.note} data-git-panel="clean">{t('empty')}</div>
      : (
        <>
          {changes.length > 0 && (
            <section className={css.group} data-git-group="changes">
              <header className={css.groupHeader}>
                <span>{t('changes.title')} ({changes.length})</span>
                <button
                  type="button" className={css.groupAction} disabled={state.busy}
                  onClick={() => { stageAll(tabId, signal) }}
                >
                  {t('action.stageAll')}
                </button>
              </header>
              <ul className={css.list}>
                {changes.map(entry => (
                  <EntryRow
                    key={`c:${entry.path}`} entry={entry} staged={false} busy={state.busy} t={t}
                    selected={state.selected === entry.path && !state.selectedStaged}
                    onSelect={() => { openDiff(tabId, entry.path, false, signal) }}
                    onGesture={() => { stage(tabId, entry.path, signal) }}
                  />
                ))}
              </ul>
            </section>
          )}
          {staged.length > 0 && (
            <section className={css.group} data-git-group="staged">
              <header className={css.groupHeader}>
                <span>{t('staged.title')} ({staged.length})</span>
              </header>
              <ul className={css.list}>
                {staged.map(entry => (
                  <EntryRow
                    key={`s:${entry.path}`} entry={entry} staged busy={state.busy} t={t}
                    selected={state.selected === entry.path && state.selectedStaged}
                    onSelect={() => { openDiff(tabId, entry.path, true, signal) }}
                    onGesture={() => { unstage(tabId, entry.path, signal) }}
                  />
                ))}
              </ul>
            </section>
          )}
          <section className={css.commitArea}>
            <textarea
              className={css.commitInput} rows={2} value={message}
              placeholder={t('commit.placeholder')}
              onChange={(event) => { setMessage(event.target.value) }}
              data-git-input="message"
            />
            <div className={css.commitRow}>
              <button
                type="button" disabled={state.busy || state.generating || staged.length === 0}
                onClick={() => { generateMessage(tabId, labels, signal) }}
              >
                {state.generating ? t('loading') : t('action.generate')}
              </button>
              <button
                type="button" className={css.primary} disabled={state.busy || staged.length === 0 || message.trim() === ''}
                onClick={() => {
                  commit(tabId, message.trim(), labels, signal)
                  setMessage('')
                }}
              >
                {t('action.commit')}
              </button>
            </div>
            {staged.length === 0 && <div className={css.hint}>{t('commit.nothing')}</div>}
          </section>
        </>
      )
  } else if (status.kind === 'failed') {
    header = null
    body = (
      <div className={css.note} data-git-panel={status.denied ? 'denied' : 'failed'}>
        {status.denied ? t('error.denied') : status.message}
      </div>
    )
  } else {
    header = null
    body = <div className={css.note} data-git-panel="loading">{t('loading')}</div>
  }

  return (
    <div className={css.panel} data-git-panel="ready">
      <header className={css.header}>
        {header}
        <span className={css.headerActions}>
          <button
            type="button" className={css.iconAction} disabled={state.busy}
            aria-label={t('action.refresh')} title={t('action.refresh')}
            onClick={() => { refresh(tabId, signal) }}
          >
            <IconRefreshOutline16 />
          </button>
          <button
            type="button" className={css.iconAction} disabled={state.busy}
            onClick={() => { push(tabId, labels, signal) }}
          >
            {t('action.push')}
          </button>
        </span>
      </header>
      {state.notice !== undefined && <div className={css.notice} data-git-notice>{state.notice}</div>}
      {body}
      {state.status.kind === 'ready' && (
        <section className={css.group} data-git-group="checkpoints">
          <header className={css.groupHeader}>
            <span>{t('checkpoints.title')}</span>
          </header>
          {state.checkpoints.kind === 'loading' && <div className={css.note}>{t('checkpoints.loading')}</div>}
          {state.checkpoints.kind === 'ready' && state.checkpoints.checkpoints.length === 0 && (
            <div className={css.note}>{t('checkpoints.empty')}</div>
          )}
          {state.checkpoints.kind === 'ready' && state.checkpoints.checkpoints.length > 0 && (
            <ul className={css.list}>
              {state.checkpoints.checkpoints.map(checkpoint => (
                <li key={checkpoint.index} className={css.item} data-git-checkpoint={checkpoint.index}>
                  <span className={css.row} title={checkpoint.label}>
                    <span className={css.code}>{checkpoint.shortHash.slice(0, 7)}</span>
                    <span className={css.name}>{checkpoint.label}</span>
                  </span>
                  <button
                    type="button" className={css.gesture} disabled={state.busy}
                    aria-label={t('action.restore')} title={t('action.restore')}
                    onClick={() => { restoreCheckpoint(tabId, checkpoint.index, labels, signal) }}
                  >
                    {'↺'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className={css.diffArea} data-git-diff={state.diff.kind}>
        {state.diff.kind === 'idle' && <div className={css.note}>{t('diff.empty')}</div>}
        {state.diff.kind === 'loading' && <div className={css.note}>{t('diff.loading')}</div>}
        {state.diff.kind === 'failed' && <div className={css.note}>{t('diff.failed', { message: state.diff.message })}</div>}
        {state.diff.kind === 'ready' && (
          <>
            {state.diff.truncated && <div className={css.hint}>{t('diff.truncated')}</div>}
            <pre className={css.patch}>{state.diff.patch}</pre>
          </>
        )}
      </section>
    </div>
  )
}
