/**
 * Per-turn file-change monitor: observes `session/event` for `turn/start` and
 * `turn/end`, snapshots the session workspace around each turn, diffs the two
 * snapshots at turn end, and persists the resulting change set. Exposes the
 * changeMonitor Remote namespace to the Web Client.
 *
 * The monitor is strictly best-effort: any failure inside snapshotting,
 * diffing, or storage is logged as a warning and never affects the agent
 * turn. Diff results are always computed from the turn's own before/after
 * snapshots, never from later disk state, so each turn's panel shows exactly
 * what that turn changed — including files the agent wrote and later restored
 * (those end up hash-equal and are reported as unchanged).
 *
 * @module @deepseek-ai/dsh-change-monitor
 */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ChangeFileRequest, ChangeFileResult, ChangeSessionRequest, ChangeSummaryResult, ChangeTurnsRequest, ChangeTurnsResult, ChangeTurnRequest } from './types.ts'
export * from './types.ts'
export { ChangeSetStore, mergeSessionChangeSets, summarizeChangeSet, summarizeTurn } from './storage.ts'
export { diffText } from './diff.ts'
export { DEFAULT_IGNORE_PATTERNS, compileIgnorePatterns } from './ignore.ts'
export { snapshotWorkspace, scanMetadata, readTextFile, sameMetadata } from './snapshot.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    changeMonitor: ChangeMonitorService
  }
}
/** Default per-file cap for hashing and diffing (10 MiB). */
export declare const DEFAULT_MAX_FILE_SIZE: number
/** Default stability wait between turn end and the final snapshot. */
export declare const DEFAULT_SETTLE_DELAY_MS = 200
/** Default settle re-scan attempts before giving up on stability. */
export declare const DEFAULT_SETTLE_MAX_ATTEMPTS = 5
/** Default turns retained per session in the history store. */
export declare const DEFAULT_MAX_HISTORY = 100
/** Plugin configuration; every knob has a default, nothing is required. */
export interface Config {
  /** Master switch; false disables snapshotting and the Remote returns empty history. */
  readonly enabled?: boolean
  /** Extra ignore patterns appended to {@link DEFAULT_IGNORE_PATTERNS}. */
  readonly exclude?: readonly string[]
  /** Patterns that re-admit excluded paths. */
  readonly include?: readonly string[]
  /** Files at or above this byte size are snapshotted by metadata only. */
  readonly maxSnapshotFileSize?: number
  /** Files at or above this byte size never get a text diff (size-only report). */
  readonly maxDiffFileSize?: number
  /** LCS cell budget above which a diff degrades to whole-file hunks. */
  readonly maxDiffCells?: number
  /** Context lines around each changed region. */
  readonly contextLines?: number
  /** Wait between the turn/end event and the first stability scan. */
  readonly settleDelayMs?: number
  /** Maximum stability re-scans before the final snapshot is taken anyway. */
  readonly settleMaxAttempts?: number
  /** Persist turn history to the store; false keeps only the latest in memory. */
  readonly historyEnabled?: boolean
  /** Turns retained per session. */
  readonly maxHistory?: number
  /** History directory override; defaults to `$DSH_HOME/changes`. */
  readonly storeRoot?: string
}
/**
 * The per-turn change monitor service. Listens to the durable session event
 * stream — `turn/start` opens a before snapshot, `turn/end` settles, re-scans
 * for stability, snapshots after, diffs, and stores. All of it runs inside
 * contained best-effort wrappers.
 */
export declare class ChangeMonitorService extends TypertRemoteService {
  static Config: z<Config>
  private readonly config
  private readonly ignore
  private readonly store
  private readonly states
  /**
     * Latest completed turn's summary per live session (the wire `current`
     * value without retained content). One small entry per session, dropped on
     * disposal; the full record lives only on disk.
     */
  private readonly latest
  /** Diagnostic ring: recent turn events, for runtime verification. */
  private readonly eventLog
  /**
     * @param ctx - host context carrying the session event feed.
     * @param config - plugin configuration (defaults apply).
     */
  constructor(ctx: Context, config?: Config)
  /** Best-effort wrapper: one failure logs a warning and never throws. */
  private bestEffort
  /** Snapshot the workspace at turn start; the diff needs this baseline. */
  private onTurnStart
  /** Settle, snapshot after, diff, and store — serialized per session. */
  private onTurnEnd
  /** Wait for quiescence, snapshot, diff, persist, and cache. */
  private settleAndDiff
  /**
     * Re-scan until the tree's metadata stops changing, bounded by attempts.
     * The git-candidate variant checks only the changed-path set (seconds on
     * huge trees); the full-tree variant walks everything.
     * @param root - workspace root.
     * @param candidates - git candidate paths (undefined = full-tree scan).
     */
  private waitForStability
  /**
     * Backfill before-snapshots for after-side paths absent from the before
     * snapshot: a file clean at turn start that the turn modified but did not
     * commit. Its turn-start content is exactly the turn-start git revision, so
     * `git show` supplies it; untracked new files (absent from that revision
     * too) stay before-less and the diff reports them as added.
     * @param root - workspace root.
     * @param before - the turn-start snapshot (read-only).
     * @param after - the turn-end candidate snapshot.
     * @param startHead - the git revision at turn start; falls back to HEAD.
     * @returns the before snapshot with the backfilled entries.
     */
  private backfillHeadBefore
  /**
     * Add committed added/modified/renamed paths to the after snapshot from
     * disk, so a clean-at-turn-start file that was committed mid-turn still
     * appears in the diff. Deleted paths stay absent and are represented on the
     * before side only.
     * @param root - workspace root.
     * @param after - the turn-end candidate snapshot.
     * @param committed - paths changed between turn-start HEAD and current HEAD.
     * @returns the after snapshot with committed paths added.
     */
  private mergeCommittedAfter
  /**
     * Add committed deleted/modified/renamed-old paths to the before snapshot
     * from the turn-start git revision, so the diff can report them as deleted
     * or modified. Added paths stay absent because they did not exist at turn
     * start.
     * @param root - workspace root.
     * @param before - the turn-start snapshot (read-only).
     * @param committed - paths changed between turn-start HEAD and current HEAD.
     * @param startHead - the git revision at turn start.
     * @returns the before snapshot with committed paths added.
     */
  private mergeCommittedBefore
  /** Compute the stored change set from the before/after snapshots. */
  private buildChangeSet
  /**
     * Diff one path's before/after states, or undefined when unchanged. The
     * before text comes from the retained turn-start snapshot; the after text
     * is read from disk at diff time (the after view holds hashes only).
     */
  private buildFileChange
  /**
     * `changeMonitor.turns`: completed turns, newest first.
     * @param request - session whose history to read.
     * @returns turn summaries or a structured failure.
     */
  turns(request: ChangeTurnsRequest): Promise<ChangeTurnsResult>
  /**
     * `changeMonitor.current`: the latest completed turn's summary.
     * @param request - session whose latest turn to read.
     * @returns the summary, or null when the session has no completed turn.
     */
  current(request: {
    sessionId: SessionId
  }): Promise<ChangeSummaryResult>
  /**
     * `changeMonitor.debug`: recent session/event arrivals (diagnostic surface).
     * @returns the last received turn events with timestamps.
     */
  debug(): Promise<{
    ok: true
    value: readonly {
      time: number
      session: string
      type: string
      turn: number
    }[]
  }>
  /**
     * `changeMonitor.turn`: one exact completed turn's summary.
     * @param request - session and turn number.
     * @returns the summary, or null when that turn has no record.
     */
  turn(request: ChangeTurnRequest): Promise<ChangeSummaryResult>
  /**
     * `changeMonitor.file`: one file's full diff inside one turn. The path must
     * be a safe workspace-relative path; anything else is `invalid-path`.
     * @param request - session, turn, and workspace-relative path.
     * @returns the file's complete change record with hunks.
     */
  file(request: ChangeFileRequest): Promise<ChangeFileResult>
  /**
     * `changeMonitor.session`: cumulative changes across every retained turn.
     * @param request - session whose cumulative changes to read.
     * @returns the merged summary, or null when nothing changed net.
     */
  session(request: ChangeSessionRequest): Promise<ChangeSummaryResult>
  /** Find one stored turn record. */
  private findTurn
  /** Contain a Remote operation: failures become structured `internal` errors. */
  private guard
}
export default ChangeMonitorService
//# sourceMappingURL=index.d.ts.map
