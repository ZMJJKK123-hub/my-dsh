/**
 * The composed-host automation service: the table-and-scheduler base with the
 * webhook-recipe runner — each fire creates one ordinary workspace session
 * (titled by the task), configures its presets, and submits the prompt.
 * Prompt admission ends the runner's ownership: the agent follows normal
 * session behavior from there.
 *
 * @module @dsh-custom/dsh-automations
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type { AutomationRecord } from './store.ts'
import { AutomationService } from './service.ts'

/** The permission preset a task carries when it names none. */
const DEFAULT_PERMISSION_PRESET = 'workspace-write'

export class RunnerAutomationService extends AutomationService {
  static inject = [
    'agents',
    'agentDefaultModel',
    'agentPresets',
    'permissionPresets',
    'sessionTitle',
    'workspaceRegistry',
  ]

  /** Aborted when the plugin unloads: no run outlives its host. */
  private readonly runSignal = new AbortController()

  constructor(ctx: Context, config: Record<string, unknown> = {}) {
    super(ctx, config)
    ctx.effect(() => () => this.runSignal.abort(), 'automations: runner lifetime')
  }

  override async execute(record: AutomationRecord): Promise<void> {
    const ctx = this.ctx
    const signal = this.runSignal.signal
    const permissionPreset = record.permissionPreset ?? DEFAULT_PERMISSION_PRESET
    ctx.permissionPresets.resolve(permissionPreset)
    const presetId = record.agentPreset ?? ctx.agentPresets.defaultId
    const preset = await ctx.agentPresets.resolve(presetId)
    await ctx.agentPresets.standingKeyFor(preset.id)
    signal.throwIfAborted()

    const workspace = await ctx.workspaceRegistry.create(record.workspacePath)
    signal.throwIfAborted()
    const sessionId = brandString<SessionId>(`automation-${randomUUID()}`)
    const selection = ctx.agentDefaultModel.currentSelection()
    const handle = await ctx.agents.create({
      sessionId,
      signal,
      meta: { cwd: workspace.path, agentPreset: preset.id },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx) => {
        await ctx.agentPresets.mount(agentCtx, preset.id)
      },
    })

    let attached = false
    try {
      signal.throwIfAborted()
      await workspace.attachSession(sessionId)
      attached = true
      signal.throwIfAborted()
      ctx.permissionPresets.set(handle.agent.session, permissionPreset)
      ctx.sessionTitle.rename(handle.agent.session, record.title)
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: record.prompt }],
        source: { kind: 'plugin', plugin: 'dsh-automations' },
      }))
    } catch (error: unknown) {
      if (attached) {
        try {
          await workspace.detachSession(sessionId)
        } catch (rollbackError: unknown) {
          ctx.logger.warn(`automations: workspace detach for session ${String(sessionId)} failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
        }
      }
      try {
        await handle.dispose()
      } catch (rollbackError: unknown) {
        ctx.logger.warn(`automations: agent disposal for session ${String(sessionId)} failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }
      throw error
    }
  }
}

export default RunnerAutomationService
