/**
 * Inject face shared by the turn-tail row and the history action.
 * @module @dsh-custom/dsh-client-ui-change-monitor/client
 */

import type { ChangeMonitorController } from './controller.ts'

/** Registration-side injected face: a controller getter for the session. */
export interface ChangeMonitorInjected {
  /** Per-session changes controller (created on first use). */
  controller: () => ChangeMonitorController
}
