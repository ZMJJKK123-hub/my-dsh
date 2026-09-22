/**
 * Host half of the automations panel: presence only. The Loader needs this
 * package in the cordis graph so the browser bundle's `dsh.client` manifest
 * resolves; everything the panel does lives in `./client`.
 *
 * @module @dsh-custom/dsh-client-ui-automations
 */

export const name = 'ui-automations'

export function apply(): void {}
