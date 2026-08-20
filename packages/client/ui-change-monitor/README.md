# @deepseek-ai/dsh-client-ui-change-monitor

English | [中文](README.zh.md)

Browser half of the per-turn change monitor: after every completed Agent turn that changed files, a "N files changed" row appears under the closing assistant message; expanding it shows the VS Code / Cline-style file list, and clicking a file opens the inline red-green diff (deletions tinted with the error color, additions with the success color, unchanged context neutral). Long unchanged runs fold to a "N lines skipped" marker, keeping five context lines around each change. Each turn's row compares that turn against the previous turn's end state — exactly what the agent changed in this round.

## How it works

- The plugin mounts the `changeMonitor` Remote namespace itself (`ctx.remote.$mount`); api-remotes' fixed selection does not include it.
- The turn-tail entry claims the `conversation.chat.turnTail` chain for every completed turn, loads that turn's change set from the Host, and renders **nothing when the turn changed no files** — a conversation never grows a row the agent did not earn.
- All data flows through a per-session `ChangeMonitorController` with small caches; a short bounded poll waits for the Host to finish settling the latest turn. Every failure degrades to "no changes", never an error surface.
- The viewer is read-only by construction: it renders stored hunks captured at turn end, never live workspace content.

## Model Experience

No prompt sections, no tools, no model-visible context. It renders Host-computed change sets only.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- History retains only `maxHistory` turns (Host config); older turns disappear once trimmed.
- Turn tails for very old turns fetch their stored records on demand; nothing is prefetched.
