/**
 * ChangeSet persistence: one JSONL file per session under the store root
 * (default `$DSH_HOME/changes/<sessionId>.jsonl`), each line one completed
 * turn's stored change set. History is trimmed to a configured maximum; the
 * session-level cumulative view replays the retained records.
 *
 * @module @dsh-custom/dsh-change-monitor
 */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ChangeSetSummary, StoredChangeSet, StoredFileChange, TurnSummary } from './types.ts'
/** Store behavior knobs. */
export interface ChangeSetStoreOptions {
  /** Directory holding one `<sessionId>.jsonl` per session. */
  readonly storeRoot: string
  /** Turns retained per session; older records are dropped. */
  readonly maxHistory: number
}
/**
 * JSONL change-set store. Appends are read-modify-write under a per-session
 * promise chain, so concurrent turn endings never interleave lines.
 */
export declare class ChangeSetStore {
  private readonly root
  private readonly maxHistory
  private readonly tails
  constructor(options: ChangeSetStoreOptions)
  /** The exact artifact path for one session. */
  pathOf(sessionId: SessionId): string
  /**
     * Append one completed turn's record, trimming the file to `maxHistory`
     * turns. Never rejects the caller's turn: failures are reported by the
     * caller's best-effort wrapper.
     * @param record - the stored change set to persist.
     */
  append(record: StoredChangeSet): Promise<void>
  /**
     * Load every retained record for one session, oldest first.
     * @param sessionId - session whose history to read.
     * @returns stored change sets in chronological order (empty when absent or unreadable).
     */
  loadTurns(sessionId: SessionId): Promise<StoredChangeSet[]>
  /** Read and parse the raw artifact; a corrupt tail line is dropped. */
  private loadRaw
  /**
     * The most recent retained record for one session.
     * @param sessionId - session whose latest turn to read.
     * @returns the latest record, or undefined when the session has none.
     */
  latest(sessionId: SessionId): Promise<StoredChangeSet | undefined>
  /** Sessions that have at least one retained record. */
  listSessions(): Promise<SessionId[]>
  /**
     * Remove one session's retained history. Absence is success.
     * @param sessionId - session whose artifact to delete.
     */
  remove(sessionId: SessionId): Promise<void>
}
/** Wire summary of one stored change set (no hunks, no retained content). */
export declare function summarizeChangeSet(record: StoredChangeSet): ChangeSetSummary
/** One history row for the panel. */
export declare function summarizeTurn(record: StoredChangeSet): TurnSummary
/**
 * Cumulative changes across every retained turn of one session: for each
 * file, the earliest retained before-state against the latest retained
 * after-state. A file that ended identical to its session baseline is
 * dropped, matching the per-turn unchanged rule.
 * @param turns - retained records, oldest first.
 * @returns the merged summary, or null when nothing changed cumulatively.
 */
export declare function mergeSessionChangeSets(turns: readonly StoredChangeSet[]): ChangeSetSummary | null
/** The stored file change whose content belongs to one record (read helper). */
export declare function storedFileOf(record: StoredChangeSet, path: string): StoredFileChange | undefined
//# sourceMappingURL=storage.d.ts.map
