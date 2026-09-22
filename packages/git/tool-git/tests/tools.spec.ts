import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalGitService from '@dsh-custom/dsh-git-local'
import * as ToolGit from '@dsh-custom/dsh-tool-git'

const exec = promisify(execFile)

const scratch = mkdtempSync(join(tmpdir(), 'dsh-tool-git-spec-'))
const repo = join(scratch, 'repo')
const outside = join(scratch, 'outside')
const signal = new AbortController().signal

/** The shared harness: tools runtime + agent registry + real local git seam. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalGitService, {})
  await ctx.plugin(ToolGit)
  return ctx
}

/** A fake agent whose session workspace is the fixture repository. */
function fakeAgent(ctx: Context, cwd: string): Agent {
  const scopeFiber = ctx.plugin(() => {})
  const id = SessionId('spec-session')
  const agent = {
    id,
    ctx: scopeFiber.ctx,
    session: { id, header: { version: 0, id, createdAt: 0, cwd } },
  } as unknown as Agent
  ctx.agents.register(agent)
  return agent
}

let callCounter = 0
function call(ctx: Context, agent: Agent, name: string, args: unknown) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool-git', () => {
  let ctx: Context
  let agent: Agent

  beforeAll(async () => {
    mkdirSync(repo)
    mkdirSync(outside)
    await exec('git', ['init', '-b', 'main'], { cwd: repo })
    ctx = await setup()
    agent = fakeAgent(ctx, repo)
  })

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('git_status reports untracked entries from the session workspace', async () => {
    writeFileSync(join(repo, 'hello.txt'), 'hello\n')
    const result = await call(ctx, agent, 'git_status', {})
    expect(result.isError).not.toBe(true)
    expect(text(result)).toContain('?? hello.txt')
  })

  it('git_status rejects a directory outside any repository', async () => {
    const result = await call(ctx, agent, 'git_status', { workdir: outside })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not a git repository')
  })

  it('git_diff, git_log, and git_branch_list reflect a commit and an edit', async () => {
    await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'hello.txt'], { cwd: repo })
    await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'first'], { cwd: repo })
    writeFileSync(join(repo, 'hello.txt'), 'hello world\n')

    const diff = await call(ctx, agent, 'git_diff', {})
    expect(diff.isError).not.toBe(true)
    expect(text(diff)).toContain('+hello world')

    const stagedEmpty = await call(ctx, agent, 'git_diff', { staged: true })
    expect(text(stagedEmpty)).toContain('empty diff')

    const log = await call(ctx, agent, 'git_log', {})
    expect(text(log)).toContain('first')

    const branches = await call(ctx, agent, 'git_branch_list', {})
    expect(text(branches)).toContain('* main')
  }, 60_000)

  it('git_log honors max_count', async () => {
    const result = await call(ctx, agent, 'git_log', { max_count: 1 })
    expect(result.isError).not.toBe(true)
  }, 30_000)

  it('git_stage and git_commit flow through the tools', async () => {
    writeFileSync(join(repo, 'tool-feature.txt'), 'tool feature\n')
    const staged = await call(ctx, agent, 'git_stage', { paths: ['tool-feature.txt'] })
    expect(staged.isError).not.toBe(true)
    expect(text(staged)).toContain('tool-feature.txt')

    const committed = await call(ctx, agent, 'git_commit', { message: 'add tool feature' })
    expect(committed.isError).not.toBe(true)
    expect(text(committed)).toContain('add tool feature')
  }, 60_000)

  it('git_stage without paths or all fails the call', async () => {
    const result = await call(ctx, agent, 'git_stage', {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires non-empty paths')
  }, 30_000)

  it('git_push targets a local bare remote', async () => {
    await exec('git', ['init', '--bare', 'tool-remote.git'], { cwd: scratch })
    await exec('git', ['remote', 'add', 'origin', join(scratch, 'tool-remote.git').replaceAll('\\', '/')], { cwd: repo })
    await exec('git', ['config', 'protocol.file.allow', 'always'], { cwd: repo })
    const pushed = await call(ctx, agent, 'git_push', { remote: 'origin', set_upstream: true })
    expect(pushed.isError).not.toBe(true)
    expect(text(pushed)).toContain('pushed main to origin')
  }, 60_000)
})
