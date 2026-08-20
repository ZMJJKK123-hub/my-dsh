/**
 * DiffViewer: one file's red-green inline diff with folded context. Deleted
 * lines get the error tint, added lines the success tint, context stays
 * neutral; a gutter shows the before/after line numbers exactly like a unified
 * diff. Long unchanged runs — the gap between two hunks, or a long context
 * segment inside one hunk — collapse to a "N lines skipped" marker, keeping
 * only `CONTEXT_KEEP` context lines at each change. Read-only by
 * construction: it renders stored hunks and never touches the workspace.
 */

import { useMemo, useState } from 'react'
import type { ChangeHunk, ChangeLine, FileChange } from '@dsh-custom/dsh-change-monitor'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './DiffViewer.module.css'

/** Context lines kept around each change when folding long unchanged runs. */
export const CONTEXT_KEEP = 5

/** One rendered diff row: a real line, or a folded "skipped" marker. */
type DiffRow =
  | { readonly kind: 'line'; readonly line: ChangeLine }
  | { readonly kind: 'skip'; readonly count: number }

/**
 * Fold one hunk's lines: a run of consecutive context lines longer than
 * `2 * CONTEXT_KEEP` keeps its head and tail and collapses the middle into one
 * skip marker. Changes are never folded.
 * @param hunk - stored hunk.
 * @returns rendered rows in order.
 */
export function foldHunk(hunk: ChangeHunk): DiffRow[] {
  const rows: DiffRow[] = []
  let contextRun: ChangeLine[] = []
  const flush = (): void => {
    if (contextRun.length === 0) return
    if (contextRun.length <= CONTEXT_KEEP * 2) {
      for (const line of contextRun) rows.push({ kind: 'line', line })
    } else {
      for (const line of contextRun.slice(0, CONTEXT_KEEP)) rows.push({ kind: 'line', line })
      rows.push({ kind: 'skip', count: contextRun.length - CONTEXT_KEEP * 2 })
      for (const line of contextRun.slice(-CONTEXT_KEEP)) rows.push({ kind: 'line', line })
    }
    contextRun = []
  }
  for (const line of hunk.lines) {
    if (line.kind === 'context') {
      contextRun.push(line)
    } else {
      flush()
      rows.push({ kind: 'line', line })
    }
  }
  flush()
  return rows
}

/**
 * Old-side lines skipped between two consecutive hunks (new-side gap when the
 * old side is degenerate, e.g. a file that only grew).
 * @param previous - the hunk that just ended.
 * @param next - the hunk that starts after the gap.
 * @returns skipped line count, or 0 when the hunks are adjacent.
 */
export function skippedBetween(previous: ChangeHunk, next: ChangeHunk): number {
  const oldGap = next.oldStart - (previous.oldStart + previous.oldLines)
  const newGap = next.newStart - (previous.newStart + previous.newLines)
  return Math.max(0, oldGap, newGap)
}

/** Build a copyable unified-diff text from the stored hunks. */
export function unifiedDiff(file: FileChange): string {
  const lines: string[] = []
  for (const hunk of file.hunks) {
    const oldRange = hunk.oldLines === 1 ? String(hunk.oldStart) : `${hunk.oldStart},${hunk.oldLines}`
    const newRange = hunk.newLines === 1 ? String(hunk.newStart) : `${hunk.newStart},${hunk.newLines}`
    lines.push(`@@ -${oldRange} +${newRange} @@`)
    for (const line of hunk.lines) {
      const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
      lines.push(`${sign}${line.text}`)
    }
  }
  return lines.join('\n')
}

/** One file's full diff: header (status, counts) plus folded hunk rows. */
export function DiffViewer({ file, t }: DiffViewerProps) {
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => unifiedDiff(file), [file])

  const handleCopySuccess = (): void => {
    setCopied(true)
    setTimeout(() => { setCopied(false) }, 1200)
  }
  const handleCopyFailure = (): void => {
    setCopied(false)
  }
  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(handleCopySuccess, handleCopyFailure)
  }

  const summary = file.summary ?? t('binary.summary')
  return (
    <div className={css.root}>
      <div className={css.header}>
        <span className={`${css.status} ${css[file.status]}`}>{statusLetter(file.status)}</span>
        <span className={css.path}>{file.path}</span>
        <span className={css.counts}>
          <span className={css.addCount}>+{file.additions}</span>
          <span className={css.delCount}>−{file.deletions}</span>
        </span>
        <button
          type="button"
          className={css.copy}
          onClick={copy}
        >
          {copied ? t('diff.copied') : t('diff.copy')}
        </button>
      </div>
      {file.hunks.length === 0
        ? (
          <div className={css.binary} data-changes-binary>
            <span className={css.binaryLabel}>{summary}</span>
            <span className={css.binarySizes}>
              {formatSize(file.beforeSize)} → {formatSize(file.afterSize)}
            </span>
          </div>
        )
        : (
          <div className={css.body} data-changes-diff>
            {file.hunks.map((hunk, index) => {
              const gap = index === 0 ? 0 : skippedBetween(file.hunks[index - 1]!, hunk)
              return (
                <div key={index}>
                  {gap > 0 && <SkipRow count={gap} t={t} />}
                  {foldHunk(hunk).map((row, rowIndex) => row.kind === 'skip'
                    ? <SkipRow key={`s${rowIndex}`} count={row.count} t={t} />
                    : <LineRow key={`l${rowIndex}`} line={row.line} />)}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

/** One folded "N lines skipped" marker row. */
function SkipRow({ count, t }: { count: number; t: DiffViewerProps['t'] }) {
  return (
    <div className={css.skipped} data-changes-skipped>
      {t('diff.skipped', { count: String(count) })}
    </div>
  )
}

/** One diff line row: gutter numbers, sign, text, and the kind tint. */
function LineRow({ line }: { line: ChangeLine }) {
  // Explicit property lookups, never a dynamic `css[`line${kind}`]` key: the
  // production bundle keeps the CSS module keys in their source casing, so a
  // template key would resolve undefined and silently drop the tint.
  const kindClass = line.kind === 'add'
    ? css.lineAdd
    : line.kind === 'del'
      ? css.lineDel
      : css.lineContext
  return (
    <div
      className={`${css.line} ${kindClass}`}
      data-kind={line.kind}
    >
      <span className={css.oldNo}>{line.oldLine ?? ''}</span>
      <span className={css.newNo}>{line.newLine ?? ''}</span>
      <span className={css.sign}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}</span>
      <span className={css.text}>{line.text || ' '}</span>
    </div>
  )
}

/** Full props of the diff viewer. */
export interface DiffViewerProps extends PropsLocale<typeof NS> {
  /** One stored file change with hunks. */
  file: FileChange
}

/** One-letter status, matching the changes-panel vocabulary. */
function statusLetter(status: FileChange['status']): string {
  return status === 'modified' ? 'M' : status === 'added' ? 'A' : 'D'
}

/** Compact byte formatting (B / KB / MB). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
