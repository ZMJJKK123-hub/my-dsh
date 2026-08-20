/**
 * Line-level text diffing for the change monitor: LCS-based edit scripts over
 * trimmed common prefixes/suffixes, rendered as context-bearing hunks with
 * per-line before/after numbers and add/delete counts. Degrades to whole-file
 * replacement hunks under a cell budget so a pathological input cannot hang
 * the turn.
 *
 * @module @dsh-custom/dsh-change-monitor
 */
import type { ChangeHunk } from './types.ts'
/** Diff engine behavior knobs. */
export interface DiffOptions {
  /** Context lines kept around each changed region. */
  readonly contextLines: number
  /** Product of the trimmed middle's line counts above which we emit whole-region hunks. */
  readonly maxCells: number
}
/** One file's computed diff: hunks plus aggregate counts. */
export interface TextDiff {
  readonly hunks: readonly ChangeHunk[]
  readonly additions: number
  readonly deletions: number
}
/**
 * Diff two texts at line granularity.
 * @param before - original text.
 * @param after - modified text.
 * @param options - context width and cell budget.
 * @returns hunks and aggregate counts.
 */
export declare function diffText(before: string, after: string, options: DiffOptions): TextDiff
/** Default context width and cell budget used by the monitor. */
export declare const DEFAULT_CONTEXT_LINES = 5
export declare const DEFAULT_MAX_DIFF_CELLS = 25000000
//# sourceMappingURL=diff.d.ts.map
