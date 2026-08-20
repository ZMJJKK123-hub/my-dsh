import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compileIgnorePatterns } from '../src/ignore.ts'
import {
  gitChangedPaths, readTextFile, sameMetadata, scanMetadata, snapshotCandidates, snapshotWorkspace,
} from '../src/snapshot.ts'

const MAX = 10 * 1024 * 1024
const git = promisify(execFile)

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-change-monitor-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Turn `dir` into a git repository with one initial commit. */
async function initGitRepo(): Promise<void> {
  await git('git', ['init'], { cwd: dir })
  await git('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await git('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, '.gitignore'), '*.log\n', 'utf8')
  await writeFile(join(dir, 'tracked.txt'), 'v1\n', 'utf8')
  await git('git', ['add', '.'], { cwd: dir })
  await git('git', ['commit', '-m', 'init'], { cwd: dir })
}

describe('snapshotWorkspace', () => {
  it('snapshots files with relative paths, hashes, and kinds', async () => {
    await mkdir(join(dir, 'core'), { recursive: true })
    await writeFile(join(dir, 'core', 'a.ts'), 'export const a = 1\n', 'utf8')
    await writeFile(join(dir, 'b.txt'), 'hello\n', 'utf8')
    const ignore = compileIgnorePatterns([])
    const snapshot = await snapshotWorkspace(dir, { maxSnapshotFileSize: MAX, ignore })
    expect([...snapshot.files.keys()].sort()).toEqual(['b.txt', 'core/a.ts'])
    const meta = snapshot.files.get('core/a.ts')
    expect(meta?.kind).toBe('text')
    expect(meta?.hash).toBeTruthy()
    expect(meta?.size).toBeGreaterThan(0)
  })

  it('skips ignored directories and files', async () => {
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'x.js'), 'x', 'utf8')
    await writeFile(join(dir, 'app.log'), 'log', 'utf8')
    await writeFile(join(dir, 'keep.ts'), 'keep', 'utf8')
    const ignore = compileIgnorePatterns([])
    const snapshot = await snapshotWorkspace(dir, { maxSnapshotFileSize: MAX, ignore })
    expect([...snapshot.files.keys()]).toEqual(['keep.ts'])
  })

  it('classifies NUL-containing files as binary', async () => {
    await writeFile(join(dir, 'img.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]))
    const ignore = compileIgnorePatterns([])
    const snapshot = await snapshotWorkspace(dir, { maxSnapshotFileSize: MAX, ignore })
    expect(snapshot.files.get('img.bin')?.kind).toBe('binary')
  })

  it('marks files above the cap as large without hashing', async () => {
    await writeFile(join(dir, 'big.bin'), Buffer.alloc(2048, 7))
    const ignore = compileIgnorePatterns([])
    const snapshot = await snapshotWorkspace(dir, { maxSnapshotFileSize: 1024, ignore })
    const meta = snapshot.files.get('big.bin')
    expect(meta?.kind).toBe('large')
    expect(meta?.hash).toBeNull()
    expect(meta?.size).toBe(2048)
  })

  it('omits retained content when retainContent is false', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello\n', 'utf8')
    const ignore = compileIgnorePatterns([])
    const snapshot = await snapshotWorkspace(dir, { maxSnapshotFileSize: MAX, ignore, retainContent: false })
    const meta = snapshot.files.get('a.txt')
    expect(meta?.hash).toBeTruthy()
    expect(meta?.kind).toBe('text')
    expect(meta?.content).toBeUndefined()
  })

  it('keeps the hash stable across identical rewrites', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'same\n', 'utf8')
    const ignore = compileIgnorePatterns([])
    const first = await snapshotWorkspace(dir, { maxSnapshotFileSize: MAX, ignore })
    await writeFile(path, 'same\n', 'utf8')
    const second = await snapshotWorkspace(dir, { maxSnapshotFileSize: MAX, ignore })
    expect(first.files.get('a.txt')?.hash).toBe(second.files.get('a.txt')?.hash)
  })

  it('tolerates an unreadable root by returning an empty snapshot', async () => {
    await rm(dir, { recursive: true, force: true })
    const ignore = compileIgnorePatterns([])
    const snapshot = await snapshotWorkspace(dir, { maxSnapshotFileSize: MAX, ignore })
    expect(snapshot.files.size).toBe(0)
  })
})

describe('scanMetadata / sameMetadata', () => {
  it('produces size+mtime tokens and agrees on identical trees', async () => {
    await writeFile(join(dir, 'a.txt'), 'a', 'utf8')
    const ignore = compileIgnorePatterns([])
    const first = await scanMetadata(dir, ignore)
    const second = await scanMetadata(dir, ignore)
    expect(sameMetadata(first, second)).toBe(true)
    expect(first.get('a.txt')?.size).toBe(1)
  })

  it('detects a changed tree', async () => {
    const ignore = compileIgnorePatterns([])
    const first = await scanMetadata(dir, ignore)
    await writeFile(join(dir, 'new.txt'), 'new', 'utf8')
    const second = await scanMetadata(dir, ignore)
    expect(sameMetadata(first, second)).toBe(false)
  })
})

describe('git candidate fast path', () => {
  it('lists changed paths for a git workspace', async () => {
    await initGitRepo()
    await writeFile(join(dir, 'tracked.txt'), 'v2\n', 'utf8')
    await writeFile(join(dir, 'untracked.txt'), 'new\n', 'utf8')
    await writeFile(join(dir, 'ignored.log'), 'x\n', 'utf8')
    await git('git', ['add', '.'], { cwd: dir })
    await writeFile(join(dir, 'staged.txt'), 'staged\n', 'utf8')

    const paths = await gitChangedPaths(dir)
    expect(paths).toBeDefined()
    expect([...(paths ?? [])].sort()).toEqual(['staged.txt', 'tracked.txt', 'untracked.txt'])
  })

  it('returns undefined outside a git repository', async () => {
    expect(await gitChangedPaths(dir)).toBeUndefined()
  })

  it('snapshots only the candidate paths', async () => {
    await initGitRepo()
    await writeFile(join(dir, 'tracked.txt'), 'v2\n', 'utf8')
    await writeFile(join(dir, 'untracked.txt'), 'new\n', 'utf8')
    const paths = (await gitChangedPaths(dir)) ?? []
    const ignore = compileIgnorePatterns([])
    const snapshot = await snapshotCandidates(dir, paths, { maxSnapshotFileSize: MAX, ignore })
    expect([...snapshot.files.keys()].sort()).toEqual(['tracked.txt', 'untracked.txt'])
    expect(snapshot.files.get('tracked.txt')?.content).toBe('v2\n')
  })
})

describe('readTextFile', () => {
  it('reads UTF-8 text and strips the BOM', async () => {
    const path = join(dir, 'utf8.txt')
    await writeFile(path, '\uFEFFhello\n', 'utf8')
    const text = await readTextFile(path, MAX)
    expect(text).toBe('hello\n')
  })

  it('returns null for binary, oversized, or missing files', async () => {
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0x00, 0x41]))
    await writeFile(join(dir, 'big.txt'), Buffer.alloc(4096, 65))
    expect(await readTextFile(join(dir, 'bin.dat'), MAX)).toBeNull()
    expect(await readTextFile(join(dir, 'big.txt'), 1024)).toBeNull()
    expect(await readTextFile(join(dir, 'missing.txt'), MAX)).toBeNull()
  })
})
