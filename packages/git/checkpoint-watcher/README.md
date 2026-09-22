# @dsh-custom/dsh-checkpoint-watcher

English | [中文](README.zh.md)

Best-effort shadow checkpoint at every turn start: when a session with a workspace enters a turn, one git checkpoint lands in the session's own series before the turn's writes can happen, so the panel's Checkpoints list is a per-turn rewind timeline for free.

## How it works

- Subscribes `session/event`; on `turn/start` it calls `ctx.git.checkpointCreate` with the session id as the series key and the turn ordinal as the index (label `turn <n>`).
- Strictly best-effort: any failure logs a warning and never affects the agent turn; a session without a workspace cwd, or a workspace outside any git repository, is simply skipped.
- An interrupted turn restarted under the same ordinal overwrites the same ref — restart is idempotent.

## Config

- `enabled` (default `true`): set false to stop turn checkpoints without removing the row.

## Model Experience

None, as this plugin registers no tools and no model-visible context; the checkpoints it creates are visible only through the git seam's checkpoint surface.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Checkpoints of a deleted session's series are not deleted; they age out through the git seam's `checkpointKeepLast` pruning when that session stops producing turns.
- Turn 0 sessions (no cwd yet) and non-git workspaces are skipped silently, by design.
