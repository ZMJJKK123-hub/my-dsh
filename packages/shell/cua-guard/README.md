# @dsh-custom/dsh-cua-guard

English | [中文](README.zh.md)

The CUA confirmation gate and capability precheck: the first Computer-Use tool call per session (screenshot or input simulation) asks the user for approval through the approval seam; the decision is cached for the session's lifetime. The capability precheck verifies the platform's screen-capture command works before the first approval ask, so the user is never prompted on a host where CUA cannot work.

## How it works

- Intercepts `tools/pre-execute` for the five CUA tools (`screenshot`, `mouse_click`, `mouse_trajectory`, `mouse_scroll`, `keyboard_input`).
- **Capability precheck**: before the first ask, runs a one-line platform probe (PowerShell Forms on Windows, `which screencapture` on macOS, `which import` on Linux) through the shell seam. A failing probe denies with a clear reason instead of prompting.
- **Approval gate**: the first CUA call per session asks through `ctx.approval.request` (inside the turn, like bash escalation). `allowed-once` caches a grant; any other outcome caches a rejection that denies every subsequent CUA call for the session.
- Cached grants drop on `session/disposed`.

## Config

- `enabled` (default `true`): set false to pass every CUA call through without asking.
- `reaskMs` (default `0`): re-ask after this many milliseconds; 0 asks once per session.

## Model Experience

The denial reason appears as the tool's error output, teaching the model why CUA is unavailable without leaking internal state.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The approval is per-session, not per-tool-call: approving screenshots also approves mouse and keyboard for the session.
- The visual floating window (live screen view with interrupt) and Windows Edge login-state import are later additions on this seam.
