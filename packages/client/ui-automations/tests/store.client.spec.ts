import { describe, expect, it } from 'vitest'
import { createAutomationsStore } from '../src/client/store.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const TAB = 'tab-1' as TabId

const VIEW = {
  id: 'auto-1',
  title: 'nightly',
  workspacePath: '/work/app',
  prompt: 'run the checks',
  cron: '0 3 * * *',
  enabled: true,
  nextRunAt: '2026-09-23T03:00:00.000Z',
  lastRunAt: null,
} as const

describe('createAutomationsStore', () => {
  it('mints an independent instance per call', () => {
    const first = createAutomationsStore().create()
    const second = createAutomationsStore().create()
    first.actions.start(TAB)
    expect(second.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('walks the list through loading, ready, and failed', () => {
    const store = createAutomationsStore().create()
    const { actions } = store
    actions.start(TAB)
    expect(store.getSnapshot().byTab[TAB]?.list).toEqual({ kind: 'loading' })
    actions.ready(TAB, [VIEW])
    expect(store.getSnapshot().byTab[TAB]?.list).toEqual({ kind: 'ready', automations: [VIEW] })
    actions.failed(TAB, 'cron is malformed')
    expect(store.getSnapshot().byTab[TAB]?.list).toEqual({ kind: 'failed', message: 'cron is malformed' })
  })

  it('tracks busy and notice, and forget drops the bucket', () => {
    const store = createAutomationsStore().create()
    const { actions } = store
    actions.start(TAB)
    actions.busy(TAB, true)
    expect(store.getSnapshot().byTab[TAB]?.busy).toBe(true)
    actions.busy(TAB, false)
    actions.notice(TAB, 'operation failed: boom')
    expect(store.getSnapshot().byTab[TAB]?.notice).toBe('operation failed: boom')
    actions.forget(TAB)
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })
})
