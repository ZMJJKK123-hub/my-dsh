/**
 * ChangesRow: the turn-tail entry under a completed turn. It claims the chain
 * for every completed turn, loads that turn's change set from the Host, and
 * renders nothing when the turn changed no files — so a conversation only
 * ever grows a row the agent actually earned.
 */

import { useEffect, useState } from 'react'
import type { ChangeSetSummary } from '@dsh-custom/dsh-change-monitor'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ChangesPanel } from './ChangesPanel.tsx'
import type { ChangeMonitorInjected } from './slots.ts'
import { NS } from './locales.ts'
import css from './ChangesRow.module.css'

/** Selector match: the turn this tail belongs to. */
export interface ChangesRowMatch {
  readonly turn: number
}

/** Full props of the turn-tail changes row. */
export type ChangesRowProps =
  Pick<TurnTailOwnerProps, 'turn'> & {
    matched: ChangesRowMatch
  } & PropsLocale<typeof NS> & InjectFace<ChangeMonitorInjected>

/**
 * One turn's changes summary line with an expandable panel.
 * @param props - matched turn, locale seat, and the injected controller.
 * @returns the row: a "computing changes" placeholder while the Host
 * settles, the summary line when files changed, or null when the turn
 * changed nothing (or the poll budget ran out).
 */
export function ChangesRow({ matched, controller, t }: ChangesRowProps) {
  const [summary, setSummary] = useState<ChangeSetSummary | null | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSummary(undefined)
    void controller().summaryFor(matched.turn).then((value) => {
      if (!cancelled) setSummary(value)
    })
    return () => { cancelled = true }
  }, [controller, matched.turn])

  if (summary === undefined) {
    // The Host may still be settling (big workspaces take minutes); keep a
    // visible placeholder so the row reads as "working", not "missing".
    return (
      <div className={css.root} data-changes-row data-changes-loading>
        <div className={css.loading}>{t('history.loading')}</div>
      </div>
    )
  }
  if (summary === null || summary.files.length === 0) {
    // The settle finished and found nothing: show a quiet confirmation so a
    // turn with no workspace edits reads as "checked, nothing changed"
    // instead of an empty gap that looks like the plugin never fired.
    return (
      <div className={css.root} data-changes-row data-changes-none>
        <div className={css.noChanges}>{t('row.noChanges')}</div>
      </div>
    )
  }

  const filesLabel = summary.files.length === 1
    ? t('summary.files.one')
    : t('summary.files', { count: String(summary.files.length) })

  return (
    <div className={css.root} data-changes-row>
      <button
        type="button"
        className={css.trigger}
        onClick={() => { setExpanded(current => !current) }}
        aria-expanded={expanded}
      >
        <span className={css.files}>{filesLabel}</span>
        <span className={css.counts}>
          <span className={css.addCount}>+{summary.additions}</span>
          <span className={css.delCount}>−{summary.deletions}</span>
        </span>
        <span className={css.action}>{expanded ? t('row.hide') : t('row.view')}</span>
      </button>
      {expanded && (
        <div className={css.panel}>
          <ChangesPanel summary={summary} controller={controller()} t={t} />
        </div>
      )}
    </div>
  )
}
