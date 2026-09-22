# @dsh-custom/dsh-git

English | [中文](README.zh.md)

Service Definition for the `ctx.git` capability seam: read-only repository facts (root, status, diff, log, branches) shared by model-facing tools and UI panels. This package declares the interface and result types only; the local implementation lives in `@dsh-custom/dsh-git-local`.

## How it works

- Declares the abstract `GitService` (`ctx.git`): `resolveRoot`, `status`, `diff`, `log`, `branches`.
- Every method takes the repository directory per call — the caller resolves the session workspace — and never writes to the repository.
- Git failures reject with `GitError` (exit code, stderr, and a `denied` flag when a sandbox policy blocked the run).

## Config

None. This package has no runtime behavior; it is a type and interface declaration.

## Model Experience

None, as this package declares no tools and no model-visible context; model visibility arrives through `@dsh-custom/dsh-tool-git`, which registers the tools that consume this seam.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Read-only surface: staging, committing, pushing, and history rewriting belong to a later write seam, not this interface.
- No remote branch listing; `branches` covers `refs/heads` only.
