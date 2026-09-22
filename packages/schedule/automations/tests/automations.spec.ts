import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AutomationService, AutomationStore, CronError } from '../src/index.ts'
import type { AutomationRecord } from '../src/index.ts'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-automations-spec-'))
const WORKSPACE = join(scratch, 'work')

/** Test surface over the protected scheduler internals. */
class TestService extends AutomationService {
  exposeStore(): AutomationStore {
    return this.store
  }

  tickNow(): Promise<void> {
    return this.tick()
  }
}

/** The scheduler with a recording executor: no agent is created. */
class RecordingService extends TestService {
  readonly runs: AutomationRecord[] = []
  /** Resolves when the executor was entered; the test decides its duration. */
  private entered?: (() => void) | undefined

  executeDelayMs = 0

  protected override async execute(record: AutomationRecord): Promise<void> {
    this.runs.push(record)
    this.entered?.()
    this.entered = undefined
    if (this.executeDelayMs > 0) await new Promise(resolve => setTimeout(resolve, this.executeDelayMs))
  }

  /** Wait until the next executor entry. */
  onceRunFires(): Promise<void> {
    return new Promise((resolve) => { this.entered = resolve })
  }
}

/** Mount a recording scheduler. */
async function setupRecording(root: string, config: Record<string, unknown> = {}): Promise<RecordingService> {
  const ctx = new Context()
  await ctx.plugin(RecordingService, { storeRoot: join(scratch, root), tickMs: 60_000, ...config })
  return ctx.automations as RecordingService
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('AutomationStore', () => {
  it('round-trips records through the file and starts empty when absent', async () => {
    const file = AutomationStore.defaultFile(join(scratch, 'store-a'))
    const store = new AutomationStore(file)
    await store.load()
    expect(store.list()).toEqual([])
    const record: AutomationRecord = {
      id: 'one',
      createdAt: '2026-09-22T00:00:00.000Z',
      title: 'nightly',
      workspacePath: WORKSPACE,
      prompt: 'run the checks',
      cron: '0 3 * * *',
      enabled: true,
      nextRunAt: '2026-09-23T03:00:00.000Z',
      lastRunAt: null,
    }
    await store.put(record)
    const reloaded = new AutomationStore(file)
    await reloaded.load()
    expect(reloaded.get('one')).toEqual(record)
    await reloaded.delete('one')
    expect(reloaded.list()).toEqual([])
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
  })
})

describe('AutomationService', () => {
  it('creates, updates, and removes automations with computed schedules', async () => {
    const service = await setupRecording('svc-a')
    const created = await service.create({
      title: 'nightly checks', workspacePath: WORKSPACE, prompt: 'run the checks', cron: '0 3 * * *',
    })
    expect(created.enabled).toBe(true)
    expect(created.nextRunAt).not.toBeNull()
    // A cron change recomputes the schedule from now.
    const updated = await service.update(created.id, { cron: '30 4 * * *', enabled: false })
    expect(updated.enabled).toBe(false)
    expect(updated.cron).toBe('30 4 * * *')
    expect(await service.list()).toHaveLength(1)
    await service.remove(created.id)
    expect(await service.list()).toHaveLength(0)
    await expect(service.create({ title: 'x', workspacePath: 'relative', prompt: 'p', cron: '* * * * *' })).rejects.toThrow()
    await expect(service.create({ title: 'x', workspacePath: WORKSPACE, prompt: 'p', cron: 'bad' })).rejects.toThrow(CronError)
  })

  it('fires a task once, keeps the schedule advanced, and refuses overlapping runs', async () => {
    const service = await setupRecording('svc-b')
    const created = await service.create({
      title: 'every minute', workspacePath: WORKSPACE, prompt: 'tick', cron: '* * * * *',
    })

    service.executeDelayMs = 300
    const fired = service.onceRunFires()
    const first = service.runNow(created.id)
    await fired
    // A second fire while the first is still executing is refused.
    await expect(service.runNow(created.id)).rejects.toThrow('already running')
    await first

    const settled = service.exposeStore().get(created.id)
    expect(settled?.lastOutcome).toBe('ok')
    // The schedule stayed ahead of the fired minute.
    expect(settled && settled.nextRunAt !== null ? Date.parse(settled.nextRunAt) : 0).toBeGreaterThan(Date.now() - 1_000)
    expect(service.runs).toHaveLength(1)
  })

  it('skips a misfired run past the grace window instead of firing stale', async () => {
    const service = await setupRecording('svc-c', { misfireGraceMs: 60_000 })
    const created = await service.create({
      title: 'stale', workspacePath: WORKSPACE, prompt: 'old', cron: '0 3 * * *',
    })
    // Pretend the run came due an hour ago.
    const stale: AutomationRecord = {
      ...service.exposeStore().get(created.id)!,
      nextRunAt: new Date(Date.now() - 3_600_000).toISOString(),
    }
    await service.exposeStore().put(stale)
    await service.tickNow()
    expect(service.runs).toHaveLength(0)
    const advanced = service.exposeStore().get(created.id)!
    expect(Date.parse(advanced.nextRunAt!)).toBeGreaterThan(Date.now())
  })

  it('records a failed run without throwing to the scheduler', async () => {
    const ctx = new Context()
    class FailingService extends TestService {
      protected override async execute(): Promise<void> {
        throw new Error('boom')
      }
    }
    await ctx.plugin(FailingService, { storeRoot: join(scratch, 'svc-d'), tickMs: 60_000 })
    const service = ctx.automations as FailingService
    const created = await service.create({
      title: 'broken', workspacePath: WORKSPACE, prompt: 'x', cron: '* * * * *',
    })
    await expect(service.runNow(created.id)).rejects.toThrow('boom')
    const settled = service.exposeStore().get(created.id)!
    expect(settled.lastOutcome).toBe('error')
    expect(settled.lastError).toBe('boom')
  })

  it('default executor throws the not-mounted error', async () => {
    const ctx = new Context()
    await ctx.plugin(AutomationService, { storeRoot: join(scratch, 'svc-e'), tickMs: 60_000 })
    const created = await ctx.automations.create({
      title: 'raw', workspacePath: WORKSPACE, prompt: 'x', cron: '* * * * *',
    })
    await expect(ctx.automations.runNow(created.id)).rejects.toThrow('no executor')
  })
})
