/**
 * ChangeSet persistence: one JSONL file per session under the store root
 * (default `$DSH_HOME/changes/<sessionId>.jsonl`), each line one completed
 * turn's stored change set. History is trimmed to a configured maximum; the
 * session-level cumulative view replays the retained records.
 *
 * @module @dsh-custom/dsh-change-monitor
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffText, DEFAULT_CONTEXT_LINES, DEFAULT_MAX_DIFF_CELLS } from "./diff.js";
/** Rename attempts before falling back to a direct write. */
const RENAME_ATTEMPTS = 3;
/** Delay between rename attempts, in milliseconds. */
const RENAME_RETRY_DELAY_MS = 25;
/**
 * JSONL change-set store. Appends are read-modify-write under a per-session
 * promise chain, so concurrent turn endings never interleave lines.
 */
export class ChangeSetStore {
    root;
    maxHistory;
    tails = new Map();
    constructor(options) {
        this.root = options.storeRoot;
        this.maxHistory = options.maxHistory;
    }
    /** The exact artifact path for one session. */
    pathOf(sessionId) {
        return join(this.root, `${sessionId}.jsonl`);
    }
    /**
     * Append one completed turn's record, trimming the file to `maxHistory`
     * turns. Never rejects the caller's turn: failures are reported by the
     * caller's best-effort wrapper.
     * @param record - the stored change set to persist.
     */
    async append(record) {
        const path = this.pathOf(record.sessionId);
        const previous = this.tails.get(record.sessionId) ?? Promise.resolve();
        const operation = previous.then(async () => {
            await mkdir(this.root, { recursive: true });
            const existing = await this.loadRaw(record.sessionId);
            existing.push(record);
            const kept = existing.slice(-this.maxHistory);
            const content = kept.map(item => JSON.stringify(item)).join('\n') + '\n';
            const temporary = `${path}.tmp`;
            await writeFile(temporary, content, 'utf8');
            await commitFile(temporary, path);
        });
        const tail = operation.then(() => undefined, () => undefined);
        this.tails.set(record.sessionId, tail);
        await operation.finally(() => {
            if (this.tails.get(record.sessionId) === tail)
                this.tails.delete(record.sessionId);
        });
    }
    /**
     * Load every retained record for one session, oldest first.
     * @param sessionId - session whose history to read.
     * @returns stored change sets in chronological order (empty when absent or unreadable).
     */
    async loadTurns(sessionId) {
        try {
            return await this.loadRaw(sessionId);
        }
        catch {
            return [];
        }
    }
    /** Read and parse the raw artifact; a corrupt tail line is dropped. */
    async loadRaw(sessionId) {
        const path = this.pathOf(sessionId);
        // A leftover `.tmp` may hold the newest record when a rename failed or a
        // process died between the write and the rename; it wins over the main
        // file because it is always a superset of the last committed state.
        const [main, temporary] = await Promise.all([
            readFile(path, 'utf8').catch(() => undefined),
            readFile(`${path}.tmp`, 'utf8').catch(() => undefined),
        ]);
        const candidates = [...parseRecords(main), ...parseRecords(temporary)];
        // Newest-first dedupe by turn: a record present in both files keeps the
        // tmp copy (which contains every turn the main file has, plus the tail).
        const seen = new Set();
        const records = [];
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
            const record = candidates[index];
            if (record === undefined || seen.has(record.turn))
                continue;
            seen.add(record.turn);
            records.push(record);
        }
        return records.reverse();
    }
    /**
     * The most recent retained record for one session.
     * @param sessionId - session whose latest turn to read.
     * @returns the latest record, or undefined when the session has none.
     */
    async latest(sessionId) {
        const turns = await this.loadTurns(sessionId);
        return turns.at(-1);
    }
    /** Sessions that have at least one retained record. */
    async listSessions() {
        try {
            const names = await readdir(this.root);
            return names
                .filter(name => name.endsWith('.jsonl'))
                .map(name => name.slice(0, -'.jsonl'.length));
        }
        catch {
            return [];
        }
    }
    /**
     * Remove one session's retained history. Absence is success.
     * @param sessionId - session whose artifact to delete.
     */
    async remove(sessionId) {
        await unlink(this.pathOf(sessionId)).catch(() => undefined);
    }
}
/** One JSONL artifact's complete records; a corrupt tail line is dropped. */
function parseRecords(content) {
    if (content === undefined || content === '')
        return [];
    const records = [];
    for (const line of content.split('\n')) {
        if (line === '')
            continue;
        try {
            records.push(JSON.parse(line));
        }
        catch {
            // A torn tail line is discarded; committed lines above it stay valid.
        }
    }
    return records;
}
/**
 * Atomically replace `target` with `temporary`, retrying transient failures
 * (an antivirus scan or a concurrent reader can briefly lock the target on
 * Windows). When every rename attempt fails, the content is written in place
 * so a turn record is never lost to a lock; the temporary file is removed.
 * @param temporary - fully written new content.
 * @param target - existing artifact to replace.
 */
async function commitFile(temporary, target) {
    for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
        try {
            await rename(temporary, target);
            return;
        }
        catch (error) {
            if (attempt === RENAME_ATTEMPTS - 1) {
                await writeFile(target, await readFile(temporary, 'utf8'), 'utf8');
                await unlink(temporary).catch(() => undefined);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
        }
    }
}
/** Wire summary of one stored change set (no hunks, no retained content). */
export function summarizeChangeSet(record) {
    const files = record.files.map(file => ({
        path: file.path,
        status: file.status,
        kind: file.kind,
        additions: file.additions,
        deletions: file.deletions,
        beforeSize: file.beforeSize,
        afterSize: file.afterSize,
        ...(file.summary === undefined ? {} : { summary: file.summary }),
    }));
    return {
        sessionId: record.sessionId,
        turn: record.turn,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        root: record.root,
        files,
        additions: record.additions,
        deletions: record.deletions,
    };
}
/** One history row for the panel. */
export function summarizeTurn(record) {
    return {
        turn: record.turn,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        filesCount: record.files.length,
        additions: record.additions,
        deletions: record.deletions,
    };
}
/**
 * Cumulative changes across every retained turn of one session: for each
 * file, the earliest retained before-state against the latest retained
 * after-state. A file that ended identical to its session baseline is
 * dropped, matching the per-turn unchanged rule.
 * @param turns - retained records, oldest first.
 * @returns the merged summary, or null when nothing changed cumulatively.
 */
export function mergeSessionChangeSets(turns) {
    if (turns.length === 0)
        return null;
    // path -> { baseline: string | null (null = absent at session start), final: string | null }
    const states = new Map();
    for (const turn of turns) {
        for (const file of turn.files) {
            let state = states.get(file.path);
            if (state === undefined) {
                // The first time we see a file, its session baseline is its before
                // state; an added file starts from absence.
                state = {
                    baseline: file.status === 'added' ? null : (file.beforeContent ?? null),
                    final: null,
                };
                states.set(file.path, state);
            }
            state.final = file.status === 'deleted' ? null : (file.afterContent ?? null);
        }
    }
    const files = [];
    let additions = 0;
    let deletions = 0;
    for (const [path, state] of states) {
        const before = state.baseline ?? '';
        const after = state.final ?? '';
        if (before === after)
            continue; // Net-zero across the session.
        const status = state.final === null ? 'deleted' : state.baseline === null ? 'added' : 'modified';
        const diff = diffText(before, after, {
            contextLines: DEFAULT_CONTEXT_LINES,
            maxCells: DEFAULT_MAX_DIFF_CELLS,
        });
        additions += diff.additions;
        deletions += diff.deletions;
        files.push({
            path,
            status,
            kind: 'text',
            additions: diff.additions,
            deletions: diff.deletions,
            beforeSize: Buffer.byteLength(before, 'utf8'),
            afterSize: Buffer.byteLength(after, 'utf8'),
        });
    }
    if (files.length === 0)
        return null;
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the length check guarantees both entries
    const first = turns[0];
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the length check guarantees both entries
    const last = turns[turns.length - 1];
    return {
        sessionId: last.sessionId,
        turn: last.turn,
        startedAt: first.startedAt,
        finishedAt: last.finishedAt,
        root: last.root,
        files,
        additions,
        deletions,
    };
}
/** The stored file change whose content belongs to one record (read helper). */
export function storedFileOf(record, path) {
    return record.files.find(file => file.path === path);
}
//# sourceMappingURL=storage.js.map