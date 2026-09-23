/**
 * The CUA confirmation gate and capability precheck: the first Computer-Use
 * tool call per session (screenshot or input simulation) asks the user for
 * approval through the approval seam; the decision is cached for the
 * session's lifetime. The capability precheck verifies the platform's
 * screen-capture command works before the first approval ask.
 *
 * @module @dsh-custom/dsh-cua-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-shell'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'cua-guard'

/** Services required by the guard. */
export const inject = ['tools', 'approval', 'shell']

/** The Computer-Use tool names this guard gates. */
export const CUA_TOOL_NAMES = ['screenshot', 'mouse_click', 'mouse_trajectory', 'mouse_scroll', 'keyboard_input'] as const

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Set false to pass every CUA call through without asking. */
  enabled?: boolean
  /** Re-ask after this many milliseconds; 0 (default) asks once per session. */
  reaskMs?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  reaskMs: z.number().default(0),
})

/** Per-session CUA approval state. */
interface CuaGrant {
  readonly allowed: boolean
  readonly at: number
}

/**
 * The platform's screen-capture availability probe: a shell command that
 * exits 0 when the capture capability exists on this platform.
 */
export function captureProbeCommand(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return 'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SystemInformation]::VirtualScreen | Out-Null"'
  }
  if (platform === 'darwin') return 'which screencapture'
  return 'which import'
}

export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  const reaskMs = config.reaskMs ?? 0
  const cuaTools = new Set<string>(CUA_TOOL_NAMES)

  /** Session-id → latest decision. */
  const grants = new Map<SessionId, CuaGrant>()
  /** Whether the platform probe ran and passed. */
  let platformReady: boolean | undefined

  /** The capability precheck: verify screen capture works on this host. */
  const precheck = async (signal?: AbortSignal): Promise<boolean> => {
    if (platformReady !== undefined) return platformReady
    try {
      const spec = ctx.shell.resolve({ command: captureProbeCommand(process.platform), timeoutMs: 10_000, signal })
      const result = await ctx.shell.run(spec)
      platformReady = result.exitCode === 0
    } catch {
      platformReady = false
    }
    return platformReady
  }

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    if (!cuaTools.has(exec.name)) return next()
    const agent = exec.agent
    if (agent === undefined) return next()

    // A cached non-expired grant passes; a cached rejection denies.
    const cached = grants.get(agent.session.id)
    const now = Date.now()
    if (cached !== undefined) {
      if (!cached.allowed) {
        return { kind: 'deny', reason: 'CUA was rejected for this session. Restart the session to re-enable.' }
      }
      if (reaskMs === 0 || now - cached.at < reaskMs) return next()
    }

    // The capability precheck: no approval prompt on a host that cannot capture.
    const ready = await precheck(exec.signal)
    if (!ready) {
      return {
        kind: 'deny',
        reason: `Screen capture is not available on this ${process.platform} host (the capture tool was not found). CUA tools are disabled.`,
      }
    }

    // Ask the user through the approval seam (inside the turn, like bash escalation).
    const outcome = await ctx.approval.request({
      agent,
      toolName: exec.name,
      callId: exec.callId,
      reason: 'Allow the agent to use Computer-Use tools (screenshots, mouse, keyboard) on this machine?',
    })

    if (outcome === 'allowed-once') {
      grants.set(agent.session.id, { allowed: true, at: now })
      return next()
    }
    grants.set(agent.session.id, { allowed: false, at: now })
    return { kind: 'deny', reason: 'CUA was rejected. The agent will not control your screen in this session.' }
  })

  // Drop cached grants when a session is disposed.
  ctx.on('session/disposed', (session) => {
    grants.delete(session.id)
  })
}
