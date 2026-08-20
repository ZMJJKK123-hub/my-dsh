import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { ChangeMonitorService, type Config } from '../src/index.ts'

const git = promisify(execFile)

let workspace: string
let storeRoot: string
let ctx: Context
let monitor: ChangeMonitorService

const BASE_CONFIG: Config = {
  settleDelayMs: 0,
  settleMaxAttempts: 1,
  maxHistory: 10,
}

beforeEach(async () => {
  vi.setConfig({ testTimeout: 20_000 })
  workspace = await mkdtemp(join(tmpdir(), 'dsh-change-workspace-'))
  storeRoot = await mkdtemp(join(tmpdir(), 'dsh-change-store-'))
  ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(ChangeMonitorService, { ...BASE_CONFIG, storeRoot })
  // The service was just mounted by the plugin call above; absence is a test bug.
  monitor = ctx.get('changeMonitor')!
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
  await rm(storeRoot, { recursive: true, force: true })
  await ctx.fiber.dispose().catch(() => undefined)
})

/** Wait until a probe returns a value, failing the test after the deadline. */
async function waitFor<T>(probe: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** A live session rooted at the workspace. */
function createSession(startWaitMs = 120): { id: SessionId; events: (type: 'turn/start' | 'turn/end', turn: number) => Promise<void> } {
  const session = ctx.sessions.create(undefined, { meta: { cwd: workspace } })
  return {
    id: session.id,
    // Awaiting after turn/start lets the asynchronous before snapshot land
    // before the test mutates the workspace (mirrors the real loop, where a
    // model round trip separates the two). Git workspaces need longer: the
    // candidate probe spawns git once per turn start.
    events: async (type, turn) => {
      if (type === 'turn/start') {
        session.append('turn/start', { turn })
        await new Promise(resolve => setTimeout(resolve, startWaitMs))
      } else {
        session.append('turn/end', { turn, reason: { kind: 'completed' } })
      }
    },
  }
}

describe('ChangeMonitorService lifecycle', () => {
  it('records one change set for a turn that modifies, adds, and deletes', async () => {
    await writeFile(join(workspace, 'keep.txt'), 'one\n', 'utf8')
    await writeFile(join(workspace, 'gone.txt'), 'bye\n', 'utf8')
    const { id, events } = createSession()
    await events('turn/start', 1)
    await writeFile(join(workspace, 'keep.txt'), 'two\n', 'utf8')
    await writeFile(join(workspace, 'new.txt'), 'fresh\n', 'utf8')
    await rm(join(workspace, 'gone.txt'))
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.current({ sessionId: id })
      return result.ok && result.value !== null && result.value.files.length > 0 ? result.value : undefined
    }, 'turn 1 change set')

    expect(summary.files.length).toBe(3)
    const keep = summary.files.find(file => file.path === 'keep.txt')
    expect(keep?.status).toBe('modified')
    expect(keep?.additions).toBe(1)
    expect(keep?.deletions).toBe(1)
    const fresh = summary.files.find(file => file.path === 'new.txt')
    expect(fresh?.status).toBe('added')
    expect(fresh?.additions).toBe(1)
    const gone = summary.files.find(file => file.path === 'gone.txt')
    expect(gone?.status).toBe('deleted')
    expect(gone?.deletions).toBe(1)
  })

  it('reports a rewrite-to-original as no change', async () => {
    const path = join(workspace, 'same.txt')
    await writeFile(path, 'same\n', 'utf8')
    const { id, events } = createSession()
    await events('turn/start', 1)
    await writeFile(path, 'same\n', 'utf8')
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.current({ sessionId: id })
      return result.ok && result.value !== null ? result.value : undefined
    }, 'turn 1 empty change set')
    expect(summary.files).toEqual([])
  })

  it('produces one independent change set per turn', async () => {
    await writeFile(join(workspace, 'a.txt'), 'a1\n', 'utf8')
    await writeFile(join(workspace, 'b.txt'), 'b1\n', 'utf8')
    const { id, events } = createSession()

    await events('turn/start', 1)
    await writeFile(join(workspace, 'a.txt'), 'a2\n', 'utf8')
    await events('turn/end', 1)
    await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 1 })
      return result.ok && result.value !== null ? result.value : undefined
    }, 'turn 1 record')

    await events('turn/start', 2)
    await writeFile(join(workspace, 'b.txt'), 'b2\n', 'utf8')
    await events('turn/end', 2)
    const second = await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 2 })
      return result.ok && result.value !== null ? result.value : undefined
    }, 'turn 2 record')

    expect(second.files.map(file => file.path)).toEqual(['b.txt'])

    const turns = await waitFor(async () => {
      const result = await monitor.turns({ sessionId: id })
      return result.ok && result.value.length === 2 ? result.value : undefined
    }, 'two-turn history')
    expect(turns[0]?.turn).toBe(2)
    expect(turns[1]?.turn).toBe(1)
  })

  it('serves a full file diff with hunks through the file endpoint', async () => {
    await writeFile(join(workspace, 'code.ts'), 'const a = 1\nconst b = 2\n', 'utf8')
    const { id, events } = createSession()
    await events('turn/start', 1)
    await writeFile(join(workspace, 'code.ts'), 'const a = 1\nconst b = 3\n', 'utf8')
    await events('turn/end', 1)
    await waitFor(async () => {
      const result = await monitor.current({ sessionId: id })
      return result.ok && result.value !== null && result.value.files.length > 0 ? result.value : undefined
    }, 'turn 1 file list')

    const file = await monitor.file({ sessionId: id, turn: 1, path: 'code.ts' })
    expect(file.ok).toBe(true)
    if (!file.ok) return
    expect(file.value.hunks.length).toBeGreaterThan(0)
    const hunk = file.value.hunks[0]
    expect(hunk?.lines.some(line => line.kind === 'del' && line.text === 'const b = 2')).toBe(true)
    expect(hunk?.lines.some(line => line.kind === 'add' && line.text === 'const b = 3')).toBe(true)

    const traversal = await monitor.file({ sessionId: id, turn: 1, path: '../escape.txt' })
    expect(traversal.ok).toBe(false)
    if (!traversal.ok) expect(traversal.error.code).toBe('not-found')
  })

  it('merges retained turns into the session-level summary', async () => {
    const { id, events } = createSession()
    await events('turn/start', 1)
    await writeFile(join(workspace, 'x.txt'), 'v1\n', 'utf8')
    await events('turn/end', 1)
    await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 1 })
      return result.ok && result.value !== null ? result.value : undefined
    }, 'turn 1 added')

    await events('turn/start', 2)
    await writeFile(join(workspace, 'x.txt'), 'v2\n', 'utf8')
    await events('turn/end', 2)
    await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 2 })
      return result.ok && result.value !== null ? result.value : undefined
    }, 'turn 2 modified')

    const merged = await monitor.session({ sessionId: id })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    // The file did not exist when the session started, so the cumulative view
    // reports it as added (from absence to its final content).
    expect(merged.value?.files.length).toBe(1)
    expect(merged.value?.files[0]?.status).toBe('added')
    expect(merged.value?.files[0]?.additions).toBe(1)
    expect(merged.value?.files[0]?.deletions).toBe(0)
  })

  it('respects configured exclusions', async () => {
    await writeFile(join(workspace, 'noise.tmp'), 'x\n', 'utf8')
    await writeFile(join(workspace, 'real.ts'), 'x\n', 'utf8')
    const { id, events } = createSession()
    await events('turn/start', 1)
    await writeFile(join(workspace, 'noise.tmp'), 'y\n', 'utf8')
    await writeFile(join(workspace, 'real.ts'), 'y\n', 'utf8')
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.current({ sessionId: id })
      return result.ok && result.value !== null ? result.value : undefined
    }, 'turn 1 with exclusions')
    expect(summary.files.map(file => file.path)).toEqual(['real.ts'])
  })

  it('reports binary files with a size-only summary', async () => {
    const path = join(workspace, 'img.bin')
    await writeFile(path, Buffer.from([0x00, 0x01, 0x02]))
    const { id, events } = createSession()
    await events('turn/start', 1)
    await writeFile(path, Buffer.from([0x00, 0x01, 0x02, 0x03]))
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.current({ sessionId: id })
      return result.ok && result.value !== null && result.value.files.length > 0 ? result.value : undefined
    }, 'binary change set')
    const file = summary.files[0]
    expect(file?.kind).toBe('binary')
    expect(file?.summary).toBe('Binary file changed')
    expect(file?.beforeSize).toBe(3)
    expect(file?.afterSize).toBe(4)
  })

  it('skips a turn end without a before snapshot instead of failing', async () => {
    const { id, events } = createSession()
    await events('turn/end', 99)
    // Give any (incorrect) settle a chance to run, then assert absence.
    await new Promise(resolve => setTimeout(resolve, 150))
    const result = await monitor.current({ sessionId: id })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeNull()
  })

  it('trims history to maxHistory turns', async () => {
    // A dedicated monitor keeps only the two latest turns.
    const trimmedCtx = new Context()
    const trimmedStore = await mkdtemp(join(tmpdir(), 'dsh-change-store-trim-'))
    await trimmedCtx.plugin(SessionStore)
    await trimmedCtx.plugin(ChangeMonitorService, { ...BASE_CONFIG, maxHistory: 2, storeRoot: trimmedStore })
    const trimmedMonitor = trimmedCtx.get('changeMonitor')!
    const session = trimmedCtx.sessions.create(undefined, { meta: { cwd: workspace } })
    const trimmedEvents = async (type: 'turn/start' | 'turn/end', turn: number): Promise<void> => {
      if (type === 'turn/start') {
        session.append('turn/start', { turn })
        await new Promise(resolve => setTimeout(resolve, 120))
      } else {
        session.append('turn/end', { turn, reason: { kind: 'completed' } })
      }
    }
    for (let turn = 1; turn <= 3; turn += 1) {
      await trimmedEvents('turn/start', turn)
      await writeFile(join(workspace, `f${turn}.txt`), `v${turn}\n`, 'utf8')
      await trimmedEvents('turn/end', turn)
      await waitFor(async () => {
        const result = await trimmedMonitor.turn({ sessionId: session.id, turn })
        return result.ok && result.value !== null ? result.value : undefined
      }, `turn ${turn} record`)
    }
    const turns = await waitFor(async () => {
      const result = await trimmedMonitor.turns({ sessionId: session.id })
      return result.ok && result.value.length === 2 ? result.value : undefined
    }, 'trimmed history')
    expect(turns.map(entry => entry.turn).sort()).toEqual([2, 3])
    await trimmedCtx.fiber.dispose().catch(() => undefined)
    await rm(trimmedStore, { recursive: true, force: true })
  })

  it('records changes through the git candidate fast path', async () => {
    await git('git', ['init'], { cwd: workspace })
    await git('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace })
    await git('git', ['config', 'user.name', 'Test'], { cwd: workspace })
    await writeFile(join(workspace, 'tracked.txt'), 'v1\n', 'utf8')
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'init'], { cwd: workspace })

    const { id, events } = createSession(600)
    await events('turn/start', 1)
    // A tracked file modified during the turn (clean at turn start: the
    // before state must come from git HEAD via backfill), plus an untracked
    // file created mid-turn (no HEAD version: reported as added).
    await writeFile(join(workspace, 'tracked.txt'), 'v2\n', 'utf8')
    await writeFile(join(workspace, 'untracked.txt'), 'new\n', 'utf8')
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 1 })
      return result.ok && result.value !== null && result.value.files.length > 0 ? result.value : undefined
    }, 'git turn 1 record')
    const paths = summary.files.map(file => file.path).sort()
    expect(paths).toEqual(['tracked.txt', 'untracked.txt'])
    const tracked = summary.files.find(file => file.path === 'tracked.txt')
    expect(tracked?.status).toBe('modified')
    // The before text is the HEAD version (v1), never the disk state.
    const file = await monitor.file({ sessionId: id, turn: 1, path: 'tracked.txt' })
    expect(file.ok).toBe(true)
    if (file.ok) {
      const hunkLines = file.value.hunks.flatMap(hunk => hunk.lines)
      expect(hunkLines.some(line => line.kind === 'del' && line.text === 'v1')).toBe(true)
      expect(hunkLines.some(line => line.kind === 'add' && line.text === 'v2')).toBe(true)
    }
  })

  it('does not misreport a mid-turn commit of a dirty file as a deletion', async () => {
    await git('git', ['init'], { cwd: workspace })
    await git('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace })
    await git('git', ['config', 'user.name', 'Test'], { cwd: workspace })
    await writeFile(join(workspace, 'tracked.txt'), 'v1\n', 'utf8')
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'init'], { cwd: workspace })
    // Dirty at turn start: the before snapshot holds tracked.txt (v2).
    await writeFile(join(workspace, 'tracked.txt'), 'v2\n', 'utf8')

    const { id, events } = createSession(600)
    await events('turn/start', 1)
    // The turn commits the dirty file: the turn-end candidate set no longer
    // lists it, so without reconciliation the before file would read as
    // deleted. Its content is unchanged (v2 == before), so it must not.
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'mid-turn'], { cwd: workspace })
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 1 })
      return result.ok && result.value !== null ? result.value : undefined
    }, 'turn 1 after mid-turn commit')
    expect(summary.files).toEqual([])
  })

  it('reports a file committed twice mid-turn when the content moved on', async () => {
    await git('git', ['init'], { cwd: workspace })
    await git('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace })
    await git('git', ['config', 'user.name', 'Test'], { cwd: workspace })
    await writeFile(join(workspace, 'tracked.txt'), 'v1\n', 'utf8')
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'init'], { cwd: workspace })
    // Dirty at turn start: before holds v2.
    await writeFile(join(workspace, 'tracked.txt'), 'v2\n', 'utf8')

    const { id, events } = createSession(600)
    await events('turn/start', 1)
    // Commit v2, then edit to v3 and commit that too: the turn-end candidate
    // set is empty, but the disk differs from the before snapshot, so the
    // reconciliation must re-add it and report a modification.
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'v2'], { cwd: workspace })
    await writeFile(join(workspace, 'tracked.txt'), 'v3\n', 'utf8')
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'v3'], { cwd: workspace })
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 1 })
      return result.ok && result.value !== null && result.value.files.length > 0 ? result.value : undefined
    }, 'turn 1 after double commit')
    const tracked = summary.files.find(file => file.path === 'tracked.txt')
    expect(tracked?.status).toBe('modified')
  })

  it('reports a clean file modified and committed mid-turn as modified', async () => {
    await git('git', ['init'], { cwd: workspace })
    await git('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace })
    await git('git', ['config', 'user.name', 'Test'], { cwd: workspace })
    await writeFile(join(workspace, 'tracked.txt'), 'v1\n', 'utf8')
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'init'], { cwd: workspace })

    const { id, events } = createSession(600)
    await events('turn/start', 1)
    // Clean at turn start, modified and committed mid-turn: the turn-end
    // candidate set is empty, so the committed diff must re-add the file to
    // both sides and report a modification.
    await writeFile(join(workspace, 'tracked.txt'), 'v2\n', 'utf8')
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'v2'], { cwd: workspace })
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 1 })
      return result.ok && result.value !== null && result.value.files.length > 0 ? result.value : undefined
    }, 'turn 1 after clean-file commit')
    const tracked = summary.files.find(file => file.path === 'tracked.txt')
    expect(tracked?.status).toBe('modified')
  })

  it('reports a file added and committed mid-turn as added', async () => {
    await git('git', ['init'], { cwd: workspace })
    await git('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace })
    await git('git', ['config', 'user.name', 'Test'], { cwd: workspace })
    await writeFile(join(workspace, 'tracked.txt'), 'v1\n', 'utf8')
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'init'], { cwd: workspace })

    const { id, events } = createSession(600)
    await events('turn/start', 1)
    await writeFile(join(workspace, 'new.txt'), 'new\n', 'utf8')
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'add new'], { cwd: workspace })
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 1 })
      return result.ok && result.value !== null && result.value.files.length > 0 ? result.value : undefined
    }, 'turn 1 after add commit')
    const added = summary.files.find(file => file.path === 'new.txt')
    expect(added?.status).toBe('added')
  })

  it('reports a file deleted and committed mid-turn as deleted', async () => {
    await git('git', ['init'], { cwd: workspace })
    await git('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace })
    await git('git', ['config', 'user.name', 'Test'], { cwd: workspace })
    await writeFile(join(workspace, 'tracked.txt'), 'v1\n', 'utf8')
    await git('git', ['add', '.'], { cwd: workspace })
    await git('git', ['commit', '-m', 'init'], { cwd: workspace })

    const { id, events } = createSession(600)
    await events('turn/start', 1)
    await rm(join(workspace, 'tracked.txt'))
    await git('git', ['add', '-A'], { cwd: workspace })
    await git('git', ['commit', '-m', 'delete'], { cwd: workspace })
    await events('turn/end', 1)

    const summary = await waitFor(async () => {
      const result = await monitor.turn({ sessionId: id, turn: 1 })
      return result.ok && result.value !== null && result.value.files.length > 0 ? result.value : undefined
    }, 'turn 1 after delete commit')
    const deleted = summary.files.find(file => file.path === 'tracked.txt')
    expect(deleted?.status).toBe('deleted')
  })
})
