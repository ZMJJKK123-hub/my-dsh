/**
 * Runtime invariant companion for @dsh-custom/dsh-client-ui-background.
 * The plugin is pure browser presentation with no session-event or service
 * relationship to assert: it reads localStorage and paints the body, which
 * no other package observes. No runtime invariant.
 */

/** The empty invariant installer this package registers (no-op by design). */
export function install(): void {}
