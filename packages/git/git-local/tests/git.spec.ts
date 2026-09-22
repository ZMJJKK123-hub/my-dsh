import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalGitService from '@dsh-custom/dsh-git-local'
import { GitError } from '@dsh-custom/dsh-git'
import { parseBranches, parseLog, parseStatusZ } from '../src/parse.ts'
const exec = promisify(execFile)

/** Run setup git in a fixture repo (identity inline; nothing to configure). */
async function setupGit(cwd: string, args: readonly string[]): Promise<void> {
  await exec('git', ['-c', 'user.name=dsh-test', '-c', 'user.email=dsh-test@example.com', ...args], { cwd })
}

/** Normalize a Windows/POSIX absolute path for comparison. */
function norm(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '')
}

describe('parseStatusZ', () => {
  it('parses the branch header with ahead/behind', () => {
    const parsed = parseStatusZ('## main...origin/main [ahead 1, behind 2]\0A  new.ts\0\0')
    expect(parsed.branch).toBe('main')
    expect(parsed.upstream).toBe('origin/main')
    expect(parsed.ahead).toBe(1)
    expect(parsed.behind).toBe(2)
    expect(parsed.initial).toBe(false)
    expect(parsed.detached).toBe(false)
    expect(parsed.entries).toHaveLength(1)
  })

  it('parses staged, unstaged, and untracked entries', () => {
    const parsed = parseStatusZ('## main\0M  staged.ts\0 M unstaged.ts\0MM both.ts\0?? fresh.ts\0\0')
    const [staged, unstaged, both, fresh] = parsed.entries
    expect(staged).toMatchObject({ path: 'staged.ts', staged: true, unstaged: false })
    expect(unstaged).toMatchObject({ path: 'unstaged.ts', staged: false, unstaged: true })
    expect(both).toMatchObject({ path: 'both.ts', staged: true, unstaged: true })
    expect(fresh).toMatchObject({ path: 'fresh.ts', untracked: true, staged: false, unstaged: true })
  })

  it('pairs rename origin paths from the following record', () => {
    const parsed = parseStatusZ('## main\0R  renamed.ts\0original.ts\0\0')
    expect(parsed.entries[0]).toMatchObject({ path: 'renamed.ts', originPath: 'original.ts' })
  })

  it('parses the unborn and detached headers', () => {
    expect(parseStatusZ('## No commits yet on main\0\0')).toMatchObject({ initial: true, branch: 'main' })
    expect(parseStatusZ('## HEAD (no branch)\0\0')).toMatchObject({ detached: true, branch: undefined })
  })
})

describe('parseLog', () => {
  it('parses units and fields, skipping the trailing separator', () => {
    const output = 'abc123\x1fshort1\x1falice\x1f2026-09-22T10:00:00+08:00\x1ffirst subject\x1e'
      + '\ndef456\x1fshort2\x1fbob\x1f2026-09-21T09:00:00Z\x1fsecond subject\x1e'
    const entries = parseLog(output)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ hash: 'abc123', shortHash: 'short1', author: 'alice', subject: 'first subject' })
    expect(entries[1]).toMatchObject({ hash: 'def456', author: 'bob', subject: 'second subject' })
  })

  it('returns empty for empty output', () => {
    expect(parseLog('')).toHaveLength(0)
  })
})

describe('parseBranches', () => {
  it('parses name, current mark, upstream, and hash', () => {
    const branches = parseBranches('main\0*\0origin/main\0abcd123\nfeature\0 \0\0ef01\n')
    expect(branches[0]).toMatchObject({ name: 'main', current: true, upstream: 'origin/main', shortHash: 'abcd123' })
    expect(branches[1]).toMatchObject({ name: 'feature', current: false, upstream: undefined, shortHash: 'ef01' })
  })
})

describe('LocalGitService', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-git-local-spec-'))
  const repo = join(scratch, 'repo')
  const outside = join(scratch, 'outside')
  const ctx = new Context()

  beforeAll(async () => {
    mkdirSync(repo)
    mkdirSync(outside)
    await exec('git', ['init', '-b', 'main'], { cwd: repo })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitService, {})
  })

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('resolveRoot finds the repo and reports undefined outside one', async () => {
    expect(norm(await ctx.git.resolveRoot(repo) ?? '')).toBe(norm(repo))
    expect(await ctx.git.resolveRoot(outside)).toBeUndefined()
  })

  it('status reports the unborn branch and untracked files', async () => {
    writeFileSync(join(repo, 'hello.txt'), 'hello\n')
    const summary = await ctx.git.status(repo)
    expect(summary.initial).toBe(true)
    expect(summary.branch).toBe('main')
    expect(summary.entries).toHaveLength(1)
    expect(summary.entries[0]).toMatchObject({ path: 'hello.txt', untracked: true })
  })

  it('status rejects outside a repository', async () => {
    await expect(ctx.git.status(outside)).rejects.toBeInstanceOf(GitError)
  })

  it('log resolves empty on the unborn branch', async () => {
    expect((await ctx.git.log(repo)).entries).toHaveLength(0)
  })

  it('diff, log, and branches reflect a commit and an unstaged edit', async () => {
    await setupGit(repo, ['add', 'hello.txt'])
    await setupGit(repo, ['commit', '-m', 'first'])
    writeFileSync(join(repo, 'hello.txt'), 'hello world\n')

    const status = await ctx.git.status(repo)
    expect(status.initial).toBe(false)
    expect(status.entries[0]).toMatchObject({ path: 'hello.txt', staged: false, unstaged: true })

    const diff = await ctx.git.diff(repo)
    expect(diff.staged).toBe(false)
    expect(diff.patch).toContain('+hello world')

    const staged = await ctx.git.diff(repo, { staged: true })
    expect(staged.patch).toBe('')

    const log = await ctx.git.log(repo)
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]).toMatchObject({ author: 'dsh-test', subject: 'first' })

    const branches = await ctx.git.branches(repo)
    expect(branches.branches).toHaveLength(1)
    expect(branches.branches[0]).toMatchObject({ name: 'main', current: true })

    await setupGit(repo, ['add', 'hello.txt'])
    const stagedAfterAdd = await ctx.git.diff(repo, { staged: true })
    expect(stagedAfterAdd.patch).toContain('+hello world')
  }, 60_000)

  it('diff honors the path filter and byte cap', async () => {
    // The previous test staged hello.txt; make a fresh unstaged edit so the
    // work-tree diff of that path is non-empty again.
    writeFileSync(join(repo, 'hello.txt'), 'hello world again\n')
    writeFileSync(join(repo, 'other.txt'), 'other\n')
    const onlyHello = await ctx.git.diff(repo, { path: 'hello.txt' })
    expect(onlyHello.patch).toContain('hello.txt')
    expect(onlyHello.patch).not.toContain('other.txt')
    const capped = await ctx.git.diff(repo, { maxBytes: 4_096 })
    expect(typeof capped.patch).toBe('string')
  }, 60_000)

  it('stage and unstage move index entries and report cumulative staged paths', async () => {
    writeFileSync(join(repo, 'feature.txt'), 'feature\n')
    const staged = await ctx.git.stage(repo, { paths: ['feature.txt'] })
    expect(staged.stagedPaths).toContain('feature.txt')
    const status = await ctx.git.status(repo)
    expect(status.entries.some(entry => entry.path === 'feature.txt' && entry.staged)).toBe(true)

    const unstaged = await ctx.git.unstage(repo, { paths: ['feature.txt'] })
    expect(unstaged.stagedPaths).not.toContain('feature.txt')
    await expect(ctx.git.stage(repo, {})).rejects.toBeInstanceOf(GitError)
  }, 60_000)

  it('commit creates a commit and reports its hash and subject', async () => {
    await ctx.git.stage(repo, { all: true })
    const commit = await ctx.git.commit(repo, { message: 'add feature\n\nlonger body' })
    expect(commit.subject).toBe('add feature')
    expect(commit.shortHash).toMatch(/^[0-9a-f]+$/)
    const log = await ctx.git.log(repo)
    expect(log.entries[0]?.subject).toBe('add feature')
    await expect(ctx.git.commit(repo, { message: '   ' })).rejects.toBeInstanceOf(GitError)
    await expect(ctx.git.commit(repo, { message: 'nothing staged ideally' })).rejects.toBeInstanceOf(GitError)
  }, 60_000)

  it('push sends the branch to a local bare remote and sets upstream', async () => {
    const remotePath = join(scratch, 'remote.git')
    await exec('git', ['init', '--bare', 'remote.git'], { cwd: scratch })
    await exec('git', ['remote', 'add', 'origin', remotePath.replaceAll('\\', '/')], { cwd: repo })
    await exec('git', ['config', 'protocol.file.allow', 'always'], { cwd: repo })
    const pushed = await ctx.git.push(repo, { remote: 'origin', setUpstream: true })
    expect(pushed.remote).toBe('origin')
    expect(pushed.branch).toBe('main')
    const status = await ctx.git.status(repo)
    expect(status.upstream).toBe('origin/main')
  }, 60_000)
})
