# @dsh-custom/dsh-git-local

English | [中文](README.zh.md)

Local Service Provider for the `ctx.git` capability seam: runs read-only git commands (root/status/diff/log/branches) through `ctx.subprocess` with argv-direct spawning — never through a shell — confined by `ctx.sandbox` under the standing policy from `ctx.sandboxPolicy`.

## How it works

- Registers `LocalGitService` as `ctx.git` (one implementation per context).
- Every command runs as an explicit argv through the subprocess seam, so arguments need no shell quoting.
- Confinement: the standing policy's mode with the call's repository as the writable root. `confine: false`, an unmounted sandbox, or a full-access standing mode runs unconfined.
- `GIT_OPTIONAL_LOCKS=0` is set on every run so read commands take no opportunistic index locks and survive read-only confinement.
- Output formats are NUL/US/RS-delimited (`--porcelain=v1 -z`, custom `--format` separators), parsed by pure functions in `src/parse.ts`.

## Config

- `gitBinary` (default `git`): git executable, absolute path or bare PATH name.
- `timeoutMs` (default `30000`): per-command deadline.
- `maxDiffBytes` (default `262144`): default cap of `diff` patch text.
- `maxLogCount` (default `100`): upper bound of commits one `log` call returns.
- `maxOutputBytes` (default `65536`): per-stream collection cap for non-diff commands.
- `graceMs` (default `2500`): grace period for the subprocess termination procedure.
- `confine` (default `true`): confine commands under the standing sandbox policy.

## Model Experience

None, as this package registers no tools; model visibility arrives through `@dsh-custom/dsh-tool-git`, which calls `ctx.git`.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- An unborn branch's `log` resolves with an empty entry list; a bad revision still rejects with `GitError`.
- `diff` keeps the output tail when the byte cap overflows and reports `truncated`; the dropped head is not recoverable through this seam.
