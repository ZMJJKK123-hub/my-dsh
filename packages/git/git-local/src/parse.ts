/**
 * Pure parsers for the NUL-delimited git formats the local provider runs:
 * `status --porcelain=v1 -z --branch`, `log --format` with unit/field
 * separators, and `for-each-ref` with NUL separators. No I/O — every function
 * is a pure projection of one command's output, so tests cover the formats
 * without spawning git.
 *
 * @module @dsh-custom/dsh-git-local
 */

import type { GitBranch, GitLogEntry, GitStatusEntry } from '@dsh-custom/dsh-git'

/** Branch header facts carried by `status --branch`. */
export interface StatusHeader {
  readonly branch: string | undefined
  readonly upstream: string | undefined
  readonly ahead: number
  readonly behind: number
  readonly initial: boolean
  readonly detached: boolean
}

/** `parseStatusZ` result: header plus entries. */
export interface ParsedStatus extends StatusHeader {
  readonly entries: readonly GitStatusEntry[]
}

const EMPTY_HEADER: StatusHeader = {
  branch: undefined, upstream: undefined, ahead: 0, behind: 0, initial: false, detached: false,
}

/**
 * Parse `git status --porcelain=v1 -z --branch` output. The first record is
 * the `## ` header when `--branch` produced one; each entry record is `XY <path>`,
 * and rename/copy entries carry their origin path as the next record.
 * @param output - raw stdout of the status command.
 */
export function parseStatusZ(output: string): ParsedStatus {
  const records = output.split('\0')
  const header = records[0] === undefined ? EMPTY_HEADER : parseBranchHeader(records[0])
  const entries: GitStatusEntry[] = []
  const body = header === EMPTY_HEADER ? records : records.slice(1)
  for (let index = 0; index < body.length; index += 1) {
    const record = body[index]
    if (record === undefined || record === '') continue
    const code = record.slice(0, 2)
    const path = record.slice(3)
    const renameOrigin = code[0] === 'R' || code[0] === 'C'
    const originPath = renameOrigin ? body[index + 1] : undefined
    if (renameOrigin) index += 1
    const untracked = code === '??'
    entries.push({
      code,
      path,
      originPath: originPath ?? undefined,
      staged: !untracked && code[0] !== undefined && code[0] !== ' ',
      unstaged: code[1] !== undefined && code[1] !== ' ',
      untracked,
    })
  }
  return { ...header, entries }
}

/** Parse the `## ` branch header record of `status --porcelain=v1 -z --branch`. */
function parseBranchHeader(record: string): StatusHeader {
  if (!record.startsWith('## ')) return EMPTY_HEADER
  const body = record.slice(3)
  if (body === 'HEAD (no branch)') {
    return { ...EMPTY_HEADER, detached: true }
  }
  if (body.startsWith('No commits yet on ')) {
    return { ...EMPTY_HEADER, initial: true, branch: body.slice('No commits yet on '.length) }
  }
  const dotIndex = body.indexOf('...')
  if (dotIndex === -1) return { ...EMPTY_HEADER, branch: body }
  const branch = body.slice(0, dotIndex)
  let rest = body.slice(dotIndex + 3)
  let upstream: string | undefined
  let ahead = 0
  let behind = 0
  const bracketIndex = rest.indexOf(' [')
  if (bracketIndex === -1) {
    upstream = rest === '' ? undefined : rest
  } else {
    upstream = rest.slice(0, bracketIndex)
    rest = rest.slice(bracketIndex + 2, rest.length - 1)
    if (rest !== 'gone') {
      for (const part of rest.split(', ')) {
        const aheadMatch = /^ahead (\d+)$/.exec(part)
        if (aheadMatch !== null) ahead = Number(aheadMatch[1])
        const behindMatch = /^behind (\d+)$/.exec(part)
        if (behindMatch !== null) behind = Number(behindMatch[1])
      }
    }
  }
  return { branch, upstream, ahead, behind, initial: false, detached: false }
}

/** Field separator of the `log` format string (`%x1f`). */
const FIELD = '\x1f'
/** Unit separator of the `log` format string (`%x1e`). */
const UNIT = '\x1e'

/**
 * Parse `git log --format='%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e'` output.
 * @param output - raw stdout of the log command.
 */
export function parseLog(output: string): readonly GitLogEntry[] {
  const entries: GitLogEntry[] = []
  for (const unit of output.split(UNIT)) {
    if (unit === '' || unit === '\n') continue
    const fields = unit.replace(/^\n/, '').split(FIELD)
    const [hash, shortHash, author, date, subject] = fields as [string, string, string, string, string]
    if (hash === undefined || shortHash === undefined || author === undefined || date === undefined || subject === undefined) {
      continue
    }
    entries.push({ hash, shortHash, author, date, subject })
  }
  return entries
}

/**
 * Parse `git for-each-ref --format='%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)' refs/heads` output.
 * @param output - raw stdout of the for-each-ref command.
 */
export function parseBranches(output: string): readonly GitBranch[] {
  const branches: GitBranch[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const fields = line.split('\0')
    const [name, headMark, upstream, shortHash] = fields as [string, string, string, string]
    if (name === undefined || headMark === undefined || upstream === undefined || shortHash === undefined) {
      continue
    }
    branches.push({
      name,
      current: headMark === '*',
      upstream: upstream === '' ? undefined : upstream,
      shortHash,
    })
  }
  return branches
}
