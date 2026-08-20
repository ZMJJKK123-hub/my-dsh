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
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, open, readdir, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
/** NUL bytes in the first probe window mark a file as binary. */
const BINARY_PROBE_BYTES = 8192;
/** Concurrent file reads inside one directory; bounds the open-handle count. */
const FILE_CONCURRENCY = 16;
/**
 * Snapshot every non-ignored file under `root`. Errors on individual files
 * (permission, races, encoding) are contained: the walker skips the file and
 * keeps going, so one unreadable path cannot fail the turn.
 * @param root - workspace root directory.
 * @param options - cap, ignore set, and content-retention choice.
 * @returns the snapshot, whose `files` map is never mutated afterwards.
 */
export async function snapshotWorkspace(root, options) {
    const files = new Map();
    const pending = [{ dir: root, rel: '' }];
    while (pending.length > 0) {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- the loop condition guarantees a pending entry
        const { dir, rel } = pending.pop();
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            continue; // Unreadable directory: skip it, never fail the turn.
        }
        const tasks = [];
        for (const entry of entries) {
            const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
            if (entry.isDirectory()) {
                if (entry.isSymbolicLink())
                    continue; // Do not follow directory symlinks.
                if (options.ignore.isIgnored(relPath, true))
                    continue;
                pending.push({ dir: join(dir, entry.name), rel: relPath });
                continue;
            }
            // Regular files and file symlinks (followed through their target's own
            // metadata by `stat` inside `metaOf`) share one task queue.
            tasks.push({ absolute: join(dir, entry.name), relPath });
        }
        // Read the directory's files with bounded concurrency; `metaOf` is
        // stat + read + hash, so parallelism matters on large trees while the
        // open-handle count stays low.
        for (let offset = 0; offset < tasks.length; offset += FILE_CONCURRENCY) {
            const batch = tasks.slice(offset, offset + FILE_CONCURRENCY);
            const metas = await Promise.all(batch.map(task => metaOf(task.absolute, task.relPath, options)));
            for (let index = 0; index < batch.length; index += 1) {
                const task = batch[index];
                const meta = metas[index];
                if (task !== undefined && meta !== undefined)
                    files.set(task.relPath, meta);
            }
        }
    }
    return { root, time: Date.now(), files };
}
/** Snapshot one regular file, or undefined when it vanished or is unreadable. */
async function metaOf(absolute, relPath, options) {
    if (options.ignore.isIgnored(relPath, false))
        return undefined;
    let info;
    try {
        info = await stat(absolute);
    }
    catch {
        return undefined;
    }
    if (!info.isFile())
        return undefined;
    if (info.size >= options.maxSnapshotFileSize) {
        return { size: info.size, mtimeNs: mtimeNs(info), hash: null, kind: 'large' };
    }
    const probe = options.retainContent === false
        ? await hashOf(absolute, info.size)
        : await hashAndContent(absolute, info.size);
    return {
        size: info.size,
        mtimeNs: mtimeNs(info),
        hash: probe === undefined ? null : probe.hash,
        kind: probe === undefined ? 'large' : probe.kind,
        ...(probe?.content === undefined ? {} : { content: probe.content }),
    };
}
/** Nanosecond mtime, with the inode fallback for filesystems without one. */
function mtimeNs(info) {
    if (info.mtimeNs !== undefined)
        return info.mtimeNs;
    return Math.floor(info.mtimeMs * 1e6);
}
/**
 * Stream one file once, hashing the full content and detecting binary by NUL
 * bytes in the probe window, without retaining the bytes — the cheap path for
 * the turn-end view whose texts are read from disk on demand.
 * @returns hash and kind, or undefined when the read failed mid-way.
 */
async function hashOf(absolute, size) {
    let handle;
    try {
        handle = await open(absolute, 'r');
    }
    catch {
        return undefined;
    }
    try {
        const hash = createHash('sha256');
        const buffer = Buffer.alloc(64 * 1024);
        let probed = 0;
        let binary = false;
        let position = 0;
        while (position < size) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            if (bytesRead === 0)
                break;
            if (!binary && probed < BINARY_PROBE_BYTES) {
                const window = Math.min(bytesRead, BINARY_PROBE_BYTES - probed);
                if (buffer.subarray(0, window).includes(0))
                    binary = true;
                probed += window;
            }
            hash.update(buffer.subarray(0, bytesRead));
            position += bytesRead;
        }
        return { hash: hash.digest('hex'), kind: binary ? 'binary' : 'text' };
    }
    catch {
        return undefined;
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
/**
 * Stream one file once, detecting binary by NUL bytes in the probe window,
 * hashing the full content in the same pass, and decoding text content for
 * retention (the turn-start baseline path).
 * @returns hash, kind, and (for text files) the decoded content, or undefined
 * when the read failed mid-way.
 */
async function hashAndContent(absolute, size) {
    let handle;
    try {
        handle = await open(absolute, 'r');
    }
    catch {
        return undefined;
    }
    try {
        const hash = createHash('sha256');
        const chunks = [];
        const buffer = Buffer.alloc(64 * 1024);
        let probed = 0;
        let binary = false;
        let position = 0;
        while (position < size) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            if (bytesRead === 0)
                break;
            if (!binary && probed < BINARY_PROBE_BYTES) {
                const window = Math.min(bytesRead, BINARY_PROBE_BYTES - probed);
                if (buffer.subarray(0, window).includes(0))
                    binary = true;
                probed += window;
            }
            hash.update(buffer.subarray(0, bytesRead));
            chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
            position += bytesRead;
        }
        if (binary)
            return { hash: hash.digest('hex'), kind: 'binary' };
        const decoder = new TextDecoder('utf-8', { fatal: true });
        try {
            const content = decoder.decode(Buffer.concat(chunks));
            return { hash: hash.digest('hex'), kind: 'text', content };
        }
        catch {
            // Not valid UTF-8: classify as binary so the diff never mangles it.
            return { hash: hash.digest('hex'), kind: 'binary' };
        }
    }
    catch {
        return undefined;
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
/**
 * Fast metadata-only scan of the workspace: `relPath -> size:mtime` tokens
 * without reading any content. Used to detect whether the tree has stopped
 * changing after a turn ends.
 */
export async function scanMetadata(root, ignore) {
    const tokens = new Map();
    const pending = [{ dir: root, rel: '' }];
    while (pending.length > 0) {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- the loop condition guarantees a pending entry
        const { dir, rel } = pending.pop();
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        const fileTasks = [];
        for (const entry of entries) {
            const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
            if (entry.isDirectory()) {
                if (entry.isSymbolicLink())
                    continue;
                if (ignore.isIgnored(relPath, true))
                    continue;
                pending.push({ dir: join(dir, entry.name), rel: relPath });
                continue;
            }
            if (ignore.isIgnored(relPath, false))
                continue;
            fileTasks.push({ dir, entry: entry.name, relPath });
        }
        // The settle check must be cheap even on huge trees; stat the files of
        // one directory with bounded concurrency like the snapshot walker.
        for (let offset = 0; offset < fileTasks.length; offset += FILE_CONCURRENCY) {
            const batch = fileTasks.slice(offset, offset + FILE_CONCURRENCY);
            const infos = await Promise.all(batch.map(task => stat(join(task.dir, task.entry)).catch(() => undefined)));
            for (let index = 0; index < batch.length; index += 1) {
                const task = batch[index];
                const info = infos[index];
                if (task !== undefined && info?.isFile()) {
                    tokens.set(task.relPath, { size: info.size, mtimeNs: mtimeNs(info) });
                }
            }
        }
    }
    return tokens;
}
/** Whether two metadata scans agree on the whole tree. */
export function sameMetadata(left, right) {
    if (left.size !== right.size)
        return false;
    for (const [path, token] of left) {
        const other = right.get(path);
        if (other === undefined || other.size !== token.size || other.mtimeNs !== token.mtimeNs)
            return false;
    }
    return true;
}
/**
 * Read one file's bytes as UTF-8 text, or report it as binary/large.
 * @param absolute - file path to read.
 * @param maxBytes - files at or above this size are reported as `large` without reading.
 * @returns decoded text, or null when the file is binary, oversized, or unreadable.
 */
export async function readTextFile(absolute, maxBytes) {
    let info;
    try {
        info = await stat(absolute);
    }
    catch {
        return null;
    }
    if (!info.isFile())
        return null;
    if (info.size >= maxBytes)
        return null;
    let handle;
    try {
        handle = await open(absolute, 'r');
    }
    catch {
        return null;
    }
    try {
        const buffer = Buffer.alloc(info.size || 1);
        let position = 0;
        while (position < info.size) {
            const { bytesRead } = await handle.read(buffer, position, info.size - position, position);
            if (bytesRead === 0)
                break;
            position += bytesRead;
        }
        const bytes = position === buffer.length ? buffer : buffer.subarray(0, position);
        if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0))
            return null;
        const decoder = new TextDecoder('utf-8', { fatal: true });
        try {
            return decoder.decode(bytes);
        }
        catch {
            return null; // Not valid UTF-8: treat as binary rather than mangling it.
        }
    }
    catch {
        return null;
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
/** Normalize a workspace-relative path to forward slashes for storage. */
export function toRelativePath(root, absolute) {
    return absolute.replaceAll(sep, '/').replaceAll(`${root.replaceAll(sep, '/')}/`, '');
}
/** Whether a stored relative path stays inside the workspace (no traversal). */
export function isSafeRelativePath(path) {
    if (path === '' || path.startsWith('/') || /^[a-zA-Z]:/.test(path))
        return false;
    if (path.split('/').some(segment => segment === '..'))
        return false;
    if (path.includes('\\'))
        return false; // Stored paths are forward-slash only.
    return true;
}
/** Reject an absolute path outside the root before any file access. */
export function assertInsideRoot(root, absolute) {
    const normalized = absolute.replaceAll(sep, '/');
    const rootNormalized = root.replaceAll(sep, '/');
    if (!normalized.startsWith(`${rootNormalized}/`) && normalized !== rootNormalized) {
        throw new Error(`path ${JSON.stringify(absolute)} escapes workspace root ${JSON.stringify(root)}`);
    }
}
/** lstat-based directory check used by tests and the walker's helpers. */
export async function isDirectory(absolute) {
    try {
        return (await lstat(absolute)).isDirectory();
    }
    catch {
        return false;
    }
}
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
export async function gitChangedPaths(root) {
    // Probe for the repository by filesystem first: spawning git on every
    // turn-start costs hundreds of milliseconds, which would let a short
    // turn's before-snapshot drift past the first writes. Non-git workspaces
    // resolve immediately without any process.
    if (!await hasGitRoot(root))
        return undefined;
    let stdout;
    try {
        const result = await execFileAsync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
            cwd: root, encoding: 'utf8', timeout: 10_000,
        });
        stdout = result.stdout;
    }
    catch {
        return undefined;
    }
    const paths = [];
    for (const entry of stdout.split('\0')) {
        if (entry === '')
            continue;
        // Porcelain v1 entry: `XY path` (rename: `R  old -> new` — keep the
        // destination). The -z form has no quoting or newlines to undo.
        let path = entry.length >= 3 ? entry.slice(3) : entry;
        const arrow = path.indexOf(' -> ');
        if (arrow !== -1)
            path = path.slice(arrow + 4);
        if (path !== '')
            paths.push(path);
    }
    return paths;
}
/**
 * The current HEAD commit hash, or undefined when the repository has no
 * commits or git is unavailable.
 * @param root - workspace root directory.
 * @returns the HEAD commit hash, or undefined.
 */
export async function gitHead(root) {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
            cwd: root, encoding: 'utf8', timeout: 10_000,
        });
        const head = stdout.trim();
        return head === '' ? undefined : head;
    }
    catch {
        return undefined;
    }
}
/**
 * Paths changed between two commits (`git diff --name-status`). Renames and
 * copies are reported as one entry with `oldPath`; every other change is a
 * single-path entry. Returns an empty array when git fails.
 * @param root - workspace root directory.
 * @param from - start commit.
 * @param to - end commit.
 * @returns the changed-path entries.
 */
export async function gitDiffNameStatus(root, from, to) {
    try {
        const { stdout } = await execFileAsync('git', ['diff', '--name-status', '-z', '--diff-filter=ACDMRT', from, to], {
            cwd: root, encoding: 'utf8', timeout: 10_000,
        });
        const tokens = stdout.split('\0');
        const entries = [];
        for (let index = 0; index < tokens.length;) {
            const status = tokens[index];
            index += 1;
            if (status === undefined || status === '')
                continue;
            const code = status[0];
            if (code === 'R' || code === 'C') {
                const oldPath = tokens[index];
                const path = tokens[index + 1];
                index += 2;
                if (oldPath !== undefined && path !== undefined && path !== '') {
                    entries.push({ kind: 'renamed', path, oldPath });
                }
            }
            else {
                const path = tokens[index];
                index += 1;
                if (path !== undefined && path !== '') {
                    const kind = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
                    entries.push({ kind, path });
                }
            }
        }
        return entries;
    }
    catch {
        return [];
    }
}
/**
 * Read one workspace-relative path's content at a git revision, or null when
 * that revision lacks the path or the content is binary.
 * @param root - workspace root directory.
 * @param rev - git revision (commit hash, branch, or HEAD).
 * @param path - workspace-relative path.
 * @returns the file's UTF-8 text, or null.
 */
export async function readGitFile(root, rev, path) {
    try {
        const { stdout } = await execFileAsync('git', ['show', `${rev}:${path}`], { cwd: root, encoding: 'buffer', timeout: 10_000 });
        if (stdout.subarray(0, 8192).includes(0))
            return null;
        return stdout.toString('utf8');
    }
    catch {
        return null;
    }
}
/**
 * Whether `root` sits inside a git repository: walk up from the root
 * looking for a `.git` directory or worktree file (bounded depth). Pure
 * filesystem probes — no process spawn.
 * @param root - workspace root directory.
 * @returns true when a repository boundary is found.
 */
async function hasGitRoot(root) {
    let dir = root;
    for (let depth = 0; depth < 12; depth += 1) {
        try {
            const probe = await stat(join(dir, '.git'));
            if (probe.isDirectory() || probe.isFile())
                return true;
        }
        catch {
            // No .git here; walk up one level.
        }
        const parent = dirname(dir);
        if (parent === dir)
            return false;
        dir = parent;
    }
    return false;
}
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
export async function snapshotCandidates(root, paths, options, before) {
    const files = new Map();
    for (let offset = 0; offset < paths.length; offset += FILE_CONCURRENCY) {
        const batch = paths.slice(offset, offset + FILE_CONCURRENCY);
        const metas = await Promise.all(batch.map(path => metaOf(join(root, path), path, options)));
        for (let index = 0; index < batch.length; index += 1) {
            // oxlint-disable-next-line typescript/no-non-null-assertion -- batch and metas share lengths
            const path = batch[index];
            const meta = metas[index];
            if (path !== undefined && meta !== undefined)
                files.set(path, meta);
        }
    }
    if (before !== undefined) {
        for (const [path] of before.files) {
            if (files.has(path))
                continue;
            const meta = await metaOf(join(root, path), path, options);
            if (meta === undefined)
                continue; // Gone from disk: a genuine deletion.
            // Survivor (committed mid-turn, possibly edited again): re-add it; the
            // diff engine drops hash-identical entries and reports a changed one as
            // modified. Without this a mid-turn commit would misread every
            // committed file as deleted.
            files.set(path, meta);
        }
    }
    return { root, time: Date.now(), files };
}
/** Promisified git invocation (git status / git show). */
export function execFileAsync(file, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(file, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'ignore'] });
        const chunks = [];
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, options.timeout);
        child.stdout.on('data', (chunk) => { chunks.push(chunk); });
        child.on('error', reject);
        child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) {
                reject(new Error(`git ${file} timed out`));
                return;
            }
            if (code !== 0) {
                reject(new Error(`git ${file} exited ${String(code)}`));
                return;
            }
            const stdout = Buffer.concat(chunks);
            // The generic conditional return type cannot narrow from the runtime branch.
            // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
            resolve({ stdout: (options.encoding === 'utf8' ? stdout.toString('utf8') : stdout) });
        });
    });
}
//# sourceMappingURL=snapshot.js.map