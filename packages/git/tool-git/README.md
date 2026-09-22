# @dsh-custom/dsh-tool-git

English | [中文](README.zh.md)

Model-facing git tools over the `ctx.git` capability seam: `git_status`, `git_diff`, `git_log`, and `git_branch_list`. The tools add no execution of their own — they resolve the working directory from the session workspace (or an explicit `workdir` argument), call the seam, and render its typed results.

## How it works

- Registers four read-only tools on `ctx.tools`; schemas join prompt assembly automatically.
- The working directory resolves per call: an absolute `workdir` argument wins, a relative one resolves against the session workspace, and with none the session workspace itself.
- `git_diff` renders the patch in a fenced `diff` block and honors the tool-level byte cap; `git_log` honors the tool-level count cap; both defer to the seam for execution and confinement.
- A directory outside any repository fails the call with the seam's `not a git repository` error.

## Config

- `maxDiffBytes` (default `131072`): cap of one `git_diff` patch.
- `maxLogCount` (default `30`): cap of commits one `git_log` call returns.

## Model Experience

### Tool schemas

#### What the model sees

The four tool schemas (`git_status`, `git_diff`, `git_log`, `git_branch_list`) join the system prompt's tool catalog for every profile that mounts this bundle row; see the generated [tool catalog](../../../docs/tool-catalog.md) for the exact argument shapes.

#### Token effect

Conditional: the four schemas are present whenever this row is enabled.

#### KV Cache effect

Append-only: the schemas are assembled once per prompt and change only when this row's config or the tool surface changes.

## Known Limitations and Deferred Work

- Read-only surface: staging, committing, pushing, and checkout tools arrive with the write seam, not this package.
- No remote branch listing; `git_branch_list` covers local branches only.
