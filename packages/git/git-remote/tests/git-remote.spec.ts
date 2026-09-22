import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { BlockAssembler, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalGitService from '@dsh-custom/dsh-git-local'
import GitRemoteService from '@dsh-custom/dsh-git-remote'

const exec = promisify(execFile)

/** One streamed chunk shape the assembler accepts. */
type StreamedChunk = Parameters<BlockAssembler['push']>[0]

/**
 * The llm seam's stand-in: records the options and streams one fixed text
 * through a clean finish. A fresh class per call, because `ctx.plugin` takes
 * the class (its config channel stays untouched).
 */
function fakeLlmPlugin(text: string, requests: GenerateOptions[]) {
  return class FakeLlm extends Service {
    constructor(ctx: Context) {
      super(ctx, 'llm')
    }

    stream(options: GenerateOptions): AsyncGenerator<StreamedChunk> {
      requests.push(options)
      const textChunk: StreamedChunk = { type: 'text-delta', index: 0, text }
      const finishChunk: StreamedChunk = { type: 'finish', reason: { kind: 'stop' } }
      return (async function* () {
        yield textChunk
        yield finishChunk
      })()
    }
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'dsh-git-remote-spec-'))
const repo = join(scratch, 'repo')

/** Host harness: sessions store + the real local git seam + the Remote service. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalGitService, {})
  // The service injects the llm seam; the fact tests never call it.
  await ctx.plugin(fakeLlmPlugin('unused', []))
  await ctx.plugin(GitRemoteService)
  return ctx
}

/** Host harness with a configured generator route and the fake llm seam. */
async function setupWithGenerator(text: string): Promise<{ ctx: Context; requests: GenerateOptions[] }> {
  const ctx = new Context()
  const requests: GenerateOptions[] = []
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalGitService, {})
  await ctx.plugin(fakeLlmPlugin(text, requests))
  await ctx.plugin(GitRemoteService, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  return { ctx, requests }
}

describe('GitRemoteService', () => {
  let ctx: Context
  let sessionId: SessionId

  beforeAll(async () => {
    mkdirSync(repo)
    await exec('git', ['init', '-b', 'main'], { cwd: repo })
    ctx = await setup()
    const session = ctx.sessions.create(undefined, { meta: { cwd: repo } })
    sessionId = session.id
  })

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('answers status with the projected JSON for the session workspace', async () => {
    writeFileSync(join(repo, 'hello.txt'), 'hello\n')
    const result = await ctx.gitRemote.status({ sessionId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.branch).toBe('main')
    expect(result.value.initial).toBe(true)
    expect(result.value.entries.some(entry => entry.path === 'hello.txt' && entry.untracked)).toBe(true)
  })

  it('fails honestly for an unknown session', async () => {
    const result = await ctx.gitRemote.status({ sessionId: SessionId('no-such-session') })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('no workspace directory')
  })

  it('stages, commits, and reports the cumulative staged paths', async () => {
    const staged = await ctx.gitRemote.stage({ sessionId, paths: ['hello.txt'] })
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(staged.value.stagedPaths).toContain('hello.txt')

    const committed = await ctx.gitRemote.commit({ sessionId, message: 'first commit' })
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    expect(committed.value.subject).toBe('first commit')

    const log = await ctx.gitRemote.log({ sessionId })
    expect(log.ok).toBe(true)
    if (!log.ok) return
    expect(log.value.entries[0]?.subject).toBe('first commit')
  }, 60_000)

  it('answers diff for the work tree', async () => {
    writeFileSync(join(repo, 'hello.txt'), 'hello world\n')
    const result = await ctx.gitRemote.diff({ sessionId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.patch).toContain('+hello world')
  }, 30_000)

  it('lists and restores checkpoints through the Remote', async () => {
    const { readFileSync } = await import('node:fs')
    await ctx.git.checkpointCreate(repo, { series: String(sessionId), index: 1, label: 'cp one' })
    writeFileSync(join(repo, 'cp.txt'), 'original\n')
    await ctx.git.checkpointCreate(repo, { series: String(sessionId), index: 2, label: 'cp two' })
    writeFileSync(join(repo, 'cp.txt'), 'diverged\n')

    const listed = await ctx.gitRemote.checkpoints({ sessionId })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.checkpoints.map(cp => cp.index)).toEqual([2, 1])
    expect(listed.value.checkpoints[1]?.label).toBe('cp one')

    const restored = await ctx.gitRemote.restoreCheckpoint({ sessionId, index: 2, paths: ['cp.txt'] })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.value.restored).toEqual(['cp.txt'])
    expect(readFileSync(join(repo, 'cp.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('original\n')
  }, 90_000)

  it('carries the denied flag through a policy-shaped failure', async () => {
    // A session whose workspace is outside any repository answers the seam's
    // not-a-repository failure with ok: false and no denied flag.
    const outsideSession = ctx.sessions.create(undefined, { meta: { cwd: scratch } })
    const result = await ctx.gitRemote.status({ sessionId: outsideSession.id })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not a git repository')
    expect(result.denied).toBeUndefined()
  }, 30_000)

  it('generateCommitMessage answers not-configured without a route', async () => {
    const result = await ctx.gitRemote.generateCommitMessage({ sessionId })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not configured')
  }, 30_000)

  it('generateCommitMessage drafts from the staged diff and normalizes fences', async () => {
    const { ctx: genCtx, requests } = await setupWithGenerator('```\nAdd feature\n\nExplain the body.\n```')
    const repo = join(scratch, 'gen')
    mkdirSync(repo)
    await exec('git', ['init', '-b', 'main'], { cwd: repo })
    writeFileSync(join(repo, 'gen.txt'), 'generated\n')
    const genSession = genCtx.sessions.create(undefined, { meta: { cwd: repo } })
    await genCtx.gitRemote.stage({ sessionId: genSession.id, paths: ['gen.txt'] })

    const result = await genCtx.gitRemote.generateCommitMessage({ sessionId: genSession.id })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.message).toBe('Add feature\n\nExplain the body.')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.system).toContain('commit messages')
    expect(JSON.stringify(requests[0]?.messages)).toContain('gen.txt')
  }, 90_000)

  it('generateCommitMessage refuses when nothing is staged', async () => {
    const { ctx: genCtx } = await setupWithGenerator('unused')
    const repo = join(scratch, 'empty-gen')
    mkdirSync(repo)
    await exec('git', ['init', '-b', 'main'], { cwd: repo })
    writeFileSync(join(repo, 'tracked.txt'), 'one\n')
    await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { cwd: repo })
    await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'base'], { cwd: repo })
    const genSession = genCtx.sessions.create(undefined, { meta: { cwd: repo } })
    const result = await genCtx.gitRemote.generateCommitMessage({ sessionId: genSession.id })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('nothing is staged')
  }, 90_000)
})
