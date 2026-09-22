import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalGitService from '@dsh-custom/dsh-git-local'
import * as Watcher from '../src/index.ts'

const exec = promisify(execFile)

const scratch = mkdtempSync(join(tmpdir(), 'dsh-cp-watch-spec-'))
const repo = join(scratch, 'repo')

describe('checkpoint-watcher', () => {
  let ctx: Context

  beforeAll(async () => {
    mkdirSync(repo)
    await exec('git', ['init', '-b', 'main'], { cwd: repo })
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitService, {})
    await ctx.plugin(Watcher)
  })

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('checkpoints each turn start under the session series', async () => {
    const session = ctx.sessions.create(undefined, { meta: { cwd: repo } })
    writeFileSync(join(repo, 'one.txt'), 'one\n')
    session.append('turn/start', { turn: 1 })
    writeFileSync(join(repo, 'two.txt'), 'two\n')
    session.append('turn/start', { turn: 2 })

    // The checkpoints run concurrently with the test; poll until both land.
    const deadline = Date.now() + 30_000
    let indexes: number[] = []
    while (Date.now() < deadline) {
      const listed = await ctx.git.checkpoints(repo, String(session.id))
      indexes = listed.checkpoints.map(cp => cp.index)
      if (indexes.length >= 2) break
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    expect(indexes).toEqual([2, 1])
    const listed = await ctx.git.checkpoints(repo, String(session.id))
    expect(listed.checkpoints[1]?.label).toBe('turn 1')
  }, 90_000)

  it('skips a session with no workspace and stays silent off-repo', async () => {
    const bare = ctx.sessions.create(undefined, { meta: { cwd: scratch } })
    bare.append('turn/start', { turn: 1 })
    await new Promise(resolve => setTimeout(resolve, 500))
    // No throw, no checkpoint series: the watcher's warn-only path ran.
    const listed = await ctx.git.checkpoints(scratch, String(bare.id)).catch(() => undefined)
    expect(listed).toBeUndefined()
  }, 30_000)
})
