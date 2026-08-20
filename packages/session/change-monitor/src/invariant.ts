/**
 * Package-owned invariant companion for `@dsh-custom/dsh-change-monitor`.
 * @module @dsh-custom/dsh-change-monitor/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-custom/dsh-change-monitor'

/** Cordis companion plugin name. */
export const name = 'change-monitor-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every ChangeSet is an independent best-effort
 * snapshot observation with no cross-event or mutable-data relationship that
 * other packages depend on.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
