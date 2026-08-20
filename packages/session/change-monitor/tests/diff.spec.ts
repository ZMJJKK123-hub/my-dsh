import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_LINES, DEFAULT_MAX_DIFF_CELLS, diffText } from '../src/diff.ts'

const OPTIONS = { contextLines: DEFAULT_CONTEXT_LINES, maxCells: DEFAULT_MAX_DIFF_CELLS }

describe('diffText', () => {
  it('reports no hunks for identical text', () => {
    const diff = diffText('a\nb\nc\n', 'a\nb\nc\n', OPTIONS)
    expect(diff.hunks).toEqual([])
    expect(diff.additions).toBe(0)
    expect(diff.deletions).toBe(0)
  })

  it('diffs one changed line as -old +new', () => {
    const diff = diffText('def hello():\n    print("hello")\n', 'def hello():\n    print("hello world")\n', OPTIONS)
    expect(diff.additions).toBe(1)
    expect(diff.deletions).toBe(1)
    const hunk = diff.hunks[0]
    expect(hunk?.lines.some(line => line.kind === 'del' && line.text.includes('"hello"'))).toBe(true)
    expect(hunk?.lines.some(line => line.kind === 'add' && line.text.includes('"hello world"'))).toBe(true)
  })

  it('treats empty before as all-add', () => {
    const diff = diffText('', 'one\ntwo\n', OPTIONS)
    expect(diff.additions).toBe(2)
    expect(diff.deletions).toBe(0)
    const lines = diff.hunks[0]?.lines ?? []
    expect(lines.every(line => line.kind === 'add')).toBe(true)
    expect(lines[0]?.newLine).toBe(1)
  })

  it('treats empty after as all-delete', () => {
    const diff = diffText('one\ntwo\n', '', OPTIONS)
    expect(diff.additions).toBe(0)
    expect(diff.deletions).toBe(2)
    const lines = diff.hunks[0]?.lines ?? []
    expect(lines.every(line => line.kind === 'del')).toBe(true)
    expect(lines[0]?.oldLine).toBe(1)
  })

  it('preserves context lines around a localized change', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n') + '\n'
    const after = ['a', 'b', 'X', 'd', 'e', 'f'].join('\n') + '\n'
    const diff = diffText(before, after, OPTIONS)
    expect(diff.additions).toBe(1)
    expect(diff.deletions).toBe(1)
    const hunk = diff.hunks[0]
    const context = hunk?.lines.filter(line => line.kind === 'context')
    expect(context?.length).toBeGreaterThanOrEqual(2)
    // Context lines carry both old and new numbers.
    expect(context?.every(line => line.oldLine !== null && line.newLine !== null)).toBe(true)
  })

  it('splits distant changes into separate hunks', () => {
    const before = Array.from({ length: 30 }, (_, index) => `line${index}`).join('\n') + '\n'
    const after = Array.from({ length: 30 }, (_, index) => {
      if (index === 2) return 'changed-a'
      if (index === 25) return 'changed-b'
      return `line${index}`
    }).join('\n') + '\n'
    const diff = diffText(before, after, OPTIONS)
    expect(diff.hunks.length).toBe(2)
  })

  it('treats a trailing-newline-only change as invisible', () => {
    // The final newline belongs to the last line's terminator, so a file
    // rewritten with the same lines but a different final newline shows no diff.
    const diff = diffText('a\n', 'a', OPTIONS)
    expect(diff.hunks).toEqual([])
  })

  it('strips CRLF so pure EOL style changes are invisible', () => {
    const diff = diffText('a\r\nb\r\n', 'a\nb\n', OPTIONS)
    expect(diff.hunks).toEqual([])
  })

  it('degrades to whole-region hunks beyond the cell budget with no shared anchor', () => {
    const before = Array.from({ length: 6000 }, (_, index) => `a${index}`)
    const after = Array.from({ length: 6000 }, (_, index) => `b${index}`)
    const diff = diffText(before.join('\n'), after.join('\n'), { contextLines: 3, maxCells: 1000 })
    expect(diff.additions).toBe(6000)
    expect(diff.deletions).toBe(6000)
  })

  it('keeps untouched runs as context for a large file with a localized edit', () => {
    // The middle product far exceeds the cell budget, but shared anchor lines
    // let the bisect keep every unchanged line as context instead of one
    // whole-file replace hunk.
    const before = Array.from({ length: 4000 }, (_, index) => `line${index}`)
    const after = before.map((line, index) => index === 2000 ? 'changed' : line)
    const diff = diffText(before.join('\n'), after.join('\n'), { contextLines: 3, maxCells: 1000 })
    expect(diff.additions).toBe(1)
    expect(diff.deletions).toBe(1)
    // One hunk around the change, carrying its context.
    expect(diff.hunks.length).toBe(1)
    const context = diff.hunks[0]?.lines.filter(line => line.kind === 'context') ?? []
    expect(context.length).toBeGreaterThan(0)
  })

  it('splits a large file with two distant edits into two hunks', () => {
    const before = Array.from({ length: 4000 }, (_, index) => `line${index}`)
    const after = before.map((line, index) => index === 1000 || index === 3000 ? `changed${index}` : line)
    const diff = diffText(before.join('\n'), after.join('\n'), { contextLines: 3, maxCells: 1000 })
    expect(diff.additions).toBe(2)
    expect(diff.deletions).toBe(2)
    expect(diff.hunks.length).toBe(2)
  })
})
