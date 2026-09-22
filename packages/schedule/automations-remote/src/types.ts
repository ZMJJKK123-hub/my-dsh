/**
 * Wire types of the `automationsRemote` Typert Remote namespace. Automations
 * are machine-level, so requests carry no session id; every answer is a
 * discriminated result — a Remote call never rejects. The view types are
 * this package's own wire contract: mutable arrays and omitted-when-absent
 * optional fields.
 *
 * @module @dsh-custom/dsh-automations-remote
 */

/** One Remote answer: the value, or the failure the panel renders. */
export type AutomationsRemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

/** One automation as the panel sees it. */
export interface AutomationView {
  readonly id: string
  readonly title: string
  readonly workspacePath: string
  readonly prompt: string
  readonly cron: string
  readonly enabled: boolean
  readonly nextRunAt: string | null
  readonly lastRunAt: string | null
  readonly lastOutcome?: 'ok' | 'error'
  readonly lastError?: string
}

/** List view. */
export interface AutomationListView {
  readonly automations: readonly AutomationView[]
}

/** Create request: the fields a new automation carries. */
export interface AutomationCreateRequest {
  readonly title: string
  readonly workspacePath: string
  readonly prompt: string
  readonly cron: string
}

/** Update request: the editable fields; a cron change recomputes the schedule. */
export interface AutomationUpdateRequest {
  readonly id: string
  readonly title?: string
  readonly prompt?: string
  readonly cron?: string
  readonly enabled?: boolean
}

/** Id-carrying requests. */
export interface AutomationIdRequest {
  readonly id: string
}
