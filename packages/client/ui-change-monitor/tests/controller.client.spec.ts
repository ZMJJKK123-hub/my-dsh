import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ChangeFileResult, ChangeSetSummary, ChangeSummaryResult,
} from '@dsh-custom/dsh-change-monitor'
import { ChangeMonitorController, type ChangeMonitorRemote } from '../src/client/controller.ts'

const SESSION = 'session' as never

function summary(turn: number): ChangeSetSummary {
  return {
    sessionId: SESSION,
    turn,
    startedAt: 1,
    finishedAt: 2,
    root: '/w',
    files: [],
    additions: 0,
    deletions: 0,
  }
}

// The generated Remote face wraps the host's business result in the carrier
// RemoteResult envelope; these fixtures mirror that two-layer shape.
const SUMMARY_RESULT: ChangeSummaryResult = { ok: true, value: summary(1) }
const FILE_RESULT: ChangeFileResult = {
  ok: true,
  value: { path: 'a.ts', status: 'modified', kind: 'text', additions: 1, deletions: 1, beforeSize: 1, afterSize: 2, hunks: [] },
}
const SUMMARY_CARRIED: RemoteResult<ChangeSummaryResult> = { ok: true, value: SUMMARY_RESULT }
const FILE_CARRIED: RemoteResult<ChangeFileResult> = { ok: true, value: FILE_RESULT }

/** A remote whose answers can be scripted per call. */
function fakeRemote(overrides: Partial<ChangeMonitorRemote> = {}): ChangeMonitorRemote {
  return {
    turn: vi.fn(async () => SUMMARY_CARRIED),
    file: vi.fn(async () => FILE_CARRIED),
    ...overrides,
  }
}

describe('ChangeMonitorController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a ready summary without polling', async () => {
    const controller = new ChangeMonitorController(fakeRemote(), SESSION)
    const value = await controller.summaryFor(1)
    expect(value?.turn).toBe(1)
  })

  it('polls while the host is still settling, then caches', async () => {
    let calls = 0
    const turn = vi.fn(async (): Promise<RemoteResult<ChangeSummaryResult>> => {
      calls += 1
      return calls < 3 ? { ok: true, value: { ok: true, value: null } } : { ok: true, value: { ok: true, value: summary(1) } }
    })
    const remote = fakeRemote({ turn })
    const controller = new ChangeMonitorController(remote, SESSION)
    const pending = controller.summaryFor(1)
    for (let round = 0; round < 5; round += 1) {
      await vi.advanceTimersByTimeAsync(250)
      await Promise.resolve()
    }
    const value = await pending
    expect(value?.turn).toBe(1)
    expect(calls).toBe(3)
    // The second call hits the cache without any remote traffic.
    await controller.summaryFor(1)
    expect(calls).toBe(3)
  })

  it('degrades to null after the poll budget is exhausted', async () => {
    const turn = vi.fn(async (): Promise<RemoteResult<ChangeSummaryResult>> => ({ ok: true, value: { ok: true, value: null } }))
    const remote = fakeRemote({ turn })
    const controller = new ChangeMonitorController(remote, SESSION)
    const pending = controller.summaryFor(1)
    // Fast phase: 40 × 250ms, then slow phase: 240 × 2000ms.
    await vi.advanceTimersByTimeAsync(250 * 41 + 2000 * 241)
    expect(await pending).toBeNull()
  })

  it('keeps polling into the slow phase for a late settle', async () => {
    let calls = 0
    const turn = vi.fn(async (): Promise<RemoteResult<ChangeSummaryResult>> => {
      calls += 1
      return calls >= 45 ? { ok: true, value: { ok: true, value: summary(1) } } : { ok: true, value: { ok: true, value: null } }
    })
    const remote = fakeRemote({ turn })
    const controller = new ChangeMonitorController(remote, SESSION)
    const pending = controller.summaryFor(1)
    // Fast phase (40 attempts) resolves nothing; the 45th attempt lands in
    // the slow phase and must still be reached.
    await vi.advanceTimersByTimeAsync(250 * 45 + 2000 * 5)
    expect((await pending)?.turn).toBe(1)
  })

  it('caches file diffs and degrades failures to null', async () => {
    const file = vi.fn(async (): Promise<RemoteResult<ChangeFileResult>> =>
      ({ ok: true, value: { ok: false, error: { code: 'not-found', message: 'x' } } }))
    const remote = fakeRemote({ file })
    const controller = new ChangeMonitorController(remote, SESSION)
    expect(await controller.fileFor(1, 'missing.ts')).toBeNull()
    expect(await controller.fileFor(1, 'missing.ts')).toBeNull()
    expect(file).toHaveBeenCalledTimes(1)
  })

  it('invalidate drops every cached fact', async () => {
    const remote = fakeRemote()
    const controller = new ChangeMonitorController(remote, SESSION)
    await controller.summaryFor(1)
    await controller.fileFor(1, 'a.ts')
    controller.invalidate()
    await controller.summaryFor(1)
    await controller.fileFor(1, 'a.ts')
    expect(remote.turn).toHaveBeenCalledTimes(2)
    expect(remote.file).toHaveBeenCalledTimes(2)
  })
})
