/**
 * Changes plugin, browser half: mounts the changeMonitor Remote namespace
 * (api-remotes does not include it), then registers the turn-tail changes row
 * under every completed turn. All data flows through a per-session
 * controller; every failure degrades to "no changes", never an error.
 * @module @dsh-custom/dsh-client-ui-change-monitor/client
 */

import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated changeMonitor Remote merge into ctx.remote.
import type {} from '@dsh-custom/dsh-change-monitor/remote'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merges (turnTail).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import changeMonitorRemote from '@dsh-custom/dsh-change-monitor/remote'
import { ChangeMonitorController, type ChangeMonitorRemote as ChangeMonitorRemoteShape } from './controller.ts'
import { ChangesRow } from './ChangesRow.tsx'
import type { ChangeMonitorInjected } from './slots.ts'
import { en, NS, zh, type ChangeMonitorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Changes-panel copy. */
    'changeMonitor': ChangeMonitorKey
  }
}

/** Required services: slot registry, Remote carrier, locale, the wire handle, and the session scope tree. */
export const inject = ['slots', 'remote', 'locale', 'connection', 'sessions']

/**
 * Client plugin body: mount the Remote, register dictionaries, and the
 * turn-tail changes row.
 * @param ctx - client root context.
 * @returns disposer that unmounts the Remote and drops every controller.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-change-monitor: dictionaries')

  // Mount our own Remote namespace: api-remotes selects a fixed list and does
  // not include changeMonitor, so this package mounts it at its own boundary.
  // The mounted namespace is an ordinary `remote.<name>` service; read it via
  // `ctx.get` — a dotted property read through the context proxy would demand
  // an `inject` declaration, and injecting the very namespace this plugin
  // mounts would deadlock.
  const unmountRemote = await ctx.remote.$mount(changeMonitorRemote)
  const remote = ctx.get('remote.changeMonitor')
  if (remote === undefined) {
    await unmountRemote()
    throw new Error('ui-change-monitor: the changeMonitor Remote namespace did not mount')
  }
  const changeMonitor = remote as unknown as ChangeMonitorRemoteShape

  const controllers = new Map<SessionId, ChangeMonitorController>()
  const controllerFor = (sessionId: SessionId): ChangeMonitorController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new ChangeMonitorController(changeMonitor, sessionId)
      controllers.set(sessionId, controller)
      // Drop the controller (and its cached diffs) when the session's scope
      // tears down: a removed session must not keep its files in memory for
      // the plugin lifetime. `scope` is undefined only for a session neither
      // listed nor already scoped — impossible while this entry renders.
      // The host dsh-session type merge shadows `sessions` in this program,
      // so the client ISessions face is restored explicitly for this call.
      const sessions = ctx.sessions as unknown as ISessions
      sessions.scope(sessionId)?.effect(() => () => {
        controllers.delete(sessionId)
      })
    }
    return controller
  }

  // A reconnect may serve a different host generation; cached diffs stay
  // valid only while the transport generation is stable.
  ctx.on('connection/reset', () => {
    for (const controller of controllers.values()) controller.invalidate()
  })

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: owner => ({ turn: owner.turn.turn }),
    locale: NS,
    inject: (sessionId): ChangeMonitorInjected => ({
      controller: () => controllerFor(sessionId),
    }),
  }, ChangesRow))

  return async () => {
    controllers.clear()
    await unmountRemote()
  }
}
