# @dsh-custom/dsh-git-remote

English | [中文](README.zh.md)

Remote exposure of the `ctx.git` capability seam as the `gitRemote` Typert Remote namespace for the Web Client: every request carries the session id, the service resolves the workspace root from the live session, and every answer is a discriminated result (`ok` with the JSON projection, or `false` with the panel-renderable error and a `denied` flag when the standing sandbox policy blocked a mutation).

## How it works

- Registers `GitRemoteService` (a `TypertRemoteService`) as `ctx.gitRemote`, wire namespace `gitRemote`; the generated client mount for the browser half is the `./remote` export (`lib/typert.remote-client.js`, emitted by the workspace tsdown Typert pass).
- Remote methods: `status`, `diff`, `log`, `branches`, `stage`, `unstage`, `commit`, `push` — each takes `{ sessionId, ... }`, resolves the session's `header.cwd`, and calls `ctx.git` once; plus `generateCommitMessage`, one auxiliary model completion that frames the staged diff and normalizes the reply into commit-message text.
- Failures stay in the result: a `GitError` becomes `{ ok: false, error, denied? }`; a Remote call never rejects.
- The Web Client mounts the namespace itself (`ctx.remote.$mount`), like `ui-change-monitor` does for `changeMonitor`.

## Config

- `provider` + `model` (paired, optional): the model route for `generateCommitMessage`. Without both, that method answers the honest not-configured failure; everything else works unconfigured.
- `maxDiffBytes` (default `65536`): cap of the staged diff fed to the model.
- `maxOutputTokens` (default `128`): generation output-token cap.
- `timeoutMs` (default `60000`): end-to-end generation deadline.

## Model Experience

None, as this package registers no tools and no model-visible context; it only carries repository facts to the Web Client.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- A session with no `header.cwd` (or an unknown session id) answers every method with the same no-workspace failure.
- No change events: the panel polls or refreshes on demand; a push/commit notification stream would be a later addition.
