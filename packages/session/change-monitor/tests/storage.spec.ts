import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ChangeSetStore } from '../src/storage.ts'
import type { StoredChangeSet } from '../src/types.ts'

// Module-level mock so the rename failure can be scripted: ESM namespace
// exports are not spyable after import.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})
import { rename as renameMock } from 'node:fs/promises'

const renameMocked = renameMock as ReturnType<typeof vi.fn>

let storeRoot: string
let store: ChangeSetStore

const SESSION = 'session' as SessionId

function record(turn: number): StoredChangeSet {
  return {
    sessionId: SESSION,
    turn,
    startedAt: turn * 1000,
    finishedAt: turn * 1000 + 500,
    root: '/w',
    files: [],
    additions: 0,
    deletions: 0,
  }
}

beforeEach(async () => {
  storeRoot = await mkdtemp(join(tmpdir(), 'dsh-store-spec-'))
  store = new ChangeSetStore({ storeRoot, maxHistory: 100 })
})

afterEach(async () => {
  await rm(storeRoot, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('ChangeSetStore', () => {
  it('appends and loads records in chronological order', async () => {
    await store.append(record(1))
    await store.append(record(2))
    const turns = await store.loadTurns(SESSION)
    expect(turns.map(turn => turn.turn)).toEqual([1, 2])
  })

  it('trims history to maxHistory, keeping the newest turns', async () => {
    const small = new ChangeSetStore({ storeRoot, maxHistory: 2 })
    for (let turn = 1; turn <= 4; turn += 1) await small.append(record(turn))
    const turns = await small.loadTurns(SESSION)
    expect(turns.map(turn => turn.turn)).toEqual([3, 4])
  })

  it('serializes concurrent appends without interleaving', async () => {
    await Promise.all([1, 2, 3, 4, 5].map(turn => store.append(record(turn))))
    const turns = await store.loadTurns(SESSION)
    expect(turns.map(turn => turn.turn)).toEqual([1, 2, 3, 4, 5])
  })

  it('falls back to an in-place write when every rename attempt fails', async () => {
    await store.append(record(1))
    renameMocked.mockRejectedValue(Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }))
    try {
      await store.append(record(2))
      // The record must survive despite the locked rename.
      const turns = await store.loadTurns(SESSION)
      expect(turns.map(turn => turn.turn)).toEqual([1, 2])
      // The temporary file is cleaned up after the fallback write.
      await expect(readFile(join(storeRoot, `${SESSION}.jsonl.tmp`), 'utf8')).rejects.toThrow()
    } finally {
      renameMocked.mockReset()
    }
  })

  it('recovers a record stranded in a leftover tmp file', async () => {
    await store.append(record(1))
    // Simulate the crash window: main file has turn 1 only, tmp has 1 and 2.
    const main = join(storeRoot, `${SESSION}.jsonl`)
    const temporary = join(storeRoot, `${SESSION}.jsonl.tmp`)
    await writeFile(temporary, `${await readFile(main, 'utf8')}${JSON.stringify(record(2))}\n`, 'utf8')
    const turns = await store.loadTurns(SESSION)
    expect(turns.map(turn => turn.turn)).toEqual([1, 2])
    // The next append merges the tmp record instead of overwriting it.
    await store.append(record(3))
    const after = await store.loadTurns(SESSION)
    expect(after.map(turn => turn.turn)).toEqual([1, 2, 3])
  })

  it('drops a corrupt tail line but keeps committed records', async () => {
    await store.append(record(1))
    const main = join(storeRoot, `${SESSION}.jsonl`)
    await writeFile(main, `${await readFile(main, 'utf8')}{"torn"\n`, 'utf8')
    const turns = await store.loadTurns(SESSION)
    expect(turns.map(turn => turn.turn)).toEqual([1])
  })
})
