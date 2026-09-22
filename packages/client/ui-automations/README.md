# @dsh-custom/dsh-client-ui-automations

English | [中文](README.zh.md)

Machine-level cron automations panel for the Web Client: a right-sidebar tab listing every automation (title, cron, next run, last outcome) with enable/disable, run-now, and delete per row, plus a create form (title, cron, absolute workspace, prompt) — all driven by the `automationsRemote` namespace.

## How it works

- Mounts the `automationsRemote` namespace itself (`ctx.remote.$mount`), then registers the `automations` tab type and its body under the keyed `sidebar.right.pane.tab` seat.
- Panel state is a Slot-standard exclusive store (one instance per session), bucketed by tab: the list, a busy guard, and one notice line.
- The face unwraps both envelopes and writes renderable failures; every mutation refreshes the list.

## Config

None.

## Model Experience

None, as this package registers no tools and no model-visible context; it renders the automation table the `automationsRemote` namespace serves.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- No per-automation change events: the panel refreshes on mount, on gesture, and by the refresh button.
- The create form takes raw cron text; a field-level expression helper and a workspace picker are later additions.
