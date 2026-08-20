// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChangeHunk, FileChange } from '@dsh-custom/dsh-change-monitor'
// Type-only: pulls the LocaleNamespaceMap augmentation declared by the plugin entry.
import type {} from '../src/client/index.ts'
import { DiffViewer, foldHunk, formatSize, skippedBetween, unifiedDiff } from '../src/client/DiffViewer.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t = makeTranslate(zh)

function file(over: Partial<FileChange> = {}): FileChange {
  return {
    path: 'core/compact.py',
    status: 'modified',
    kind: 'text',
    additions: 2,
    deletions: 1,
    beforeSize: 12,
    afterSize: 15,
    hunks: [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 4,
        lines: [
          { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
          { kind: 'del', oldLine: 2, newLine: null, text: 'old' },
          { kind: 'add', oldLine: null, newLine: 2, text: 'new' },
          { kind: 'add', oldLine: null, newLine: 3, text: 'extra' },
        ],
      },
    ],
    ...over,
  }
}

describe('DiffViewer', () => {
  it('renders the header with status, path, and counts', () => {
    render(<DiffViewer file={file()} t={t} />)
    expect(screen.getByText('core/compact.py')).toBeDefined()
    expect(screen.getByText('+2')).toBeDefined()
    expect(screen.getByText('−1')).toBeDefined()
  })

  it('renders del lines with the deletion tint and add lines with the addition tint', () => {
    const { container } = render(<DiffViewer file={file()} t={t} />)
    const del = container.querySelector('[data-kind="del"]')
    const add = container.querySelectorAll('[data-kind="add"]')
    expect(del?.textContent).toContain('old')
    expect(add.length).toBe(2)
    // CSS-module class names are hashed; the tint comes from the lineDel /
    // lineAdd rules, pinned by the data-kind attribute above.
    const delClass = del?.className ?? ''
    const addClass = add[0]?.className ?? ''
    expect(delClass).toContain('lineDel')
    expect(addClass).toContain('lineAdd')
  })

  it('shows a size-only summary for binary files', () => {
    const binary = file({
      kind: 'binary',
      status: 'added',
      additions: 0,
      deletions: 0,
      hunks: [],
      summary: 'Binary file changed',
    })
    const { container } = render(<DiffViewer file={binary} t={t} />)
    expect(screen.getByText('Binary file changed')).toBeDefined()
    // Sizes render across separate spans; assert the joined text.
    expect(container.textContent).toMatch(/12 B\s*→\s*15 B/)
  })

  it('copies a unified diff on the copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<DiffViewer file={file()} t={t} />)
    fireEvent.click(screen.getByText('复制 Diff'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('@@ -1,3 +1,4 @@'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('-old'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('+new'))
  })
})

describe('unifiedDiff', () => {
  it('renders hunks with headers and signs', () => {
    const text = unifiedDiff(file())
    expect(text).toContain('@@ -1,3 +1,4 @@')
    expect(text).toContain(' a\n-old\n+new\n+extra')
  })
})

describe('foldHunk', () => {
  function hunk(contextBefore: number, contextAfter: number): ChangeHunk {
    const lines = [
      ...Array.from({ length: contextBefore }, (_, i) => ({ kind: 'context' as const, oldLine: i + 1, newLine: i + 1, text: `c${i}` })),
      { kind: 'del' as const, oldLine: contextBefore + 1, newLine: null, text: 'old' },
      { kind: 'add' as const, oldLine: null, newLine: contextBefore + 1, text: 'new' },
      ...Array.from({ length: contextAfter }, (_, i) => ({ kind: 'context' as const, oldLine: contextBefore + 2 + i, newLine: contextBefore + 2 + i, text: `d${i}` })),
    ]
    return { oldStart: 1, oldLines: contextBefore + contextAfter + 1, newStart: 1, newLines: contextBefore + contextAfter + 1, lines }
  }

  it('keeps short context runs intact', () => {
    // Two context runs (before and after the change), each short.
    const rows = foldHunk(hunk(2, 2))
    expect(rows.filter(row => row.kind === 'line')).toHaveLength(6)
    expect(rows.some(row => row.kind === 'skip')).toBe(false)
  })

  it('folds a long context run to head, marker, tail', () => {
    const rows = foldHunk(hunk(12, 2))
    const skipped = rows.filter(row => row.kind === 'skip')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.kind === 'skip' && skipped[0].count).toBe(12 - 2 * 5)
    const lines = rows.filter(row => row.kind === 'line')
    // 5 head + 5 tail context + del + add, plus the two trailing context lines.
    expect(lines).toHaveLength(14)
  })

  it('keeps the first and last five context lines of a long run', () => {
    const rows = foldHunk(hunk(30, 0))
    const texts = rows.filter(row => row.kind === 'line').map(row => row.kind === 'line' ? row.line.text : '')
    expect(texts[0]).toBe('c0')
    expect(texts[4]).toBe('c4')
    expect(texts[5]).toBe('c25')
    expect(texts[9]).toBe('c29')
    expect(texts[10]).toBe('old')
    expect(texts[11]).toBe('new')
    const skipped = rows.find(row => row.kind === 'skip')
    expect(skipped?.kind === 'skip' && skipped.count).toBe(20)
  })
})

describe('skippedBetween', () => {
  it('reports the old-side gap between two hunks', () => {
    const first: ChangeHunk = { oldStart: 1, oldLines: 6, newStart: 1, newLines: 6, lines: [] }
    const second: ChangeHunk = { oldStart: 20, oldLines: 3, newStart: 20, newLines: 3, lines: [] }
    expect(skippedBetween(first, second)).toBe(13)
  })

  it('reports the new-side gap when the old side is degenerate', () => {
    const first: ChangeHunk = { oldStart: 1, oldLines: 0, newStart: 1, newLines: 5, lines: [] }
    const second: ChangeHunk = { oldStart: 1, oldLines: 0, newStart: 12, newLines: 3, lines: [] }
    expect(skippedBetween(first, second)).toBe(6)
  })

  it('reports zero for adjacent hunks', () => {
    const first: ChangeHunk = { oldStart: 1, oldLines: 6, newStart: 1, newLines: 6, lines: [] }
    const second: ChangeHunk = { oldStart: 7, oldLines: 3, newStart: 7, newLines: 3, lines: [] }
    expect(skippedBetween(first, second)).toBe(0)
  })
})

describe('DiffViewer folding', () => {
  it('renders a skipped marker between distant hunks', () => {
    const long = file({
      hunks: [
        { oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [
          { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
          { kind: 'del', oldLine: 2, newLine: null, text: 'old' },
          { kind: 'add', oldLine: null, newLine: 2, text: 'new' },
          { kind: 'add', oldLine: null, newLine: 3, text: 'extra' },
        ] },
        { oldStart: 50, oldLines: 2, newStart: 51, newLines: 2, lines: [
          { kind: 'context', oldLine: 50, newLine: 51, text: 'x' },
          { kind: 'del', oldLine: 51, newLine: null, text: 'gone' },
        ] },
      ],
    })
    render(<DiffViewer file={long} t={t} />)
    expect(screen.getByText('⋯ 此处省略 46 行')).toBeDefined()
  })

  it('renders a skipped marker for a long context run inside one hunk', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ kind: 'context' as const, oldLine: i + 1, newLine: i + 1, text: `c${i}` }))
    const single = file({
      hunks: [{
        oldStart: 1,
        oldLines: 22,
        newStart: 1,
        newLines: 22,
        lines: [
          ...rows,
          { kind: 'del', oldLine: 21, newLine: null, text: 'old' },
          { kind: 'add', oldLine: null, newLine: 21, text: 'new' },
        ],
      }],
    })
    render(<DiffViewer file={single} t={t} />)
    expect(screen.getByText('⋯ 此处省略 10 行')).toBeDefined()
    expect(screen.getByText('c0')).toBeDefined()
    expect(screen.getByText('c4')).toBeDefined()
    expect(screen.getByText('c15')).toBeDefined()
    expect(screen.getByText('c19')).toBeDefined()
  })
})

describe('formatSize', () => {
  it('formats bytes, kilobytes, and megabytes', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
