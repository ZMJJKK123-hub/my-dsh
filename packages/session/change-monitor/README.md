# @deepseek-ai/dsh-change-monitor

English | [中文](README.zh.md)

Per-turn file-change monitor: watches the durable session event stream, snapshots the session's workspace at `turn/start` and again after `turn/end` settles, and diffs the two snapshots into a change set that the Web Client renders as a VS Code / Cline-style changes panel.

The monitor is **best effort by design**: a snapshot, diff, or storage failure logs a warning and never affects the agent turn. It is also **Git-free**: everything derives from before/after content snapshots, so it works in any workspace, repository or not.

## How it works

1. `session/event` with `turn/start` → the monitor records the workspace's file metadata (relative path, size, mtime, SHA-256 hash, text/binary/large kind) into a before snapshot. Text content is retained **only** in the before snapshot — the disk is overwritten by the turn, so only the snapshot can later supply the before text; the retained bytes are released the moment the turn's diff is stored.
2. The agent works normally; nothing intercepts tools or reads the filesystem mid-turn.
3. `turn/end` → the monitor waits `settleDelayMs`, re-scans the metadata until it stops changing (bounded by `settleMaxAttempts`), snapshots after (metadata + hash only, no retained content), then diffs. Changed files' after-texts are read from disk at diff time.
4. In git workspaces the monitor also includes mid-turn commits: it records the turn-start HEAD, diffs it against the current HEAD at turn end, and merges those committed paths into the snapshots. A file modified and committed during the turn reports as modified, an added file as added, a deleted file as deleted; a file that was already dirty at turn start and committed unchanged still shows no change.
5. The diff is content-based, not timestamp-based: a file the agent rewrote back to its original bytes reports as unchanged. Only `modified` / `added` / `deleted` files enter the change set; binary files and files above the diff cap report size-only summaries.
6. Change sets persist per session as JSONL under the store root (default `$DSH_HOME/changes/<sessionId>.jsonl`), trimmed to `maxHistory` turns, and are served to the browser through the `changeMonitor` Remote namespace.

## Remote API

| Method | Request | Result |
| --- | --- | --- |
| `changeMonitor.turns` | `{ sessionId }` | completed `TurnSummary[]`, newest first |
| `changeMonitor.current` | `{ sessionId }` | latest `ChangeSetSummary` or `null` |
| `changeMonitor.turn` | `{ sessionId, turn }` | that turn's `ChangeSetSummary` or `null` |
| `changeMonitor.file` | `{ sessionId, turn, path }` | the file's full `FileChange` (hunks) |
| `changeMonitor.session` | `{ sessionId }` | cumulative `ChangeSetSummary` across retained turns or `null` |

All results use the `{ ok: true, value } | { ok: false, error }` envelope; failures carry `internal` / `not-found` / `invalid-path` codes. File paths are workspace-relative and validated against traversal.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | master switch |
| `exclude` / `include` | `[]` | extra ignore patterns / re-admit patterns (gitignore-lite dialect) |
| `maxSnapshotFileSize` | `10 MiB` | files above this cap get metadata only |
| `maxDiffFileSize` | `10 MiB` | files above this cap never get a text diff |
| `maxDiffCells` | `25_000_000` | LCS budget; above it a diff bisects at shared anchor lines, keeping untouched runs as context |
| `contextLines` | `5` | context lines around each changed region |
| `settleDelayMs` | `200` | wait between turn end and the first stability scan |
| `settleMaxAttempts` | `5` | stability re-scan bound |
| `historyEnabled` | `true` | persist history; `false` keeps only the latest in memory |
| `maxHistory` | `100` | turns retained per session |
| `storeRoot` | `$DSH_HOME/changes` | history directory override |

## Default ignore set

Directories: `.git/`, `node_modules/`, `.venv/`, `venv/`, `__pycache__/`, `dist/`, `build/`, `lib/`, `bin/`, `.next/`, `.cache/`, `coverage/`, `.turbo/`, `.nx/`, `.idea/`, `.vscode/`, `.DS_Store/`, `out/`, `target/`, `.pytest_cache/`, `.mypy_cache/`.

File shapes: `*.pyc`, `*.pyo`, `*.log`, `*.tmp`, `*.temp`, `*.swp`, `*.swo`, `*.part`, `*.map`, `*.tsbuildinfo`, `.DS_Store`, `Thumbs.db`, `desktop.ini`.

Build outputs (`lib/`, sourcemaps, tsbuildinfo) are excluded so generated artifacts do not flood change sets; re-admit them with an `include` pattern when a project keeps authored sources under `lib/`.

Lock files (`pnpm-lock.yaml`, `package-lock.json`, `requirements.txt`) are deliberately **not** ignored — they are real project changes.

## Model Experience

The monitor contributes no prompt sections, no tools, and no model-visible context. It reads the durable session log and the filesystem only.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Rename detection is not implemented: a renamed file reports as `deleted` + `added`.
- The session-level cumulative view replays only retained turns; once `maxHistory` trims old turns, the merged view starts from the oldest retained record.
- A turn whose before snapshot failed (e.g. the workspace vanished) is skipped with a warning rather than diffed against an empty baseline.
- The settle window is a heuristic; an extremely long-running async writer can still race the final snapshot. The stored diff is always a true before/after comparison of what the snapshots saw.
