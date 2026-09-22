/**
 * Stage one of this package's registration: what the `automations` tab type
 * IS — a page, not a viewer; every action stays inside the panel.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { IconAlarmClockOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** The tab kind this package owns. */
export const AUTOMATIONS_KIND = 'automations'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const AUTOMATIONS_ID = '@dsh-custom/dsh-client-ui-automations'

/**
 * The automations type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function automationsDefinition(t: TranslateNS<'automationsPanel'>): SidebarRightTabDefinition {
  return {
    id: AUTOMATIONS_ID,
    kind: AUTOMATIONS_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      order: 30,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconAlarmClockOutline16,
    }],
  }
}
