/**
 * Remote exposure of the `ctx.automations` capability seam as the
 * `automationsRemote` Typert Remote namespace for the Web Client. Every
 * answer is a discriminated result (`ok` carries the wire view, `false`
 * carries the panel-renderable error); a Remote call never rejects.
 *
 * @module @dsh-custom/dsh-automations-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@dsh-custom/dsh-automations'
import type { AutomationRecord } from '@dsh-custom/dsh-automations'
import type {
  AutomationCreateRequest, AutomationIdRequest, AutomationListView, AutomationUpdateRequest,
  AutomationView, AutomationsRemoteResult,
} from './types.ts'

export type {
  AutomationCreateRequest, AutomationIdRequest, AutomationListView, AutomationUpdateRequest,
  AutomationView, AutomationsRemoteResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    automationsRemote: AutomationsRemoteService
  }
}

/**
 * Run one seam call and project it onto the wire result; any throw becomes
 * the honest failure the panel renders.
 * @param body - one seam call returning the wire view.
 */
async function answer<T>(body: () => Promise<T>): Promise<AutomationsRemoteResult<T>> {
  try {
    return { ok: true, value: await body() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Project one record onto its wire view. */
function viewOf(record: AutomationRecord): AutomationView {
  return {
    id: record.id,
    title: record.title,
    workspacePath: record.workspacePath,
    prompt: record.prompt,
    cron: record.cron,
    enabled: record.enabled,
    nextRunAt: record.nextRunAt,
    lastRunAt: record.lastRunAt,
    ...record.lastOutcome !== undefined ? { lastOutcome: record.lastOutcome } : {},
    ...record.lastError !== undefined ? { lastError: record.lastError } : {},
  }
}

export class AutomationsRemoteService extends TypertRemoteService {
  static inject = ['automations']

  constructor(ctx: Context) {
    super(ctx, 'automationsRemote')
  }

  /**
   * `automationsRemote.list`: every automation, in creation order.
   * @returns the list view, or the failure the panel renders.
   */
  @Remote('list')
  async list(): Promise<AutomationsRemoteResult<AutomationListView>> {
    return await answer(async () => {
      const automations = await this.ctx.automations.list()
      return { automations: automations.map(viewOf) }
    })
  }

  /**
   * `automationsRemote.create`: one automation; the first run time is computed.
   * @param request - title, absolute workspace, prompt, cron expression.
   * @returns the created view, or the failure the panel renders.
   */
  @Remote('create')
  async create(request: AutomationCreateRequest): Promise<AutomationsRemoteResult<AutomationView>> {
    return await answer(async () => viewOf(await this.ctx.automations.create(request)))
  }

  /**
   * `automationsRemote.update`: editable fields; a cron change recomputes the schedule.
   * @param request - the id and the fields to replace.
   * @returns the updated view, or the failure the panel renders.
   */
  @Remote('update')
  async update(request: AutomationUpdateRequest): Promise<AutomationsRemoteResult<AutomationView>> {
    return await answer(async () => {
      const { id, ...fields } = request
      return viewOf(await this.ctx.automations.update(id, fields))
    })
  }

  /**
   * `automationsRemote.deleteAutomation`: delete one automation.
   * @param request - the id to remove.
   * @returns an empty value, or the failure the panel renders.
   */
  @Remote('deleteAutomation')
  async deleteAutomation(request: AutomationIdRequest): Promise<AutomationsRemoteResult<null>> {
    return await answer(async () => {
      await this.ctx.automations.remove(request.id)
      return null
    })
  }

  /**
   * `automationsRemote.runNow`: fire one automation immediately, outside its schedule.
   * @param request - the id to fire.
   * @returns an empty value, or the failure the panel renders.
   */
  @Remote('runNow')
  async runNow(request: AutomationIdRequest): Promise<AutomationsRemoteResult<null>> {
    return await answer(async () => {
      await this.ctx.automations.runNow(request.id)
      return null
    })
  }
}

export default AutomationsRemoteService
