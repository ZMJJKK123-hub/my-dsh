/**
 * Per-turn file-change monitor: observes `session/event` for `turn/start` and
 * `turn/end`, snapshots the session workspace around each turn, diffs the two
 * snapshots at turn end, and persists the resulting change set. Exposes the
 * changeMonitor Remote namespace to the Web Client.
 *
 * The monitor is strictly best-effort: any failure inside snapshotting,
 * diffing, or storage is logged as a warning and never affects the agent
 * turn. Diff results are always computed from the turn's own before/after
 * snapshots, never from later disk state, so each turn's panel shows exactly
 * what that turn changed — including files the agent wrote and later restored
 * (those end up hash-equal and are reported as unchanged).
 *
 * @module @deepseek-ai/dsh-change-monitor
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import z from '@deepseek-ai/schemastery';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { DEFAULT_CONTEXT_LINES, DEFAULT_MAX_DIFF_CELLS, diffText, } from "./diff.js";
import { compileIgnorePatterns } from "./ignore.js";
import { sameMetadata, scanMetadata, snapshotWorkspace, readTextFile, gitChangedPaths, snapshotCandidates, gitDiffNameStatus, gitHead, readGitFile, } from "./snapshot.js";
import { ChangeSetStore, mergeSessionChangeSets, storedFileOf, summarizeChangeSet, summarizeTurn, } from "./storage.js";
export * from "./types.js";
export { ChangeSetStore, mergeSessionChangeSets, summarizeChangeSet, summarizeTurn } from "./storage.js";
export { diffText } from "./diff.js";
export { DEFAULT_IGNORE_PATTERNS, compileIgnorePatterns, } from "./ignore.js";
export { snapshotWorkspace, scanMetadata, readTextFile, sameMetadata, } from "./snapshot.js";
/** Default per-file cap for hashing and diffing (10 MiB). */
export const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
/** Default stability wait between turn end and the final snapshot. */
export const DEFAULT_SETTLE_DELAY_MS = 200;
/** Default settle re-scan attempts before giving up on stability. */
export const DEFAULT_SETTLE_MAX_ATTEMPTS = 5;
/** Default turns retained per session in the history store. */
export const DEFAULT_MAX_HISTORY = 100;
/** Validate one positive integer knob at the configuration boundary. */
function resolvePositive(value, fallback, name) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError(`change-monitor: ${name} must be a positive safe integer, got ${String(value)}`);
    }
    return value;
}
/** Validate one non-negative integer knob (delays and context lines allow 0). */
function resolveNonNegative(value, fallback, name) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`change-monitor: ${name} must be a non-negative safe integer, got ${String(value)}`);
    }
    return value;
}
/**
 * The per-turn change monitor service. Listens to the durable session event
 * stream — `turn/start` opens a before snapshot, `turn/end` settles, re-scans
 * for stability, snapshots after, diffs, and stores. All of it runs inside
 * contained best-effort wrappers.
 */
let ChangeMonitorService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _turns_decorators;
    let _current_decorators;
    let _debug_decorators;
    let _turn_decorators;
    let _file_decorators;
    let _session_decorators;
    return class ChangeMonitorService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _turns_decorators = [Remote('turns')];
            _current_decorators = [Remote('current')];
            _debug_decorators = [Remote('debug')];
            _turn_decorators = [Remote('turn')];
            _file_decorators = [Remote('file')];
            _session_decorators = [Remote('session')];
            __esDecorate(this, null, _turns_decorators, { kind: "method", name: "turns", static: false, private: false, access: { has: obj => "turns" in obj, get: obj => obj.turns }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _current_decorators, { kind: "method", name: "current", static: false, private: false, access: { has: obj => "current" in obj, get: obj => obj.current }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _debug_decorators, { kind: "method", name: "debug", static: false, private: false, access: { has: obj => "debug" in obj, get: obj => obj.debug }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _turn_decorators, { kind: "method", name: "turn", static: false, private: false, access: { has: obj => "turn" in obj, get: obj => obj.turn }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _file_decorators, { kind: "method", name: "file", static: false, private: false, access: { has: obj => "file" in obj, get: obj => obj.file }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _session_decorators, { kind: "method", name: "session", static: false, private: false, access: { has: obj => "session" in obj, get: obj => obj.session }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static Config = z.object({
            enabled: z.boolean().default(true),
            exclude: z.array(z.string()).default([]),
            include: z.array(z.string()).default([]),
            maxSnapshotFileSize: z.number().step(1).min(1).default(DEFAULT_MAX_FILE_SIZE),
            maxDiffFileSize: z.number().step(1).min(1).default(DEFAULT_MAX_FILE_SIZE),
            maxDiffCells: z.number().step(1).min(1).default(DEFAULT_MAX_DIFF_CELLS),
            contextLines: z.number().step(1).min(0).default(DEFAULT_CONTEXT_LINES),
            settleDelayMs: z.number().step(1).min(0).default(DEFAULT_SETTLE_DELAY_MS),
            settleMaxAttempts: z.number().step(1).min(1).default(DEFAULT_SETTLE_MAX_ATTEMPTS),
            historyEnabled: z.boolean().default(true),
            maxHistory: z.number().step(1).min(1).default(DEFAULT_MAX_HISTORY),
            storeRoot: z.string(),
        });
        config = __runInitializers(this, _instanceExtraInitializers);
        ignore;
        store;
        states = new Map();
        /**
         * Latest completed turn's summary per live session (the wire `current`
         * value without retained content). One small entry per session, dropped on
         * disposal; the full record lives only on disk.
         */
        latest = new Map();
        /** Diagnostic ring: recent turn events, for runtime verification. */
        eventLog = [];
        /**
         * @param ctx - host context carrying the session event feed.
         * @param config - plugin configuration (defaults apply).
         */
        constructor(ctx, config = {}) {
            super(ctx, 'changeMonitor');
            this.config = {
                enabled: config.enabled ?? true,
                exclude: config.exclude ?? [],
                include: config.include ?? [],
                maxSnapshotFileSize: resolvePositive(config.maxSnapshotFileSize, DEFAULT_MAX_FILE_SIZE, 'maxSnapshotFileSize'),
                maxDiffFileSize: resolvePositive(config.maxDiffFileSize, DEFAULT_MAX_FILE_SIZE, 'maxDiffFileSize'),
                maxDiffCells: resolvePositive(config.maxDiffCells, DEFAULT_MAX_DIFF_CELLS, 'maxDiffCells'),
                contextLines: resolveNonNegative(config.contextLines, DEFAULT_CONTEXT_LINES, 'contextLines'),
                settleDelayMs: resolveNonNegative(config.settleDelayMs, DEFAULT_SETTLE_DELAY_MS, 'settleDelayMs'),
                settleMaxAttempts: resolvePositive(config.settleMaxAttempts, DEFAULT_SETTLE_MAX_ATTEMPTS, 'settleMaxAttempts'),
                historyEnabled: config.historyEnabled ?? true,
                maxHistory: resolvePositive(config.maxHistory, DEFAULT_MAX_HISTORY, 'maxHistory'),
                storeRoot: config.storeRoot ?? dshHomePath('changes'),
            };
            this.ignore = compileIgnorePatterns(this.config.exclude, this.config.include);
            this.store = new ChangeSetStore({
                storeRoot: this.config.storeRoot,
                maxHistory: this.config.maxHistory,
            });
            ctx.on('session/event', (session, event) => {
                if (!this.config.enabled)
                    return;
                // High-frequency events (assistant/chunk, tool/*) would flood the ring;
                // only turn boundaries and diagnostic markers are worth keeping.
                if (event.type === 'turn/start' || event.type === 'turn/end' || event.type === 'session/end-seed') {
                    this.eventLog.push({ time: Date.now(), session: session.id, type: event.type, turn: event.data.turn ?? 0 });
                    if (this.eventLog.length > 40)
                        this.eventLog.shift();
                }
                if (event.type === 'turn/start')
                    this.onTurnStart(session, event.data.turn);
                else if (event.type === 'turn/end')
                    this.onTurnEnd(session, event.data.turn);
            });
            ctx.on('session/disposed', (session) => {
                this.states.delete(session.id);
                this.latest.delete(session.id);
            });
        }
        /** Best-effort wrapper: one failure logs a warning and never throws. */
        bestEffort(label, operation) {
            void operation().catch((error) => {
                this.ctx.logger.warn(`change monitor ${label} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            });
        }
        /** Snapshot the workspace at turn start; the diff needs this baseline. */
        onTurnStart(session, turn) {
            const cwd = session.header.cwd;
            if (cwd === undefined)
                return;
            const bookkeeping = {
                turn, before: undefined, beforeReady: Promise.resolve(), busy: Promise.resolve(), git: false,
            };
            this.states.set(session.id, bookkeeping);
            // The snapshot runs concurrently with the agent's first steps. In
            // practice it lands long before any tool write (a model round trip
            // separates turn/start from the first tool call); the settle path awaits
            // `beforeReady` so a slow snapshot is still used when it completes in time.
            // A git workspace snapshots only the changed-path candidate set (git
            // status) — seconds instead of a full-tree walk on huge trees; non-git
            // workspaces fall back to the full walk.
            bookkeeping.beforeReady = (async () => {
                const candidates = await gitChangedPaths(cwd);
                bookkeeping.git = candidates !== undefined;
                if (candidates !== undefined) {
                    const head = await gitHead(cwd);
                    if (head !== undefined)
                        bookkeeping.startHead = head;
                }
                bookkeeping.before = candidates === undefined
                    ? await snapshotWorkspace(cwd, {
                        maxSnapshotFileSize: this.config.maxSnapshotFileSize,
                        ignore: this.ignore,
                    })
                    : await snapshotCandidates(cwd, candidates, {
                        maxSnapshotFileSize: this.config.maxSnapshotFileSize,
                        ignore: this.ignore,
                    });
            })().then(() => undefined, (error) => {
                this.ctx.logger.warn(`change monitor turn ${turn} before snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
        /** Settle, snapshot after, diff, and store — serialized per session. */
        onTurnEnd(session, turn) {
            const cwd = session.header.cwd;
            if (cwd === undefined)
                return;
            const bookkeeping = this.states.get(session.id);
            if (bookkeeping === undefined || bookkeeping.turn !== turn)
                return;
            // Serialize behind the previous turn's settle so two endings cannot
            // interleave their snapshots and writes.
            bookkeeping.busy = bookkeeping.busy.then(async () => {
                try {
                    await this.settleAndDiff(session.id, cwd, bookkeeping);
                }
                finally {
                    // Release the turn's retained before-content the moment the diff no
                    // longer needs it; a big workspace must not stay resident between
                    // turns. The identity check keeps a newer turn's bookkeeping intact.
                    bookkeeping.before = undefined;
                    if (this.states.get(session.id) === bookkeeping)
                        this.states.delete(session.id);
                }
            });
            this.bestEffort(`turn ${turn} settle/diff`, () => bookkeeping.busy);
        }
        /** Wait for quiescence, snapshot, diff, persist, and cache. */
        async settleAndDiff(sessionId, root, bookkeeping) {
            if (!this.config.enabled) {
                this.eventLog.push({ time: Date.now(), session: sessionId, type: 'debug/disabled', turn: bookkeeping.turn });
                return;
            }
            await bookkeeping.beforeReady;
            const before = bookkeeping.before;
            if (before === undefined) {
                this.eventLog.push({ time: Date.now(), session: sessionId, type: 'debug/no-before', turn: bookkeeping.turn });
                this.ctx.logger.warn(`change monitor: turn ${bookkeeping.turn} has no before snapshot; skipping`);
                return;
            }
            // The after view needs hashes only: changed files' texts are read from
            // disk at diff time, so the retained-content path runs once per turn.
            let after;
            if (bookkeeping.git) {
                const candidates = await gitChangedPaths(root) ?? [];
                await this.waitForStability(root, candidates);
                let afterMerged = await snapshotCandidates(root, candidates, {
                    maxSnapshotFileSize: this.config.maxSnapshotFileSize,
                    ignore: this.ignore,
                    retainContent: false,
                }, before);
                let beforeMerged = before;
                // Include files changed by mid-turn commits: the turn-end candidate set
                // is clean, so the committed diff between the turn-start HEAD and the
                // current HEAD is the only record of those paths. Deleted paths enter
                // the before side from the start commit; added/modified paths enter the
                // after side from disk.
                if (bookkeeping.startHead !== undefined) {
                    const committed = await gitDiffNameStatus(root, bookkeeping.startHead, 'HEAD');
                    if (committed.length > 0) {
                        afterMerged = await this.mergeCommittedAfter(root, afterMerged, committed);
                        beforeMerged = await this.mergeCommittedBefore(root, beforeMerged, committed, bookkeeping.startHead);
                    }
                }
                // A candidate new to the turn-end set (clean at turn start, changed
                // during the turn but not committed) has no before snapshot; the
                // turn-start HEAD version is the exact turn-start state, so backfill it
                // into the BEFORE snapshot before diffing. The after snapshot keeps
                // every candidate.
                beforeMerged = await this.backfillHeadBefore(root, beforeMerged, afterMerged, bookkeeping.startHead);
                const record = await this.buildChangeSet(sessionId, bookkeeping.turn, beforeMerged, afterMerged);
                this.latest.set(sessionId, summarizeChangeSet(record));
                this.eventLog.push({ time: Date.now(), session: sessionId, type: 'debug/stored', turn: bookkeeping.turn });
                if (this.config.historyEnabled) {
                    await this.store.append(record);
                }
                return;
            }
            else {
                await this.waitForStability(root);
                after = await snapshotWorkspace(root, {
                    maxSnapshotFileSize: this.config.maxSnapshotFileSize,
                    ignore: this.ignore,
                    retainContent: false,
                });
            }
            const record = await this.buildChangeSet(sessionId, bookkeeping.turn, before, after);
            this.latest.set(sessionId, summarizeChangeSet(record));
            this.eventLog.push({ time: Date.now(), session: sessionId, type: 'debug/stored', turn: bookkeeping.turn });
            if (this.config.historyEnabled) {
                await this.store.append(record);
            }
        }
        /**
         * Re-scan until the tree's metadata stops changing, bounded by attempts.
         * The git-candidate variant checks only the changed-path set (seconds on
         * huge trees); the full-tree variant walks everything.
         * @param root - workspace root.
         * @param candidates - git candidate paths (undefined = full-tree scan).
         */
        async waitForStability(root, candidates) {
            await delay(this.config.settleDelayMs);
            for (let attempt = 0; attempt < this.config.settleMaxAttempts; attempt += 1) {
                const first = candidates !== undefined
                    ? await candidateTokens(root, candidates)
                    : await scanMetadata(root, this.ignore);
                await delay(this.config.settleDelayMs);
                const second = candidates !== undefined
                    ? await candidateTokens(root, candidates)
                    : await scanMetadata(root, this.ignore);
                if (candidates !== undefined ? sameTokens(first, second) : sameMetadata(first, second))
                    return;
            }
        }
        /**
         * Backfill before-snapshots for after-side paths absent from the before
         * snapshot: a file clean at turn start that the turn modified but did not
         * commit. Its turn-start content is exactly the turn-start git revision, so
         * `git show` supplies it; untracked new files (absent from that revision
         * too) stay before-less and the diff reports them as added.
         * @param root - workspace root.
         * @param before - the turn-start snapshot (read-only).
         * @param after - the turn-end candidate snapshot.
         * @param startHead - the git revision at turn start; falls back to HEAD.
         * @returns the before snapshot with the backfilled entries.
         */
        async backfillHeadBefore(root, before, after, startHead) {
            const missing = [...after.files.keys()].filter(path => !before.files.has(path));
            if (missing.length === 0)
                return before;
            const rev = startHead ?? 'HEAD';
            const merged = new Map(before.files);
            for (const path of missing) {
                const text = await readGitFile(root, rev, path);
                if (text === null)
                    continue;
                merged.set(path, {
                    size: Buffer.byteLength(text, 'utf8'),
                    mtimeNs: 0,
                    hash: createHash('sha256').update(text).digest('hex'),
                    kind: 'text',
                    content: text,
                });
            }
            return { ...before, files: merged };
        }
        /**
         * Add committed added/modified/renamed paths to the after snapshot from
         * disk, so a clean-at-turn-start file that was committed mid-turn still
         * appears in the diff. Deleted paths stay absent and are represented on the
         * before side only.
         * @param root - workspace root.
         * @param after - the turn-end candidate snapshot.
         * @param committed - paths changed between turn-start HEAD and current HEAD.
         * @returns the after snapshot with committed paths added.
         */
        async mergeCommittedAfter(root, after, committed) {
            const files = new Map(after.files);
            let changed = false;
            for (const entry of committed) {
                if (entry.kind === 'deleted')
                    continue;
                if (files.has(entry.path))
                    continue;
                const snap = await snapshotCandidates(root, [entry.path], {
                    maxSnapshotFileSize: this.config.maxSnapshotFileSize,
                    ignore: this.ignore,
                    retainContent: false,
                });
                const meta = snap.files.get(entry.path);
                if (meta !== undefined) {
                    files.set(entry.path, meta);
                    changed = true;
                }
            }
            return changed ? { root, time: after.time, files } : after;
        }
        /**
         * Add committed deleted/modified/renamed-old paths to the before snapshot
         * from the turn-start git revision, so the diff can report them as deleted
         * or modified. Added paths stay absent because they did not exist at turn
         * start.
         * @param root - workspace root.
         * @param before - the turn-start snapshot (read-only).
         * @param committed - paths changed between turn-start HEAD and current HEAD.
         * @param startHead - the git revision at turn start.
         * @returns the before snapshot with committed paths added.
         */
        async mergeCommittedBefore(root, before, committed, startHead) {
            const files = new Map(before.files);
            let changed = false;
            for (const entry of committed) {
                if (entry.kind === 'added')
                    continue;
                const path = entry.kind === 'renamed' ? entry.oldPath : entry.path;
                if (path === undefined || files.has(path) || this.ignore.isIgnored(path, false))
                    continue;
                const text = await readGitFile(root, startHead, path);
                if (text === null)
                    continue;
                files.set(path, {
                    size: Buffer.byteLength(text, 'utf8'),
                    mtimeNs: 0,
                    hash: createHash('sha256').update(text).digest('hex'),
                    kind: 'text',
                    content: text,
                });
                changed = true;
            }
            return changed ? { ...before, files } : before;
        }
        /** Compute the stored change set from the before/after snapshots. */
        async buildChangeSet(sessionId, turn, before, after) {
            const allPaths = new Set([...before.files.keys(), ...after.files.keys()]);
            const files = [];
            let additions = 0;
            let deletions = 0;
            for (const path of [...allPaths].sort()) {
                const beforeMeta = before.files.get(path);
                const afterMeta = after.files.get(path);
                const file = await this.buildFileChange(path, beforeMeta, afterMeta, after.root);
                if (file === undefined)
                    continue; // Content-identical: not a change.
                additions += file.additions;
                deletions += file.deletions;
                files.push(file);
            }
            return {
                sessionId,
                turn,
                startedAt: before.time,
                finishedAt: after.time,
                root: after.root,
                files,
                additions,
                deletions,
            };
        }
        /**
         * Diff one path's before/after states, or undefined when unchanged. The
         * before text comes from the retained turn-start snapshot; the after text
         * is read from disk at diff time (the after view holds hashes only).
         */
        async buildFileChange(path, beforeMeta, afterMeta, root) {
            const afterText = afterMeta !== undefined && (beforeMeta === undefined
                || beforeMeta.hash === null || beforeMeta.hash !== afterMeta.hash)
                ? await readTextFile(join(root, path), this.config.maxDiffFileSize)
                : undefined;
            if (beforeMeta !== undefined && afterMeta !== undefined) {
                // Fast path: identical content hash means no change, whatever the mtime.
                if (beforeMeta.hash !== null && afterMeta.hash !== null && beforeMeta.hash === afterMeta.hash) {
                    return undefined;
                }
                // Large files carry no hash: compare size as the cheap signal.
                if (beforeMeta.hash === null && afterMeta.hash === null && beforeMeta.size === afterMeta.size) {
                    return undefined;
                }
                // The before text comes from the SNAPSHOT, never from the current disk:
                // a file modified after its snapshot must still diff against what the
                // snapshot saw. The after text is the disk read above (the settle check
                // confirmed the tree stable just before the after snapshot).
                const beforeText = beforeMeta.content;
                if (beforeText !== undefined && afterText !== null && afterText !== undefined) {
                    if (beforeText === afterText)
                        return undefined; // Formatter rewrote identically.
                    const diff = diffText(beforeText, afterText, {
                        contextLines: this.config.contextLines,
                        maxCells: this.config.maxDiffCells,
                    });
                    return {
                        path, status: 'modified', kind: 'text',
                        additions: diff.additions, deletions: diff.deletions,
                        beforeSize: beforeMeta.size, afterSize: afterMeta.size,
                        hunks: diff.hunks,
                        beforeContent: beforeText, afterContent: afterText,
                    };
                }
                // Binary or oversized on either side: size-only report.
                return {
                    path, status: 'modified', kind: afterMeta.kind === 'text' && beforeMeta.kind === 'text' ? 'large' : 'binary',
                    additions: 0, deletions: 0,
                    beforeSize: beforeMeta.size, afterSize: afterMeta.size,
                    hunks: [],
                    summary: 'Binary file changed',
                };
            }
            if (afterMeta !== undefined) {
                if (afterText !== null && afterText !== undefined) {
                    const diff = diffText('', afterText, {
                        contextLines: this.config.contextLines,
                        maxCells: this.config.maxDiffCells,
                    });
                    return {
                        path, status: 'added', kind: 'text',
                        additions: diff.additions, deletions: 0,
                        beforeSize: 0, afterSize: afterMeta.size,
                        hunks: diff.hunks,
                        afterContent: afterText,
                    };
                }
                return {
                    path, status: 'added', kind: afterMeta.kind,
                    additions: 0, deletions: 0,
                    beforeSize: 0, afterSize: afterMeta.size,
                    hunks: [], summary: 'Binary file changed',
                };
            }
            const beforeText = beforeMeta?.content;
            if (beforeMeta !== undefined && beforeText !== undefined) {
                const diff = diffText(beforeText, '', {
                    contextLines: this.config.contextLines,
                    maxCells: this.config.maxDiffCells,
                });
                return {
                    path, status: 'deleted', kind: 'text',
                    additions: 0, deletions: diff.deletions,
                    beforeSize: beforeMeta.size, afterSize: 0,
                    hunks: diff.hunks,
                    beforeContent: beforeText,
                };
            }
            return {
                path, status: 'deleted', kind: beforeMeta?.kind ?? 'binary',
                additions: 0, deletions: 0,
                beforeSize: beforeMeta?.size ?? 0, afterSize: 0,
                hunks: [], summary: 'Binary file changed',
            };
        }
        /**
         * `changeMonitor.turns`: completed turns, newest first.
         * @param request - session whose history to read.
         * @returns turn summaries or a structured failure.
         */
        async turns(request) {
            return await this.guard(async () => {
                const records = await this.store.loadTurns(request.sessionId);
                return { ok: true, value: records.map(summarizeTurn).reverse() };
            });
        }
        /**
         * `changeMonitor.current`: the latest completed turn's summary.
         * @param request - session whose latest turn to read.
         * @returns the summary, or null when the session has no completed turn.
         */
        async current(request) {
            return await this.guard(async () => {
                const cached = this.latest.get(request.sessionId);
                if (cached !== undefined)
                    return { ok: true, value: cached };
                const record = await this.store.latest(request.sessionId);
                return { ok: true, value: record === undefined ? null : summarizeChangeSet(record) };
            });
        }
        /**
         * `changeMonitor.debug`: recent session/event arrivals (diagnostic surface).
         * @returns the last received turn events with timestamps.
         */
        async debug() {
            return { ok: true, value: [...this.eventLog] };
        }
        /**
         * `changeMonitor.turn`: one exact completed turn's summary.
         * @param request - session and turn number.
         * @returns the summary, or null when that turn has no record.
         */
        async turn(request) {
            return await this.guard(async () => {
                const record = await this.findTurn(request.sessionId, request.turn);
                return { ok: true, value: record === undefined ? null : summarizeChangeSet(record) };
            });
        }
        /**
         * `changeMonitor.file`: one file's full diff inside one turn. The path must
         * be a safe workspace-relative path; anything else is `invalid-path`.
         * @param request - session, turn, and workspace-relative path.
         * @returns the file's complete change record with hunks.
         */
        async file(request) {
            return await this.guard(async () => {
                const record = await this.findTurn(request.sessionId, request.turn);
                if (record === undefined) {
                    return { ok: false, error: { code: 'not-found', message: `turn ${request.turn} has no record` } };
                }
                const stored = storedFileOf(record, request.path);
                if (stored === undefined) {
                    return { ok: false, error: { code: 'not-found', message: `file ${JSON.stringify(request.path)} is not in turn ${request.turn}` } };
                }
                return { ok: true, value: withoutContent(stored) };
            });
        }
        /**
         * `changeMonitor.session`: cumulative changes across every retained turn.
         * @param request - session whose cumulative changes to read.
         * @returns the merged summary, or null when nothing changed net.
         */
        async session(request) {
            return await this.guard(async () => {
                const records = await this.store.loadTurns(request.sessionId);
                const merged = mergeSessionChangeSets(records);
                return { ok: true, value: merged };
            });
        }
        /** Find one stored turn record. */
        async findTurn(sessionId, turn) {
            const records = await this.store.loadTurns(sessionId);
            return records.find(record => record.turn === turn);
        }
        /** Contain a Remote operation: failures become structured `internal` errors. */
        async guard(operation) {
            try {
                return await operation();
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { ok: false, error: { code: 'internal', message } };
            }
        }
    };
})();
export { ChangeMonitorService };
/** Strip retained content from a stored file change for the wire. */
function withoutContent(file) {
    return {
        path: file.path,
        status: file.status,
        kind: file.kind,
        additions: file.additions,
        deletions: file.deletions,
        beforeSize: file.beforeSize,
        afterSize: file.afterSize,
        hunks: file.hunks,
        ...(file.summary === undefined ? {} : { summary: file.summary }),
    };
}
/** One-shot delay; the monitor's best-effort wrapper tolerates teardown races. */
function delay(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}
/**
 * Stability tokens for the git candidate set only — stat each candidate
 * (bounded concurrency), so the settle check costs seconds even when the
 * workspace holds tens of thousands of files.
 * @param root - workspace root.
 * @param candidates - candidate paths.
 * @returns path -> token map; unreadable paths are absent.
 */
async function candidateTokens(root, candidates) {
    const tokens = new Map();
    const CONCURRENCY = 32;
    for (let offset = 0; offset < candidates.length; offset += CONCURRENCY) {
        const batch = candidates.slice(offset, offset + CONCURRENCY);
        const infos = await Promise.all(batch.map(path => stat(join(root, path)).catch(() => undefined)));
        for (let index = 0; index < batch.length; index += 1) {
            const path = batch[index];
            const info = infos[index];
            if (path !== undefined && info?.isFile()) {
                tokens.set(path, { size: info.size, mtimeNs: mtimeNs(info) });
            }
        }
    }
    return tokens;
}
/** Whether two candidate token maps agree. */
function sameTokens(left, right) {
    if (left.size !== right.size)
        return false;
    for (const [path, token] of left) {
        const other = right.get(path);
        if (other === undefined || other.size !== token.size || other.mtimeNs !== token.mtimeNs)
            return false;
    }
    return true;
}
/** Nanosecond mtime, with the millisecond fallback for odd filesystems. */
function mtimeNs(info) {
    if (info.mtimeNs !== undefined)
        return info.mtimeNs;
    return Math.floor(info.mtimeMs * 1e6);
}
export default ChangeMonitorService;
//# sourceMappingURL=index.js.map