# @dsh-custom/dsh-automations-remote

English | [中文](README.zh.md)

Remote exposure of the `ctx.automations` capability seam as the `automationsRemote` Typert Remote namespace for the Web Client: `list`, `create`, `update` (including the enabled switch), `remove`, and `runNow`. Automations are machine-level, so requests carry no session id; every answer is a discriminated result — a Remote call never rejects.

## How it works

- Registers `AutomationsRemoteService` (a `TypertRemoteService`) as `ctx.automationsRemote`, wire namespace `automationsRemote`; the generated client mount for the browser half is the `./remote` export.
- Each method wraps one `ctx.automations` call; wire views are this package's own contract (mutable arrays, omitted-when-absent optionals).
- The Web Client mounts the namespace itself (`ctx.remote.$mount`), like `ui-change-monitor` does for `changeMonitor`.

## Config

None.

## Model Experience

None, as this package registers no tools and no model-visible context; it only carries the automation table to the Web Client.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- `runNow` failures ride the result (for example the not-mounted executor error in a bare composition); the panel renders the message.
- No per-automation change events: the panel refreshes on mount, on gesture, and by the refresh button.
