/**
 * Node half of the change-monitor UI plugin. The browser half does all the
 * work; this empty apply keeps the package loadable in host-side contexts
 * (the `dsh.client` manifest marks the browser face).
 * @module @dsh-custom/dsh-client-ui-change-monitor
 */

export function apply(): void {}
