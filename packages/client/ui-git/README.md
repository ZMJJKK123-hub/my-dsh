# @dsh-custom/dsh-client-ui-git

English | [中文](README.zh.md)

Source-control panel for the Web Client: a right-sidebar tab showing the session repository's branch, ahead/behind counts, staged and unstaged change lists with per-file staging, a diff view for the selected file, a commit box with an AI-generate button (when the host row configures a model route), push, and a checkpoint list whose rows restore the work tree to that shadow checkpoint — all driven by the `gitRemote` Remote namespace.

## How it works

- Mounts the `gitRemote` namespace itself (`ctx.remote.$mount`), the way `ui-change-monitor` mounts `changeMonitor`, then registers the `git` tab type and its body under the keyed `sidebar.right.pane.tab` seat.
- The panel state lives in a Slot-standard exclusive store (one instance per session), bucketed by tab: status, the selected file's diff, a busy guard, and one notice line.
- The face unwraps both envelopes (the carrier `RemoteResult`, then the host's `GitRemoteResult`) and writes renderable failures — a `denied` answer shows the permission-preset hint instead of a raw error.
- Every action works against the session's own repository: requests carry only the session id; the host resolves the workspace.

## Config

None.

## Model Experience

None, as this package registers no tools and no model-visible context; it renders repository facts the `gitRemote` namespace serves.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The diff view renders the patch as plain monospace text; a hunk-level red/green renderer and file opening through `tabActions` are later additions.
- No change-event subscription: the panel refreshes on mount, on gesture, and by the refresh button; a push/commit notification stream belongs to the host seam later.
- Restore is whole-work-tree only from the panel; per-file rewind from a checkpoint arrives with the per-turn wiring step.
- The AI-generate button rests until something is staged; without a host-configured route the answer is the honest not-configured failure line.
