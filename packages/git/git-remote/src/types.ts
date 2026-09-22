/**
 * Wire types of the `gitRemote` Typert Remote namespace: every request
 * carries the session id (the host resolves the workspace root from it, so
 * the same panel means the right repository per session) and every answer is
 * a discriminated result — a Remote call never rejects. The view types are
 * this package's own wire contract: mutable arrays and omitted-when-absent
 * optional fields, the lossless-JSON shape a snapshot must carry.
 *
 * @module @dsh-custom/dsh-git-remote
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** One Remote answer: the value, or the failure the panel renders. */
export type GitRemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string; readonly denied?: boolean }

/** One working-tree entry of the status view. */
export interface GitRemoteStatusEntry {
  readonly code: string
  readonly path: string
  readonly staged: boolean
  readonly unstaged: boolean
  readonly untracked: boolean
  readonly originPath?: string
}

/** Status view: branch header facts plus every entry. */
export interface GitRemoteStatusView {
  readonly root: string
  readonly ahead: number
  readonly behind: number
  readonly initial: boolean
  readonly detached: boolean
  readonly branch?: string
  readonly upstream?: string
  readonly entries: readonly GitRemoteStatusEntry[]
}

/** Diff view: one unified patch, possibly truncated. */
export interface GitRemoteDiffView {
  readonly staged: boolean
  readonly patch: string
  readonly truncated: boolean
  readonly path?: string
}

/** One commit of the log view. */
export interface GitRemoteLogEntry {
  readonly hash: string
  readonly shortHash: string
  readonly author: string
  readonly date: string
  readonly subject: string
}

/** Log view: commits, newest first. */
export interface GitRemoteLogView {
  readonly entries: readonly GitRemoteLogEntry[]
}

/** One local branch of the branch-list view. */
export interface GitRemoteBranch {
  readonly name: string
  readonly current: boolean
  readonly shortHash: string
  readonly upstream?: string
}

/** Branch-list view. */
export interface GitRemoteBranchListView {
  readonly branches: readonly GitRemoteBranch[]
}

/** Staging view: the cumulative staged paths after one mutation. */
export interface GitRemoteStageView {
  readonly stagedPaths: readonly string[]
}

/** Commit view: the created commit's identity. */
export interface GitRemoteCommitView {
  readonly hash: string
  readonly shortHash: string
  readonly subject: string
}

/** Push view: the push target echo. */
export interface GitRemotePushView {
  readonly remote: string
  readonly branch: string
  readonly setUpstream: boolean
}

/** Selection of what one staging pass covers. */
export interface GitRemoteStageRequest {
  readonly sessionId: SessionId
  readonly paths?: readonly string[]
  readonly all?: boolean
}

/** Diff request: work tree against index, or index against HEAD. */
export interface GitRemoteDiffRequest {
  readonly sessionId: SessionId
  readonly staged?: boolean
  readonly path?: string
}

/** Commit request: the message's first line becomes the subject. */
export interface GitRemoteCommitRequest {
  readonly sessionId: SessionId
  readonly message: string
}

/** Push request: defaults follow the branch's tracking remote. */
export interface GitRemotePushRequest {
  readonly sessionId: SessionId
  readonly remote?: string
  readonly branch?: string
  readonly setUpstream?: boolean
}

/** Log request: newest-first commit list. */
export interface GitRemoteLogRequest {
  readonly sessionId: SessionId
  readonly maxCount?: number
  readonly ref?: string
  readonly path?: string
}

/** Session-scoped requests that carry no further options. */
export interface GitRemoteSessionRequest {
  readonly sessionId: SessionId
}
