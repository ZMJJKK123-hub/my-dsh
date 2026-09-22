# @dsh-custom/dsh-git

English | [中文](README.zh.md)

Service Definition for the `ctx.git` capability seam: repository facts (root, status, diff, log, branches) and index/commit/push mutations shared by model-facing tools and UI panels. This package declares the interface and result types only; the local implementation lives in `@dsh-custom/dsh-git-local`.

## How it works

- Declares the abstract `GitService` (`ctx.git`): `resolveRoot`, `status`, `diff`, `log`, `branches` (facts); `stage`, `unstage`, `commit`, `push` (mutations); and `checkpointCreate`, `checkpoints`, `checkpointRestore` (shadow checkpoints under `refs/dsh/checkpoints/<series>/<index>`, never touching HEAD or the user's index).
- Every method takes the repository directory per call — the caller resolves the session workspace.
- Fact methods never write. Mutation methods must enforce the caller's standing file policy: a read-only policy denies them with a `GitError` whose `denied` flag is set.
- Git failures reject with `GitError` (exit code, stderr, and the `denied` flag when a sandbox policy blocked the run).

## Config

None. This package has no runtime behavior; it is a type and interface declaration.

## Model Experience

None, as this package declares no tools and no model-visible context; model visibility arrives through `@dsh-custom/dsh-tool-git`, which registers the tools that consume this seam.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- No history rewriting: `commit` creates a new commit only; amend, rebase, and revert belong to a later surface if ever needed.
- `push` pushes the current branch; fetch/pull and remote branch management are not part of this seam.
