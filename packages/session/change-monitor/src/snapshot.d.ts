/**
 * Workspace snapshotting: a bounded walk of the workspace root recording
 * per-file metadata (size, mtime, content hash, text/binary/large kind).
 * The turn-start baseline retains decoded content (the disk is overwritten
 * by the turn, so only the snapshot can later supply the before text); the
 * turn-end view keeps metadata and hash only, and the diff engine re-reads
 * changed files from disk — so the expensive retained-content path runs
 * once per turn, not twice. A fast metadata-only scan supports the settle
 * check.
 *
 * @module @deepseek-ai/dsh-change-monitor
 */
import type { CompiledIgnore } from './ignore.ts'
/** How a file is classified for diffing. */
export type SnapshotFileKind = 'text' | 'binary' | 'large'
/** Immutable per-file snapshot metadata. */
export interface SnapshotFileMeta {
  readonly size: number
  readonly mtimeNs: number
  /** SHA-256 hex over the file bytes; null for files above the snapshot cap. */
  readonly hash: string | null
  readonly kind: SnapshotFileKind
  /**
     * Decoded UTF-8 content, retained for text files at or below the snapshot
     * cap. The diff engine reads ONLY this snapshot content — never the disk —
     * so a file modified after its snapshot still diffs against what the
     * snapshot saw. Held transiently for the turn window, then released.
     */
  readonly content?: string
}
/** One point-in-time view of the workspace. */
export interface WorkspaceSnapshot {
  readonly root: string
  readonly time: number
  readonly files: ReadonlyMap<string, SnapshotFileMeta>
}
/** Snapshot behavior knobs (monitor config supplies the values). */
export interface SnapshotOptions {
  /** Files at or above this byte size get metadata only (no hash). */
  readonly maxSnapshotFileSize: number
  /** Compiled ignore set. */
  readonly ignore: CompiledIgnore
  /**
     * Retain decoded UTF-8 content for text files at or below the cap. The
     * turn-start baseline must retain content (the disk is overwritten by the
     * turn, so only the snapshot can later supply the before text); the
     * turn-end view can skip it and the diff reads changed files from disk.
     * Defaults to true.
     */
  readonly retainContent?: boolean
}
/**
 * Snapshot every non-ignored file under `root`. Errors on individual files
 * (permission, races, encoding) are contained: the walker skips the file and
 * keeps going, so one unreadable path cannot fail the turn.
 * @param root - workspace root directory.
 * @param options - cap, ignore set, and content-retention choice.
 * @returns the snapshot, whose `files` map is never mutated afterwards.
 */
export declare function snapshotWorkspace(root: string, options: SnapshotOptions): Promise<WorkspaceSnapshot>
/** One file's quick stability token for the settle check. */
export interface MetadataToken {
  readonly size: number
  readonly mtimeNs: number
}
/**
 * Fast metadata-only scan of the workspace: `relPath -> size:mtime` tokens
 * without reading any content. Used to detect whether the tree has stopped
 * changing after a turn ends.
 */
export declare function scanMetadata(root: string, ignore: CompiledIgnore): Promise<Map<string, MetadataToken>>
/** Whether two metadata scans agree on the whole tree. */
export declare function sameMetadata(left: ReadonlyMap<string, MetadataToken>, right: ReadonlyMap<string, MetadataToken>): boolean
/**
 * Read one file's bytes as UTF-8 text, or report it as binary/large.
 * @param absolute - file path to read.
 * @param maxBytes - files at or above this size are reported as `large` without reading.
 * @returns decoded text, or null when the file is binary, oversized, or unreadable.
 */
export declare function readTextFile(absolute: string, maxBytes: number): Promise<string | null>
/** Normalize a workspace-relative path to forward slashes for storage. */
export declare function toRelativePath(root: string, absolute: string): string
/** Whether a stored relative path stays inside the workspace (no traversal). */
export declare function isSafeRelativePath(path: string): boolean
/** Reject an absolute path outside the root before any file access. */
export declare function assertInsideRoot(root: string, absolute: string): void
/** lstat-based directory check used by tests and the walker's helpers. */
export declare function isDirectory(absolute: string): Promise<boolean>
/**
 * The workspace's changed paths according to git — modified, added, deleted,
 * and untracked files relative to HEAD, in forward-slash form. This is the
 * fast path for large trees: instead of walking every file, only the git
 * candidate set is snapshotted. Returns undefined when the root is not a git
 * repository (or git is unavailable), which keeps the full-tree walk as the
 * fallback.
 * @param root - workspace root directory.
 * @returns candidate paths, or undefined for non-git workspaces.
 */
export declare function gitChangedPaths(root: string): Promise<string[] | undefined>
/** One path changed between two git commits, in forward-slash form. */
export interface GitDiffEntry {
  readonly kind: 'added' | 'deleted' | 'modified' | 'renamed'
  /** The current path (for renames, the destination). */
  readonly path: string
  /** The previous path, present only for renames. */
  readonly oldPath?: string
}
/**
 * The current HEAD commit hash, or undefined when the repository has no
 * commits or git is unavailable.
 * @param root - workspace root directory.
 * @returns the HEAD commit hash, or undefined.
 */
export declare function gitHead(root: string): Promise<string | undefined>
/**
 * Paths changed between two commits (`git diff --name-status`). Renames and
 * copies are reported as one entry with `oldPath`; every other change is a
 * single-path entry. Returns an empty array when git fails.
 * @param root - workspace root directory.
 * @param from - start commit.
 * @param to - end commit.
 * @returns the changed-path entries.
 */
export declare function gitDiffNameStatus(root: string, from: string, to: string): Promise<GitDiffEntry[]>
/**
 * Read one workspace-relative path's content at a git revision, or null when
 * that revision lacks the path or the content is binary.
 * @param root - workspace root directory.
 * @param rev - git revision (commit hash, branch, or HEAD).
 * @param path - workspace-relative path.
 * @returns the file's UTF-8 text, or null.
 */
export declare function readGitFile(root: string, rev: string, path: string): Promise<string | null>
/**
 * Snapshot only the given workspace-relative paths (the git candidate set).
 * Directory entries are rejected (git status lists files, not directories,
 * with `--untracked-files=all`); the walker's per-file error containment
 * applies per candidate.
 *
 * When `before` is supplied, paths present there but absent from the
 * candidate set are reconciled: a file still on disk whose content changed
 * (e.g. committed mid-turn, then edited again) is re-added so the diff sees
 * it; a file still on disk with unchanged content (committed mid-turn, or
 * never touched) stays out; only a file gone from disk reads as deleted.
 * Without this, a mid-turn commit would misreport every committed file as
 * deleted (the before set holds it, the turn-end candidate set no longer
 * does).
 * @param root - workspace root directory.
 * @param paths - candidate paths relative to the root.
 * @param options - cap, ignore set, and content-retention choice.
 * @param before - the turn-start snapshot whose missing paths to reconcile.
 * @returns the candidate snapshot.
 */
export declare function snapshotCandidates(root: string, paths: readonly string[], options: SnapshotOptions, before?: WorkspaceSnapshot): Promise<WorkspaceSnapshot>
/** Promisified git invocation (git status / git show). */
export declare function execFileAsync<E extends 'utf8' | 'buffer'>(file: string, args: readonly string[], options: {
  cwd: string
  encoding: E
  timeout: number
}): Promise<{
  stdout: E extends 'buffer' ? Buffer : string
}>
//# sourceMappingURL=snapshot.d.ts.map
