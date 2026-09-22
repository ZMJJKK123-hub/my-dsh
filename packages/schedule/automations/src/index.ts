/**
 * Package barrel: the scheduler surface (service, store, cron) and the
 * composed-host default — the runner variant whose execute creates one
 * workspace session per fire. Tests that drive the scheduler semantics
 * import the base by name.
 *
 * @module @dsh-custom/dsh-automations
 */

export { CronError, cronMatches, nextCronTime, parseCron } from './cron.ts'
export type { CronFields } from './cron.ts'
export { AutomationStore, freshRecordIdentity } from './store.ts'
export type { AutomationRecord } from './store.ts'
export { AutomationService } from './service.ts'
export type { AutomationCreateOptions, AutomationUpdateOptions, Config } from './service.ts'
export { RunnerAutomationService } from './runner.ts'
export { default } from './runner.ts'
