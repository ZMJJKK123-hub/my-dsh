/**
 * Browser half: mount the `automationsRemote` Remote namespace (api-remotes
 * selects a fixed list and does not include it), then register the
 * automations tab type and its body under the keyed `sidebar.right.pane.tab`
 * seat.
 * @module @dsh-custom/dsh-client-ui-automations/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the sidebarRightTabs registry merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import automationsRemoteClient from '@dsh-custom/dsh-automations-remote/remote'
import { AUTOMATIONS_ID, automationsDefinition } from './definition.ts'
import { automationsFace, type AutomationsRemoteFace } from './face.ts'
import { AutomationsBody } from './AutomationsBody.tsx'
import { en, zh } from './locales.ts'
import { createAutomationsStore } from './store.ts'

/** Copy namespace this package owns; the key-set merge lives in locales.ts. */
const NS = 'automationsPanel'

/** Required browser services: the slot registry, the tab registry, the Remote carrier, and copy. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote']

/**
 * Client plugin body: mount the Remote, register dictionaries, the tab type,
 * then its body.
 * @param ctx - client root context.
 * @returns disposer that unmounts the Remote namespace.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-automations: dictionaries')

  // Mount our own Remote namespace and read it via `ctx.get` (injecting the
  // very namespace this plugin mounts would deadlock).
  const unmountRemote = await ctx.remote.$mount(automationsRemoteClient)
  const mounted = ctx.get('remote.automationsRemote')
  if (mounted === undefined) {
    await unmountRemote()
    throw new Error('ui-automations: the automationsRemote Remote namespace did not mount')
  }
  const remote = mounted as unknown as AutomationsRemoteFace

  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(automationsDefinition(t)), 'ui-automations: automations type')

  const store = createAutomationsStore()
  const injectFace = automationsFace(remote)
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: AUTOMATIONS_ID, locale: NS, store, inject: injectFace },
    AutomationsBody,
  )), 'ui-automations: automations tab body')

  return async () => {
    await unmountRemote()
  }
}
