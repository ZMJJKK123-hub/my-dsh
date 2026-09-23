/**
 * Host half of the Zai theme package: presence only. The Loader needs this
 * package in the cordis graph so the browser bundle's `dsh.client` manifest
 * resolves; the themes register in `./client`.
 *
 * @module @dsh-custom/dsh-client-ui-theme-zai
 */

export const name = 'ui-theme-zai'

export function apply(): void {}
