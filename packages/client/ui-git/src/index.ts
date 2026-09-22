/**
 * Host half of the source-control panel: presence only. The Loader needs this
 * package in the cordis graph so the browser bundle's `dsh.client` manifest
 * resolves; everything the panel does lives in `./client`.
 *
 * @module @dsh-custom/dsh-client-ui-git
 */

export const name = 'ui-git'

export function apply(): void {}
