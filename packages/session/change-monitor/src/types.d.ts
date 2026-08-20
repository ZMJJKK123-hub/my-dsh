/**
 * Data vocabulary of the per-turn change monitor: snapshot metadata, file
 * changes, change sets, and the Remote request/result contracts.
 *
 * @module @dsh-custom/dsh-change-monitor
 */
import type { SessionId } from '@deepseek-ai/dsh-session'
/** One changed file's classification: text diffed, binary, or above the diff size cap. */
export type ChangeFileKind = 'text' | 'binary' | 'large'
/** How a file changed across one turn: created, removed, or rewritten. */
export type ChangeStatus = 'added' | 'deleted' | 'modified'
/** One diff line with its before/after line numbers (null when absent on that side). */
export interface ChangeLine {
  readonly kind: 'context' | 'add' | 'del'
  readonly oldLine: number | null
  readonly newLine: number | null
  readonly text: string
}
/** One contiguous changed region of a file, with up to `contextLines` of context. */
export interface ChangeHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly ChangeLine[]
}
/** Complete record of one changed file in one turn. */
export interface FileChange {
  /** Workspace-relative path, forward slashes. */
  readonly path: string
  readonly status: ChangeStatus
  readonly kind: ChangeFileKind
  readonly additions: number
  readonly deletions: number
  readonly beforeSize: number
  readonly afterSize: number
  /** Text files under the diff cap carry hunks; binary/large carry a human summary. */
  readonly hunks: readonly ChangeHunk[]
  readonly summary?: string
}
/**
 * The durable record of one completed turn's file changes. `beforeContent` /
 * `afterContent` are retained only for text files under the diff size cap,
 * bounded by the configured history size, so the session-level cumulative
 * view can replay earlier states; they never cross the wire.
 */
export interface ChangeSet {
  readonly sessionId: SessionId
  readonly turn: number
  readonly startedAt: number
  readonly finishedAt: number
  /** Workspace root the relative paths are relative to. */
  readonly root: string
  readonly files: readonly FileChange[]
  readonly additions: number
  readonly deletions: number
}
/** Content retained off-wire for session-level replay. */
export interface ChangeSetContent {
  readonly beforeContent?: string
  readonly afterContent?: string
}
/** Stored file change: the wire-visible record plus retained before/after texts. */
export interface StoredFileChange extends FileChange {
  readonly beforeContent?: string
  readonly afterContent?: string
}
/** Stored change set: wire-visible record plus retained per-file content. */
export interface StoredChangeSet extends Omit<ChangeSet, 'files'> {
  readonly files: readonly StoredFileChange[]
}
/** Stable business failure codes for the changeMonitor Remote namespace. */
export type ChangeMonitorErrorCode = 'internal' | 'not-found' | 'invalid-path'
/** Wire-safe error branch shared by every changeMonitor Remote result. */
export interface ChangeError {
  readonly code: ChangeMonitorErrorCode
  readonly message: string
}
/** `changeMonitor.turns` result: completed turns, newest first. */
export type ChangeTurnsResult = {
  readonly ok: true
  readonly value: readonly TurnSummary[]
} | {
  readonly ok: false
  readonly error: ChangeError
}
/** `changeMonitor.current` / `turn` / `session` result: a summary or absence. */
export type ChangeSummaryResult = {
  readonly ok: true
  readonly value: ChangeSetSummary | null
} | {
  readonly ok: false
  readonly error: ChangeError
}
/** `changeMonitor.file` result: one file's full diff. */
export type ChangeFileResult = {
  readonly ok: true
  readonly value: FileChange
} | {
  readonly ok: false
  readonly error: ChangeError
}
/** One history row shown in the changes panel. */
export interface TurnSummary {
  readonly turn: number
  readonly startedAt: number
  readonly finishedAt: number
  readonly filesCount: number
  readonly additions: number
  readonly deletions: number
}
/** Wire-safe file list entry (hunks omitted until a file is opened). */
export interface FileChangeSummary {
  readonly path: string
  readonly status: ChangeStatus
  readonly kind: ChangeFileKind
  readonly additions: number
  readonly deletions: number
  readonly beforeSize: number
  readonly afterSize: number
  readonly summary?: string
}
/** Wire-safe change set without per-file hunks. */
export interface ChangeSetSummary {
  readonly sessionId: SessionId
  readonly turn: number
  readonly startedAt: number
  readonly finishedAt: number
  readonly root: string
  readonly files: readonly FileChangeSummary[]
  readonly additions: number
  readonly deletions: number
}
/** Discriminated Remote result envelope, mirroring the message-feedback pattern. */
export type ChangeMonitorResult<T> = {
  readonly ok: true
  readonly value: T
} | {
  readonly ok: false
  readonly error: ChangeError
}
/** `changeMonitor.turns` request: session whose turn history to read. */
export interface ChangeTurnsRequest {
  readonly sessionId: SessionId
}
/** `changeMonitor.current` request: session whose latest completed turn to read. */
export interface ChangeCurrentRequest {
  readonly sessionId: SessionId
}
/** `changeMonitor.turn` request: one exact completed turn. */
export interface ChangeTurnRequest {
  readonly sessionId: SessionId
  readonly turn: number
}
/** `changeMonitor.file` request: one file inside one completed turn. */
export interface ChangeFileRequest {
  readonly sessionId: SessionId
  readonly turn: number
  readonly path: string
}
/** `changeMonitor.session` request: cumulative changes across retained turns. */
export interface ChangeSessionRequest {
  readonly sessionId: SessionId
}
//# sourceMappingURL=types.d.ts.map
