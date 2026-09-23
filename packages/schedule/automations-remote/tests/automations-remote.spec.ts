import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
// Src imports until the workspace build refreshes this package's lib output.
import { AutomationService } from '../../automations/src/index.ts'
import AutomationsRemoteService from '../src/index.ts'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-auto-remote-spec-'))
const WORKSPACE = join(scratch, 'work')

/** Host harness: the base automation service (no runner) + the Remote service. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AutomationService, { storeRoot: join(scratch, 'tasks'), tickMs: 60_000 })
  await ctx.plugin(AutomationsRemoteService)
  return ctx
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('AutomationsRemoteService', () => {
  it('creates, lists, updates, fires, and removes through the namespace', async () => {
    const ctx = await setup()
    const created = await ctx.automationsRemote.create({
      title: 'nightly', workspacePath: WORKSPACE, prompt: 'run checks', cron: '0 3 * * *',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.enabled).toBe(true)
    expect(created.value.nextRunAt).not.toBeNull()

    const listed = await ctx.automationsRemote.list()
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.automations).toHaveLength(1)
    expect(listed.value.automations[0]?.title).toBe('nightly')

    const disabled = await ctx.automationsRemote.update({ id: created.value.id, enabled: false })
    expect(disabled.ok).toBe(true)
    if (!disabled.ok) return
    expect(disabled.value.enabled).toBe(false)

    // runNow against the base service's not-mounted executor: the failure
    // rides the discriminated result instead of rejecting.
    const fired = await ctx.automationsRemote.runNow({ id: created.value.id })
    expect(fired.ok).toBe(false)
    if (fired.ok) return
    expect(fired.error).toContain('no executor')

    const removed = await ctx.automationsRemote.deleteAutomation({ id: created.value.id })
    expect(removed.ok).toBe(true)
  })

  it('answers a malformed cron as a renderable failure', async () => {
    const ctx = await setup()
    const created = await ctx.automationsRemote.create({
      title: 'x', workspacePath: WORKSPACE, prompt: 'p', cron: 'not cron',
    })
    expect(created.ok).toBe(false)
    if (created.ok) return
    expect(created.error).toContain('cron')
  })
})
