import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalGitService from '@dsh-custom/dsh-git-local'
import GitRemoteService from '@dsh-custom/dsh-git-remote'

const exec = promisify(execFile)

const scratch = mkdtempSync(join(tmpdir(), 'dsh-git-remote-spec-'))
const repo = join(scratch, 'repo')

/** Host harness: sessions store + the real local git seam + the Remote service. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalGitService, {})
  await ctx.plugin(GitRemoteService)
  return ctx
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
})
