# @dsh-custom/dsh-automations

English | [中文](README.zh.md)

Machine-level cron automations: a persisted task table under the Harness home, a due-tick scheduler with misfire grace and overlap protection, and one agent session per run — the webhook way. Tasks survive restarts; each fire creates a fresh workspace session titled by the task and submits its prompt.

## How it works

- `ctx.automations` exposes `list` / `create` / `update` / `remove` / `runNow`; `create` validates the five-field cron expression (pure Vixie-semantics parser in `src/cron.ts`, local time) and computes the first run.
- The scheduler ticks every `tickMs`: a due enabled record first advances its `nextRunAt` (a crash mid-run never re-fires the same minute), then fires once; the in-flight set keeps a slow run from piling up; a run more than `misfireGraceMs` stale is skipped as missed, not fired.
- The table persists atomically (`dsh-atomic-write`) at `<storeRoot>/tasks.json`; outcomes (`ok`/`error` + message) land on the record.
- The execution step is an overridable `execute` method: this package's default throws the not-mounted error, and the composed host wires the agent-session runner; tests drive a recording subclass.

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
- The runner (agent session creation) is composed in the host bundle, not this package; the default `execute` throws until that wiring mounts.
