/**
 * Best-effort shadow checkpoint at every turn start: when a session with a
 * workspace enters a turn, one git checkpoint lands in the session's own
 * series before the turn's writes can happen. Checkpointing is strictly
 * best-effort — a failure logs a warning and never affects the agent turn —
 * and a workspace outside any git repository is simply skipped.
 *
 * @module @dsh-custom/dsh-checkpoint-watcher
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@dsh-custom/dsh-git'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'checkpoint-watcher'

/** Services required by the watcher. */
export const inject = ['git']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Set false to stop taking turn checkpoints without removing the row. */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

/**
 * Watch turn starts and checkpoint each one.
 * @param ctx - host context carrying the git seam and the session event feed.
 * @param config - the enabled switch.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/start') return
    const cwd = session.header.cwd
    if (cwd === undefined) return
    const turn = event.data.turn ?? 0
    const series = String(session.id)
    void ctx.git.checkpointCreate(cwd, { series, index: turn, label: `turn ${turn}` })
      .catch((error: unknown) => {
        ctx.logger.warn(
          `checkpoint watcher: turn ${turn} checkpoint failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  })
}
