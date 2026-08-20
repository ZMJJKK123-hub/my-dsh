// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChangeSetSummary, FileChange } from '@dsh-custom/dsh-change-monitor'
// Type-only: pulls the LocaleNamespaceMap augmentation declared by the plugin entry.
import type {} from '../src/client/index.ts'
import type { ChangeMonitorController } from '../src/client/controller.ts'
import { ChangesPanel } from '../src/client/ChangesPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t = makeTranslate(zh)

function summary(): ChangeSetSummary {
  return {
    sessionId: 'session' as ChangeSetSummary['sessionId'],
    turn: 1,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_500,
    root: '/workspace',
    files: [
      { path: 'a.py', status: 'modified', kind: 'text', additions: 2, deletions: 1, beforeSize: 3, afterSize: 4 },
      { path: 'b.py', status: 'added', kind: 'text', additions: 3, deletions: 0, beforeSize: 0, afterSize: 3 },
    ],
    additions: 5,
    deletions: 1,
  }
}

function fileForResult(path: string): FileChange {
  return {
    path,
    status: path === 'a.py' ? 'modified' : 'added',
    kind: 'text',
    additions: 2,
    deletions: 1,
    beforeSize: 3,
    afterSize: 4,
    hunks: [{
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 3,
      lines: [
        { kind: 'context', oldLine: 1, newLine: 1, text: 'x' },
        { kind: 'del', oldLine: 2, newLine: null, text: '-old' },
        { kind: 'add', oldLine: null, newLine: 2, text: '+new' },
      ],
    }],
  }
}

function fakeController(
  fileForMock: (turn: number, path: string) => Promise<FileChange | null> = async (_turn, path) => fileForResult(path),
): ChangeMonitorController {
  return {
    fileFor: fileForMock,
    summaryFor: vi.fn(),
    turns: vi.fn(),
    session: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as ChangeMonitorController
}

describe('ChangesPanel', () => {
  it('lists files with status letters and counts', () => {
    render(<ChangesPanel summary={summary()} controller={fakeController()} t={t} />)
    expect(screen.getByText('a.py')).toBeDefined()
    expect(screen.getByText('b.py')).toBeDefined()
    // Two +2/−1 rows exist (list + later diffs), so just assert presence.
    expect(screen.getAllByText('+2').length).toBeGreaterThan(0)
  })

  it('loads and renders a file diff on row click', async () => {
    const controller = fakeController()
    render(<ChangesPanel summary={summary()} controller={controller} t={t} />)
    fireEvent.click(screen.getByText('a.py'))
    expect(await screen.findByText('-old')).toBeDefined()
    expect(screen.getByText('+new')).toBeDefined()
  })

  it('renders no diff rows in the non-diffable session view', async () => {
    const fileForMock = vi.fn()
    const controller = fakeController(fileForMock)
    render(<ChangesPanel summary={summary()} controller={controller} diffable={false} t={t} />)
    fireEvent.click(screen.getByText('a.py'))
    expect(fileForMock).not.toHaveBeenCalled()
  })
})
