/**
 * Model-facing git tools over the `ctx.git` capability seam: `git_status`,
 * `git_diff`, `git_log`, and `git_branch_list`. The tools add no execution of
 * their own — they resolve the working directory from the session (or an
 * explicit `workdir` argument), call the seam, and render its typed results,
 * so any future git provider swap keeps the tool surface unchanged.
 *
 * @module @dsh-custom/dsh-tool-git
 */

import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@dsh-custom/dsh-git'
import type {
  GitBranchListResult, GitDiffResult, GitLogResult, GitStatusSummary,
} from '@dsh-custom/dsh-git'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-git'

/** Services required by the git tools. */
export const inject = ['tools', 'git']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Model-facing cap of one `git_diff` patch in bytes. */
  maxDiffBytes?: number
  /** Model-facing cap of commits one `git_log` call returns. */
  maxLogCount?: number
}

type ResolvedConfig = Required<Config>

export const Config: z<Config> = z.object({
  maxDiffBytes: z.number().default(131_072),
  maxLogCount: z.number().default(30),
})

/** Tool input carrying the optional working-directory override every tool shares. */
interface WorkdirArgs {
  readonly workdir?: string
}

/**
 * Resolve the working directory for one call: an explicit absolute `workdir`
 * wins; a relative one resolves against the session workspace; with none, the
 * session workspace itself.
 */
function resolveCwd(workdir: string | undefined, exec: { agent?: Agent }): string {
  const headerCwd = exec.agent?.session.header.cwd
  const base = headerCwd !== undefined && headerCwd !== '' ? headerCwd : process.cwd()
  if (workdir === undefined || workdir.trim() === '') return base
  if (!isAbsolute(workdir)) return resolve(base, workdir)
  return workdir
}

/**
 * Project one seam result onto its canonical tool JSON: mutable arrays and
 * omitted-when-absent optional fields, per the registry's value contract.
 */
function statusToJson(summary: GitStatusSummary) {
  return {
    root: summary.root,
    ahead: summary.ahead,
    behind: summary.behind,
    initial: summary.initial,
    detached: summary.detached,
    ...summary.branch !== undefined ? { branch: summary.branch } : {},
    ...summary.upstream !== undefined ? { upstream: summary.upstream } : {},
    entries: summary.entries.map(entry => ({
      code: entry.code,
      path: entry.path,
      staged: entry.staged,
      unstaged: entry.unstaged,
      untracked: entry.untracked,
      ...entry.originPath !== undefined ? { originPath: entry.originPath } : {},
    })),
  }
}

function diffToJson(result: GitDiffResult) {
  return {
    staged: result.staged,
    patch: result.patch,
    truncated: result.truncated,
    ...result.path !== undefined ? { path: result.path } : {},
  }
}

function logToJson(result: GitLogResult) {
  return { entries: result.entries.map(entry => ({ ...entry })) }
}

function branchesToJson(result: GitBranchListResult) {
  return {
    branches: result.branches.map(branch => ({
      name: branch.name,
      current: branch.current,
      shortHash: branch.shortHash,
      ...branch.upstream !== undefined ? { upstream: branch.upstream } : {},
    })),
  }
}

/** One text line per status entry, in git's order. */
function renderStatusEntries(value: { entries: readonly { code: string; path: string; originPath?: string }[] }): string {
  if (value.entries.length === 0) return 'nothing to commit, working tree clean'
  return value.entries.map((entry) => {
    const origin = entry.originPath !== undefined ? ` (from ${entry.originPath})` : ''
    return `${entry.code} ${entry.path}${origin}`
  }).join('\n')
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved: ResolvedConfig = { maxDiffBytes: 131_072, maxLogCount: 30, ...config }

  ctx.tools.register(defineTool({
    name: 'git_status',
    description: 'Show the working tree status of the session repository: current branch, upstream ahead/behind, and per-file staged/unstaged/untracked entries. Read-only.',
    parameters: {
      workdir: { type: 'string', description: 'Working directory for the repository. Defaults to the session workspace; a relative path is resolved against it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          branch: { type: 'string' },
          upstream: { type: 'string' },
          ahead: { type: 'integer', required: true },
          behind: { type: 'integer', required: true },
          initial: { type: 'boolean', required: true },
          detached: { type: 'boolean', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', required: true },
                path: { type: 'string', required: true },
                originPath: { type: 'string' },
                staged: { type: 'boolean', required: true },
                unstaged: { type: 'boolean', required: true },
                untracked: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderStatusEntries(value) }],
    },
    async execute(args: WorkdirArgs, exec) {
      return statusToJson(await ctx.git.status(resolveCwd(args.workdir, exec), exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_diff',
    description: 'Show a unified diff of the session repository: work tree against the index by default, or the index against HEAD with staged: true. Read-only.',
    parameters: {
      staged: { type: 'boolean', description: 'Diff the staged (index) changes against HEAD instead of the work tree against the index.' },
      path: { type: 'string', description: 'Repository-relative path to limit the diff to.' },
      workdir: { type: 'string', description: 'Working directory for the repository. Defaults to the session workspace; a relative path is resolved against it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          staged: { type: 'boolean', required: true },
          path: { type: 'string' },
          patch: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.patch === '' ? '(empty diff)' : `\`\`\`diff\n${value.patch.replace(/\n+$/, '')}\n\`\`\``,
      }],
    },
    async execute(args: { staged?: boolean; path?: string; workdir?: string }, exec) {
      return diffToJson(await ctx.git.diff(resolveCwd(args.workdir, exec), {
        staged: args.staged === true,
        ...args.path !== undefined && args.path !== '' ? { path: args.path } : {},
        maxBytes: resolved.maxDiffBytes,
      }, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_log',
    description: 'List commits of the session repository, newest first: short hash, date, author, and subject. Read-only.',
    parameters: {
      max_count: { type: 'number', description: 'Maximum commits to return (capped by the host).' },
      ref: { type: 'string', description: 'Starting revision, e.g. a branch name or HEAD~5. Defaults to HEAD.' },
      path: { type: 'string', description: 'Repository-relative path to limit history to.' },
      workdir: { type: 'string', description: 'Working directory for the repository. Defaults to the session workspace; a relative path is resolved against it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                hash: { type: 'string', required: true },
                shortHash: { type: 'string', required: true },
                author: { type: 'string', required: true },
                date: { type: 'string', required: true },
                subject: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? '(no commits)'
          : value.entries.map(entry => `${entry.shortHash} ${entry.date} ${entry.author}\n    ${entry.subject}`).join('\n'),
      }],
    },
    async execute(args: { max_count?: number; ref?: string; path?: string; workdir?: string }, exec) {
      return logToJson(await ctx.git.log(resolveCwd(args.workdir, exec), {
        maxCount: Math.min(args.max_count !== undefined ? Math.floor(args.max_count) : resolved.maxLogCount, resolved.maxLogCount),
        ...args.ref !== undefined && args.ref !== '' ? { ref: args.ref } : {},
        ...args.path !== undefined && args.path !== '' ? { path: args.path } : {},
      }, exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'git_branch_list',
    description: 'List local branches of the session repository with the current branch, its upstream when configured, and each tip hash. Read-only.',
    parameters: {
      workdir: { type: 'string', description: 'Working directory for the repository. Defaults to the session workspace; a relative path is resolved against it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                current: { type: 'boolean', required: true },
                upstream: { type: 'string' },
                shortHash: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.branches.map(branch =>
          `${branch.current ? '* ' : '  '}${branch.name}${branch.upstream !== undefined ? ` (${branch.upstream})` : ''} ${branch.shortHash}`,
        ).join('\n'),
      }],
    },
    async execute(args: WorkdirArgs, exec) {
      return branchesToJson(await ctx.git.branches(resolveCwd(args.workdir, exec), exec.signal))
    },
  }))
}
