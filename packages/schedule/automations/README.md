# @dsh-custom/dsh-automations

English | [中文](README.zh.md)

Machine-level cron automations: a persisted task table under the Harness home, a due-tick scheduler with misfire grace and overlap protection, and one agent session per run — the webhook way. Tasks survive restarts; each fire creates a fresh workspace session titled by the task and submits its prompt.

## How it works

- `ctx.automations` exposes `list` / `create` / `update` / `remove` / `runNow`; `create` validates the five-field cron expression (pure Vixie-semantics parser in `src/cron.ts`, local time) and computes the first run.
- The scheduler ticks every `tickMs`: a due enabled record first advances its `nextRunAt` (a crash mid-run never re-fires the same minute), then fires once; the in-flight set keeps a slow run from piling up; a run more than `misfireGraceMs` stale is skipped as missed, not fired.
- The table persists atomically (`dsh-atomic-write`) at `<storeRoot>/tasks.json`; outcomes (`ok`/`error` + message) land on the record.
- The package default export is `RunnerAutomationService`, whose `execute` follows the webhook recipe: resolve the presets (permission default `workspace-write`, agent preset the registry default), create the workspace, create the agent session titled by the task, submit the prompt, and roll back the attachment on admission failure. The base `AutomationService` (named export) keeps the not-mounted executor for tests.

## Config

- `storeRoot` (default `~/.dsh/automations`): the table directory.
- `tickMs` (default `30000`): scheduler tick interval.
- `misfireGraceMs` (default `600000`): runs staler than this are skipped as missed.

## Model Experience

None, as this package registers no tools; each fired automation becomes an ordinary session whose prompt the model sees through the normal session flow.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Five numeric fields only: no month/day names, no `@`-shorthands, no per-user CRON_TZ — the host's local time is the schedule's time.
- One-minute resolution; a tick burst fires each due record at most once, and missed minutes are skipped, not replayed.
- The runner admits the prompt and hands ownership to the session lifecycle; it does not track the turn's completion (the run's outcome records admission, not the model's answer).
