/**
 * Machine-level cron automations: a persisted task table, a due-tick
 * scheduler with misfire grace, and one agent session per run. Tasks are
 * workspace-scoped — each run creates a fresh session the webhook way and
 * submits the task's prompt — so scheduled work shows up in the Web Client
 * like any other session. The execution step is an overridable method:
 * this package's default implementation throws, and the runner wiring lands
 * with the base-bundle registration; tests drive a recording subclass.
 *
 * @module @dsh-custom/dsh-automations
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { isAbsolute } from 'node:path'
import { setInterval as plainSetInterval } from 'node:timers'
import { nextCronTime, parseCron } from './cron.ts'
import { AutomationStore, freshRecordIdentity, type AutomationRecord } from './store.ts'


/** What one automation creation supplies. */
export interface AutomationCreateOptions {
  readonly title: string
  readonly workspacePath: string
  readonly prompt: string
  readonly cron: string
  readonly agentPreset?: string
  readonly permissionPreset?: string
}

/** What one automation update may change. */
export interface AutomationUpdateOptions {
  readonly title?: string
  readonly prompt?: string
  readonly cron?: string
  readonly enabled?: boolean
  readonly agentPreset?: string
  readonly permissionPreset?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    automations: AutomationService
  }
}

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Store directory under (or alongside) the Harness home. */
  storeRoot?: string
  /** Scheduler tick interval in milliseconds. */
  tickMs?: number
  /** A run whose time came this long ago is skipped as missed, not fired. */
  misfireGraceMs?: number
}

type ResolvedConfig = Required<Config>

/**
 * The machine-level automation registry and scheduler. One tick scans the
 * enabled records; a due record advances its schedule first (so a crash
 * mid-run never re-fires the same minute) and then executes once. The
 * in-flight set keeps a slow run from piling up on the next tick.
 */
export class AutomationService extends Service {
  static Config: z<Config> = z.object({
    storeRoot: z.string(),
    tickMs: z.number().default(30_000),
    misfireGraceMs: z.number().default(600_000),
  })

  private readonly resolved: ResolvedConfig
  protected readonly store: AutomationStore
  private readonly inFlight = new Set<string>()
  private loaded = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'automations')
    this.resolved = {
      storeRoot: config.storeRoot ?? dshHomePath('automations'),
      tickMs: config.tickMs ?? 30_000,
      misfireGraceMs: config.misfireGraceMs ?? 600_000,
    }
    this.store = new AutomationStore(AutomationStore.defaultFile(this.resolved.storeRoot))
    // The interval is effect-owned: plugin disposal stops the ticks.
    const timer = plainSetInterval(() => { void this.tick() }, this.resolved.tickMs)
    ctx.effect(() => () => { clearInterval(timer) }, 'automations: scheduler tick')
    // One immediate tick once the store is loadable, without blocking construction.
    void this.tick()
  }

  /** Load the store once; later ticks reuse it. */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    await this.store.load()
    this.loaded = true
  }

  /** Every automation, in creation order. */
  async list(): Promise<readonly AutomationRecord[]> {
    await this.ensureLoaded()
    return this.store.list()
  }

  /**
   * Create one automation; the first run time is computed immediately.
   * @param options - the label, workspace, prompt, cron expression, presets.
   * @returns the created record.
   * @throws {@link CronError} on a malformed expression; Error on a relative
   * workspace path or empty fields.
   */
  async create(options: AutomationCreateOptions): Promise<AutomationRecord> {
    await this.ensureLoaded()
    if (options.title.trim() === '') throw new Error('automation title must be non-empty')
    if (options.prompt.trim() === '') throw new Error('automation prompt must be non-empty')
    if (!isAbsolute(options.workspacePath)) {
      throw new Error(`automation workspacePath must be absolute, got "${options.workspacePath}"`)
    }
    const fields = parseCron(options.cron)
    const identity = freshRecordIdentity()
    const record: AutomationRecord = {
      ...identity,
      title: options.title,
      workspacePath: options.workspacePath,
      prompt: options.prompt,
      cron: options.cron,
      enabled: true,
      ...options.agentPreset !== undefined ? { agentPreset: options.agentPreset } : {},
      ...options.permissionPreset !== undefined ? { permissionPreset: options.permissionPreset } : {},
      nextRunAt: nextCronTime(fields, new Date()).toISOString(),
      lastRunAt: null,
    }
    await this.store.put(record)
    return record
  }

  /**
   * Change one automation's editable fields; a cron change recomputes the
   * next run from now.
   * @param id - the automation to change.
   * @param options - the fields to replace.
   * @returns the updated record.
   * @throws Error when the automation is unknown.
   */
  async update(id: string, options: AutomationUpdateOptions): Promise<AutomationRecord> {
    await this.ensureLoaded()
    const current = this.store.get(id)
    if (current === undefined) throw new Error(`automation "${id}" not found`)
    const cron = options.cron ?? current.cron
    const nextRunAt = options.cron !== undefined
      ? nextCronTime(parseCron(cron), new Date()).toISOString()
      : current.nextRunAt
    const updated: AutomationRecord = {
      ...current,
      ...options.title !== undefined ? { title: options.title } : {},
      ...options.prompt !== undefined ? { prompt: options.prompt } : {},
      ...options.enabled !== undefined ? { enabled: options.enabled } : {},
      ...options.agentPreset !== undefined ? { agentPreset: options.agentPreset } : {},
      ...options.permissionPreset !== undefined ? { permissionPreset: options.permissionPreset } : {},
      cron,
      nextRunAt,
    }
    await this.store.put(updated)
    return updated
  }

  /**
   * Delete one automation.
   * @param id - the automation to remove.
   */
  async remove(id: string): Promise<void> {
    await this.ensureLoaded()
    await this.store.delete(id)
  }

  /**
   * Fire one automation now, outside its schedule; the schedule is untouched.
   * @param id - the automation to fire.
   * @throws Error when the automation is unknown or a run is already in flight.
   */
  async runNow(id: string): Promise<void> {
    await this.ensureLoaded()
    const record = this.store.get(id)
    if (record === undefined) throw new Error(`automation "${id}" not found`)
    await this.fire(record)
  }

  /**
   * One scheduler pass: advance or fire every due enabled record.
   */
  protected async tick(): Promise<void> {
    await this.ensureLoaded()
    const now = Date.now()
    for (const record of this.store.list()) {
      if (!record.enabled || record.nextRunAt === null) continue
      const dueAt = Date.parse(record.nextRunAt)
      if (Number.isNaN(dueAt) || dueAt > now) continue
      if (now - dueAt > this.resolved.misfireGraceMs) {
        // The host was away across the run time: skip the missed run(s) and
        // reschedule from now rather than firing a stale prompt.
        await this.advance(record, new Date(now))
        continue
      }
      if (this.inFlight.has(record.id)) continue
      await this.advance(record, new Date(now))
      // The tick owns the fire-and-forget: a failure was recorded and logged.
      void this.fire(record).catch(() => {})
    }
  }

  /** Move one record's schedule to its next run after `from` and persist. */
  private async advance(record: AutomationRecord, from: Date): Promise<AutomationRecord> {
    const next = nextCronTime(parseCron(record.cron), from)
    const updated: AutomationRecord = { ...record, nextRunAt: next.toISOString() }
    await this.store.put(updated)
    return updated
  }

  /** Run one automation once, recording the outcome either way. */
  private async fire(record: AutomationRecord): Promise<void> {
    if (this.inFlight.has(record.id)) throw new Error(`automation "${record.id}" is already running`)
    this.inFlight.add(record.id)
    try {
      await this.execute(record)
      await this.settle(record, { lastRunAt: new Date().toISOString(), lastOutcome: 'ok' as const })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      await this.settle(record, {
        lastRunAt: new Date().toISOString(),
        lastOutcome: 'error' as const,
        lastError: message,
      })
      this.ctx.logger.warn(`automation "${record.id}" run failed: ${message}`)
      throw error
    } finally {
      this.inFlight.delete(record.id)
    }
  }

  /** Merge one run outcome onto the record's CURRENT stored state. */
  private async settle(record: AutomationRecord, outcome: {
    lastRunAt: string
    lastOutcome: 'ok' | 'error'
    lastError?: string
  }): Promise<void> {
    const current = this.store.get(record.id) ?? record
    await this.store.put({
      ...current,
      lastRunAt: outcome.lastRunAt,
      lastOutcome: outcome.lastOutcome,
      ...outcome.lastError !== undefined ? { lastError: outcome.lastError } : {},
    })
  }

  /**
   * Execute one automation run. The default implementation throws — the
   * runner wiring (agent session creation, webhook style) replaces it in the
   * composed host, and tests drive a recording subclass.
   * @param record - the automation to run.
   */
  protected async execute(_record: AutomationRecord): Promise<void> {
    throw new Error('automations: no executor is mounted')
  }
}

export default AutomationService
