/**
 * The persisted automation table: one lossless-JSON file under the Harness
 * home, written atomically. The store is the single writer in this host
 * process; reads after load come from memory.
 *
 * @module @dsh-custom/dsh-automations
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** One machine-level automation. */
export interface AutomationRecord {
  /** Stable unique id. */
  readonly id: string
  /** Human label; becomes the session title of every run. */
  readonly title: string
  /** Absolute workspace path every run's session is created in. */
  readonly workspacePath: string
  /** The prompt submitted at every run. */
  readonly prompt: string
  /** The five-field cron expression, local time. */
  readonly cron: string
  /** Disabled tasks never fire but keep their schedule bookkeeping. */
  readonly enabled: boolean
  /** Agent preset id; omitted means the registry's default. */
  readonly agentPreset?: string
  /** Permission preset name; omitted means `workspace-write`. */
  readonly permissionPreset?: string
  readonly createdAt: string
  /** ISO timestamp of the next scheduled run; null when never computed. */
  readonly nextRunAt: string | null
  /** ISO timestamp of the last started run. */
  readonly lastRunAt: string | null
  /** The last run's outcome, once one has settled. */
  readonly lastOutcome?: 'ok' | 'error'
  /** The last failure's message, when the outcome was error. */
  readonly lastError?: string
}

/** The file's on-disk shape. */
interface StoreFile {
  readonly version: 1
  readonly tasks: readonly AutomationRecord[]
}

/**
 * Create a record's identity fields for a fresh automation.
 * @returns the id and timestamps a new record carries.
 */
export function freshRecordIdentity(): { id: string; createdAt: string } {
  return { id: randomUUID(), createdAt: new Date().toISOString() }
}

/**
 * The automation table.
 */
export class AutomationStore {
  private records = new Map<string, AutomationRecord>()

  /**
   * @param file - the JSON file backing the table; loaded lazily.
   */
  constructor(private readonly file: string) {}

  /** Load (or start empty when the file is absent). */
  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      this.records = new Map()
      return
    }
    const parsed: unknown = JSON.parse(text)
    const tasks = (parsed as StoreFile).tasks
    if (!Array.isArray(tasks)) {
      throw new Error(`automations store "${this.file}" is malformed`)
    }
    this.records = new Map(tasks.map(record => [record.id, record]))
  }

  /** Every record, in creation order. */
  list(): readonly AutomationRecord[] {
    return [...this.records.values()]
  }

  /** One record by id. */
  get(id: string): AutomationRecord | undefined {
    return this.records.get(id)
  }

  /** Insert or replace one record and persist. */
  async put(record: AutomationRecord): Promise<void> {
    this.records.set(record.id, record)
    await this.persist()
  }

  /** Delete one record and persist; a no-op when absent. */
  async delete(id: string): Promise<void> {
    if (!this.records.delete(id)) return
    await this.persist()
  }

  /** Write the table atomically. */
  private async persist(): Promise<void> {
    const storeFile: StoreFile = { version: 1, tasks: this.list() }
    await mkdir(dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify(storeFile, undefined, 2), { mode: 0o600 })
  }

  /** The store's default file location under the Harness home. */
  static defaultFile(root: string): string {
    return join(root, 'tasks.json')
  }
}
