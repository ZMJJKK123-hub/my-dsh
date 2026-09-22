import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { RunnerAutomationService } from '../src/runner.ts'
import type { AutomationRecord } from '../src/index.ts'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-runner-spec-'))
const WORKSPACE = join(scratch, 'work')

/** One fake service registered under a fixed key. */
async function fakeService(ctx: Context, key: string, members: Record<string, unknown>): Promise<void> {
  const membersCapture = members
  class Fake extends Service {
    constructor(host: Context) {
      super(host, key)
      Object.assign(this, membersCapture)
    }
  }
  await ctx.plugin(Fake)
}

/** Everything the runner composes, recorded for assertions. */
/** One created session, as the fake world records it. */
interface CreatedSession {
  cwd: string
  preset: string
  provider: string
  model: string
  prompt: string
  title: string
  permission: string
}

interface RunnerWorld {
  readonly createdSessions: CreatedSession[]
  readonly attached: string[]
  disposed: number
}

async function mountWorld(root: string): Promise<{ ctx: Context; world: RunnerWorld }> {
  const ctx = new Context()
  const world: RunnerWorld = { createdSessions: [], attached: [], disposed: 0 }
  await fakeService(ctx, 'agentDefaultModel', {
    currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
  })
  await fakeService(ctx, 'agentPresets', {
    resolve: async (id: string) => ({ id }),
    standingKeyFor: async () => 'standing-key',
    mount: async () => {},
    get defaultId() { return 'standard' },
  })
  await fakeService(ctx, 'permissionPresets', {
    resolve: (name: string) => ({ name }),
    set: (session: { id: string }, name: string) => {
      const last = world.createdSessions[world.createdSessions.length - 1]
      if (last !== undefined) last.permission = name
      void session
    },
  })
  await fakeService(ctx, 'sessionTitle', {
    rename: (session: unknown, title: string) => {
      void session
      const last = world.createdSessions[world.createdSessions.length - 1]
      if (last !== undefined) last.title = title
    },
  })
  await fakeService(ctx, 'workspaceRegistry', {
    create: async (path: string) => ({
      path,
      attachSession: async (id: string) => { world.attached.push(id) },
      detachSession: async (id: string) => {
        const at = world.attached.indexOf(id)
        if (at >= 0) world.attached.splice(at, 1)
      },
    }),
  })
  await fakeService(ctx, 'agents', {
    create: async (options: {
      sessionId: string
      meta: { cwd: string; agentPreset: string }
      agentOptions: { provider: string; model: string }
      setup: (agentCtx: unknown) => Promise<void>
    }) => {
      await options.setup({})
      const record = {
        cwd: options.meta.cwd,
        preset: options.meta.agentPreset,
        provider: options.agentOptions.provider,
        model: options.agentOptions.model,
        prompt: '',
        title: '',
        permission: '',
      }
      world.createdSessions.push(record)
      return {
        agent: {
          session: { id: options.sessionId },
          followup: (message: { content: { text: string }[] }) => {
            record.prompt = message.content[0]?.text ?? ''
          },
        },
        dispose: async () => { world.disposed += 1 },
      }
    },
  })
  await ctx.plugin(RunnerAutomationService, { storeRoot: join(scratch, root), tickMs: 60_000 })
  return { ctx, world }
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('RunnerAutomationService', () => {
  it('creates a preset workspace session per fire and submits the prompt', async () => {
    const { ctx, world } = await mountWorld('runner-a')
    const created: AutomationRecord = await ctx.automations.create({
      title: 'nightly checks',
      workspacePath: WORKSPACE,
      prompt: 'run the checks',
      cron: '0 3 * * *',
    })
    await ctx.automations.runNow(created.id)
    expect(world.createdSessions).toHaveLength(1)
    expect(world.createdSessions[0]).toMatchObject({
      cwd: WORKSPACE,
      preset: 'standard',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      prompt: 'run the checks',
      title: 'nightly checks',
      permission: 'workspace-write',
    })
    expect(world.attached).toHaveLength(1)
    expect(world.disposed).toBe(0)
    const settled = (await ctx.automations.list()).find(record => record.id === created.id)
    expect(settled?.lastOutcome).toBe('ok')
  })

  it('rolls back the workspace attachment when admission fails', async () => {
    const { ctx, world } = await mountWorld('runner-b')
    // Break title renaming: the runner must detach and dispose.
    const title = ctx.get('sessionTitle') as unknown as { rename: () => void }
    title.rename = () => { throw new Error('title failed') }
    const created = await ctx.automations.create({
      title: 'broken', workspacePath: WORKSPACE, prompt: 'x', cron: '* * * * *',
    })
    await expect(ctx.automations.runNow(created.id)).rejects.toThrow('title failed')
    expect(world.attached).toHaveLength(0)
    expect(world.disposed).toBe(1)
    const settled = (await ctx.automations.list()).find(record => record.id === created.id)
    expect(settled?.lastOutcome).toBe('error')
    expect(settled?.lastError).toBe('title failed')
  })
})
