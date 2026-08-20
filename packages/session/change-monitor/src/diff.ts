/**
 * Line-level text diffing for the change monitor: LCS-based edit scripts over
 * trimmed common prefixes/suffixes, rendered as context-bearing hunks with
 * per-line before/after numbers and add/delete counts. Degrades to whole-file
 * replacement hunks under a cell budget so a pathological input cannot hang
 * the turn.
 *
 * @module @dsh-custom/dsh-change-monitor
 */

import type { ChangeHunk, ChangeLine } from './types.ts'

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
 * Split text into normalized lines: CRLF is stripped, and a trailing final
 * newline does not produce a phantom empty line (the newline belongs to the
 * last line's terminator, so line counts match user intuition).
 */
function linesOf(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line !== undefined && line.endsWith('\r')) lines[index] = line.slice(0, -1)
  }
  return lines
}

/** One edit operation in the LCS trace. */
type EditOp = 'keep' | 'del' | 'add'

/**
 * Compute an edit script for `before` vs `after` with the classic LCS DP,
 * after trimming the common prefix and suffix so localized edits stay small.
 * A trimmed middle whose product exceeds `maxCells` is bisected at shared
 * anchor lines and diffed recursively, so large mostly-unchanged files still
 * produce hunks around the actual edits instead of one whole-region replace.
 */
function editScript(before: readonly string[], after: readonly string[], maxCells: number): EditOp[] {
  let prefix = 0
  const common = Math.min(before.length, after.length)
  while (prefix < common && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < common - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const midBefore = before.slice(prefix, before.length - suffix)
  const midAfter = after.slice(prefix, after.length - suffix)
  const n = midBefore.length
  const m = midAfter.length

  const ops: EditOp[] = []
  for (let index = 0; index < prefix; index += 1) ops.push('keep')
  if (n === 0 && m === 0) {
    for (let index = 0; index < suffix; index += 1) ops.push('keep')
    return ops
  }
  ops.push(...diffMiddle(midBefore, midAfter, maxCells))
  for (let index = 0; index < suffix; index += 1) ops.push('keep')
  return ops
}

/**
 * Diff the trimmed middle region. A small product runs the exact LCS; a large
 * one is bisected at a shared anchor line (a before line whose text also
 * occurs near the after middle) and each half recurses, so a big file with a
 * localized edit keeps its untouched runs as context instead of degrading to
 * one whole-region replace hunk. Only a middle with no shared anchor at all
 * falls back to replace-all.
 */
function diffMiddle(before: readonly string[], after: readonly string[], maxCells: number): EditOp[] {
  const n = before.length
  const m = after.length
  if (n === 0) return after.map(() => 'add' as const)
  if (m === 0) return before.map(() => 'del' as const)
  if (n * m <= maxCells) return lcsOps(before, after, maxCells)

  const afterIndex = new Map<string, number[]>()
  for (let index = 0; index < m; index += 1) {
    const line = after[index]!
    const positions = afterIndex.get(line)
    if (positions === undefined) afterIndex.set(line, [index])
    else positions.push(index)
  }
  // Probe around the before middle; the first shared line splits the region.
  const mid = Math.floor(n / 2)
  const probe = 8
  for (let offset = 0; offset <= probe; offset += 1) {
    for (const index of offset === 0 ? [mid] : [mid - offset, mid + offset]) {
      if (index < 0 || index >= n) continue
      const positions = afterIndex.get(before[index]!)
      if (positions === undefined || positions.length === 0) continue
      const afterIndex2 = positions.reduce((closest, position) =>
        Math.abs(position - m / 2) < Math.abs(closest - m / 2) ? position : closest, positions[0]!)
      const left = diffMiddle(before.slice(0, index), after.slice(0, afterIndex2), maxCells)
      const right = diffMiddle(before.slice(index + 1), after.slice(afterIndex2 + 1), maxCells)
      return [...left, 'keep', ...right]
    }
  }
  // No shared line anywhere near the middle: replace the whole region.
  return [...before.map(() => 'del' as const), ...after.map(() => 'add' as const)]
}

/** Exact LCS over a bounded region (the original DP with replace-all fallback). */
function lcsOps(before: readonly string[], after: readonly string[], maxCells: number): EditOp[] {
  const ops: EditOp[] = []
  const n = before.length
  const m = after.length
  const replaceAll = (): EditOp[] => {
    for (let index = 0; index < n; index += 1) ops.push('del')
    for (let index = 0; index < m; index += 1) ops.push('add')
    return ops
  }
  if (n * m > maxCells) return replaceAll()

  // LCS length table, row-major. Indices are bounded by the loop counters,
  // so the non-null assertions below express the in-bounds invariant.
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = 1; i <= n; i += 1) {
    const beforeLine = before[i - 1]
    for (let j = 1; j <= m; j += 1) {
      const cell = i * width + j
      const diag = (i - 1) * width + (j - 1)
      const up = (i - 1) * width + j
      const left = i * width + (j - 1)
      /* oxlint-disable-next-line typescript/no-non-null-assertion -- diag is a lower index, already filled */
      if (beforeLine === after[j - 1]) table[cell] = table[diag]! + 1
      /* oxlint-disable-next-line typescript/no-non-null-assertion -- up/left are lower indices, already filled */
      else table[cell] = Math.max(table[up]!, table[left]!)
    }
  }

  // Backtrack from (n,m). On a score tie the ADD branch is preferred so that
  // a replaced line traces as [add, del] and reverses to the unified-diff
  // order `-old` before `+new`; any other tie choice would swap them.
  let i = n
  let j = m
  const traced: EditOp[] = []
  while (i > 0 && j > 0) {
    if (before[i - 1] === after[j - 1]) {
      traced.push('keep')
      i -= 1
      j -= 1
    // oxlint-disable-next-line typescript/no-non-null-assertion -- both cells are within the filled table
    } else if (table[(i - 1) * width + j]! > table[i * width + (j - 1)]!) {
      traced.push('del')
      i -= 1
    } else {
      traced.push('add')
      j -= 1
    }
  }
  while (i > 0) {
    traced.push('del')
    i -= 1
  }
  while (j > 0) {
    traced.push('add')
    j -= 1
  }
  traced.reverse()
  ops.push(...traced)
  return ops
}

/**
 * Diff two texts at line granularity.
 * @param before - original text.
 * @param after - modified text.
 * @param options - context width and cell budget.
 * @returns hunks and aggregate counts.
 */
export function diffText(before: string, after: string, options: DiffOptions): TextDiff {
  const beforeLines = linesOf(before)
  const afterLines = linesOf(after)
  const ops = editScript(beforeLines, afterLines, options.maxCells)

  // Walk the ops, tracking old/new line positions; collect change positions,
  // then slice hunks around them with at most `contextLines` of context.
  const positions: Array<{ index: number; oldLine: number; newLine: number }> = []
  let oldLine = 1
  let newLine = 1
  let additions = 0
  let deletions = 0
  ops.forEach((op, index) => {
    if (op === 'add') {
      positions.push({ index, oldLine, newLine })
      newLine += 1
      additions += 1
    } else if (op === 'del') {
      positions.push({ index, oldLine, newLine })
      oldLine += 1
      deletions += 1
    } else {
      oldLine += 1
      newLine += 1
    }
  })

  if (positions.length === 0) return { hunks: [], additions, deletions }

  // Group changes: a new hunk starts when the old-side gap from the previous
  // change exceeds twice the context budget.
  const groups: Array<Array<{ index: number; oldLine: number; newLine: number }>> = []
  let group: Array<{ index: number; oldLine: number; newLine: number }> = []
  let lastOldLine: number | undefined
  for (const position of positions) {
    if (lastOldLine !== undefined && position.oldLine - lastOldLine > options.contextLines * 2) {
      groups.push(group)
      group = []
    }
    group.push(position)
    lastOldLine = position.oldLine
  }
  groups.push(group)

  const hunks: ChangeHunk[] = groups.map((changes) => {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- groups are non-empty by construction
    const first = changes[0]!
    // oxlint-disable-next-line typescript/no-non-null-assertion -- groups are non-empty by construction
    const last = changes[changes.length - 1]!
    // Slice bounds: context before the first change and after the last one.
    const start = Math.max(0, first.index - options.contextLines)
    const end = Math.min(ops.length, last.index + 1 + options.contextLines)
    const lines: ChangeLine[] = []
    let old = 1
    let newNumber = 1
    for (let index = 0; index < end; index += 1) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- index is bounded by end <= ops.length
      const op = ops[index]!
      // oxlint-disable-next-line typescript/no-non-null-assertion -- add consumes an after line, del/keep a before line
      const text = op === 'add' ? afterLines[newNumber - 1]! : beforeLines[old - 1]!
      if (index >= start) {
        if (op === 'add') {
          lines.push({ kind: 'add', oldLine: null, newLine: newNumber, text })
        } else if (op === 'del') {
          lines.push({ kind: 'del', oldLine: old, newLine: null, text })
        } else {
          lines.push({ kind: 'context', oldLine: old, newLine: newNumber, text })
        }
      }
      if (op === 'add') newNumber += 1
      else if (op === 'del') old += 1
      else {
        old += 1
        newNumber += 1
      }
    }
    const hunkOldStart = oldForIndex(start, ops, beforeLines.length)
    const hunkNewStart = newForIndex(start, ops, afterLines.length)
    const oldCount = lines.reduce((count, line) => count + (line.kind === 'del' || line.kind === 'context' ? 1 : 0), 0)
    const newCount = lines.reduce((count, line) => count + (line.kind === 'add' || line.kind === 'context' ? 1 : 0), 0)
    return {
      oldStart: hunkOldStart,
      oldLines: oldCount,
      newStart: hunkNewStart,
      newLines: newCount,
      lines,
    }
  })

  return { hunks, additions, deletions }
}

/** Old-side line number at one ops index. */
function oldForIndex(index: number, ops: readonly EditOp[], totalBefore: number): number {
  let old = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (ops[cursor] !== 'add') old += 1
  }
  return old > totalBefore ? Math.max(1, totalBefore) : old
}

/** New-side line number at one ops index. */
function newForIndex(index: number, ops: readonly EditOp[], totalAfter: number): number {
  let newNumber = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (ops[cursor] !== 'del') newNumber += 1
  }
  return newNumber > totalAfter ? Math.max(1, totalAfter) : newNumber
}

/** Default context width and cell budget used by the monitor. */
export const DEFAULT_CONTEXT_LINES = 5
export const DEFAULT_MAX_DIFF_CELLS = 25_000_000
