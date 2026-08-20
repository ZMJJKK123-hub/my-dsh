// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChangeSetSummary } from '@dsh-custom/dsh-change-monitor'
// Type-only: pulls the LocaleNamespaceMap augmentation declared by the plugin entry.
import type {} from '../src/client/index.ts'
import type { ChangeMonitorController } from '../src/client/controller.ts'
import { ChangesRow, type ChangesRowProps } from '../src/client/ChangesRow.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t = makeTranslate(zh)

function summary(): ChangeSetSummary {
  return {
    sessionId: 'session' as ChangeSetSummary['sessionId'],
    turn: 3,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_500,
    root: '/workspace',
    files: [
      { path: 'core/compact.py', status: 'modified', kind: 'text', additions: 4, deletions: 2, beforeSize: 3, afterSize: 5 },
    ],
    additions: 4,
    deletions: 2,
  }
}

function props(controller: ChangeMonitorController, turn = 3): ChangesRowProps {
  return {
    turn: { turn, steps: [], data: new Map() } as unknown as ChangesRowProps['turn'],
    matched: { turn },
    controller: () => controller,
    t,
  }
}

describe('ChangesRow', () => {
  it('shows a computing placeholder while the summary loads', () => {
    const controller = { summaryFor: vi.fn(() => new Promise(() => undefined)) } as unknown as ChangeMonitorController
    render(<ChangesRow {...props(controller)} />)
    expect(screen.getByText('正在计算更改…')).toBeDefined()
  })

  it('shows a quiet confirmation when the turn changed no files', async () => {
    const controller = { summaryFor: vi.fn(async () => ({ ...summary(), files: [] })) } as unknown as ChangeMonitorController
    render(<ChangesRow {...props(controller)} />)
    await screen.findByText('当前目录下没有文件更改')
  })

  it('shows the confirmation when the record is missing entirely', async () => {
    const controller = { summaryFor: vi.fn(async () => null) } as unknown as ChangeMonitorController
    render(<ChangesRow {...props(controller)} />)
    await screen.findByText('当前目录下没有文件更改')
  })

  it('renders the summary line and expands the panel', async () => {
    const controller = { summaryFor: vi.fn(async () => summary()) } as unknown as ChangeMonitorController
    render(<ChangesRow {...props(controller)} />)
    await screen.findByText('1 个文件被修改')
    expect(screen.getByText('+4')).toBeDefined()
    await act(async () => {
      fireEvent.click(screen.getByText('查看更改'))
      await Promise.resolve()
    })
    expect(screen.getByText('core/compact.py')).toBeDefined()
  })
})
