/**
 * ChangesPanel: one change set's file list with per-file counts, plus an
 * inline DiffViewer for the selected file. Loading and failure states stay
 * quiet — a missing record renders nothing.
 */

import { useState } from 'react'
import type { ChangeSetSummary, FileChange, FileChangeSummary } from '@dsh-custom/dsh-change-monitor'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangeMonitorController } from './controller.ts'
import { DiffViewer } from './DiffViewer.tsx'
import { NS } from './locales.ts'
import css from './ChangesPanel.module.css'

/** Full props of the change-set panel. */
export interface ChangesPanelProps extends PropsLocale<typeof NS> {
  /** The change set to render. */
  summary: ChangeSetSummary
  /** Controller that can fetch per-file diffs. */
  controller: ChangeMonitorController
  /** Whether per-file diffs are available (false for the merged session view). */
  diffable?: boolean
}

/**
 * File list plus inline diff. Clicking a row loads that file's hunks once and
 * keeps the viewer mounted while the row stays selected.
 */
export function ChangesPanel({ summary, controller, diffable = true, t }: ChangesPanelProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<FileChange | null | undefined>(undefined)

  const select = (path: string): void => {
    if (!diffable) return
    if (selected === path) {
      setSelected(null)
      return
    }
    setSelected(path)
    setFile(undefined)
    void controller.fileFor(summary.turn, path).then(setFile)
  }

  return (
    <div className={css.root} data-changes-panel>
      <ul className={css.list}>
        {summary.files.map(fileSummary => (
          <li key={fileSummary.path}>
            <button
              type="button"
              className={`${css.row} ${selected === fileSummary.path ? css.rowSelected : ''}`}
              onClick={() => { select(fileSummary.path) }}
              aria-expanded={selected === fileSummary.path}
            >
              <span className={`${css.status} ${css[fileSummary.status]}`}>{statusLetter(fileSummary.status)}</span>
              <span className={css.path}>{fileSummary.path}</span>
              <span className={css.counts}>
                <span className={css.addCount}>+{fileSummary.additions}</span>
                <span className={css.delCount}>−{fileSummary.deletions}</span>
              </span>
            </button>
            {selected === fileSummary.path && diffable && (
              <div className={css.diff}>
                {file === undefined
                  ? <div className={css.loading}>{t('history.loading')}</div>
                  : file === null
                    ? null
                    : <DiffViewer file={file} t={t} />}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One-letter status for the file list. */
export function statusLetter(status: FileChangeSummary['status']): string {
  return status === 'modified' ? 'M' : status === 'added' ? 'A' : 'D'
}
