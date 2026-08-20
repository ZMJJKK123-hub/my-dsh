/**
 * Ignore-pattern matching for workspace snapshots. Patterns follow a small
 * gitignore-lite dialect: `*` matches within one path segment, `**` crosses
 * segments, `?` matches one character, a trailing `/` restricts to
 * directories, and a pattern without `/` matches any basename at any depth.
 *
 * @module @dsh-custom/dsh-change-monitor
 */
/**
 * Default exclusions: VCS/metadata directories, dependency and build output
 * directories, and transient file shapes. Deliberately NOT excluded are lock
 * files (`pnpm-lock.yaml`, `package-lock.json`, `requirements.txt`) — those
 * are real project changes.
 */
export const DEFAULT_IGNORE_PATTERNS = [
    // Directories.
    '.git/', 'node_modules/', '.venv/', 'venv/', '__pycache__/', 'dist/', 'build/',
    'lib/', 'bin/', '.next/', '.cache/', 'coverage/', '.turbo/', '.nx/', '.idea/',
    '.vscode/', '.DS_Store/', 'out/', 'target/', '.pytest_cache/', '.mypy_cache/',
    // File shapes.
    '*.pyc', '*.pyo', '*.log', '*.tmp', '*.temp', '*.swp', '*.swo', '*.part',
    '*.map', '*.tsbuildinfo', '.DS_Store', 'Thumbs.db', 'desktop.ini',
];
/** Escape every regex metacharacter except the glob wildcards we translate. */
function escapeGlob(source) {
    let out = '';
    for (const char of source) {
        if (char === '*')
            out += '*';
        else if (char === '?')
            out += '?';
        else
            out += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
    }
    return out;
}
/** Translate one glob pattern (no leading `!`) into a compiled matcher. */
function compilePattern(raw) {
    let pattern = raw;
    const dirOnly = pattern.endsWith('/');
    if (dirOnly)
        pattern = pattern.slice(0, -1);
    // A pattern with no slash matches a basename at any depth.
    const anchored = pattern.includes('/');
    // Normalize a leading `**/` so the match may start at any depth.
    const segments = pattern.split('/');
    let body = segments.map(escapeGlob).join('/');
    if (segments[0] === '**') {
        body = segments.length === 1 ? '.*' : `(?:.*/)?${segments.slice(1).map(escapeGlob).join('/')}`;
    }
    // A trailing `/**` also matches everything below the prefix.
    if (segments.at(-1) === '**' && segments.length > 1) {
        body = `${segments.slice(0, -1).map(escapeGlob).join('/')}(?:/.*)?`;
    }
    // Translate the remaining `**` occurrences inside segments.
    const translated = body.replace(/\*\*/g, () => '.*').replace(/\*/g, () => '[^/]*');
    return { pattern: `^${translated}$`, dirOnly, anchored };
}
/** Compile the effective exclude+include pattern list once per monitor config. */
export function compileIgnorePatterns(exclude, include = []) {
    const entries = [];
    for (const raw of [...DEFAULT_IGNORE_PATTERNS, ...exclude]) {
        const compiled = compilePattern(raw);
        entries.push({ include: false, ...compiled, regex: new RegExp(compiled.pattern) });
    }
    for (const raw of include) {
        const compiled = compilePattern(raw);
        entries.push({ include: true, ...compiled, regex: new RegExp(compiled.pattern) });
    }
    return new CompiledIgnore(entries);
}
/** Immutable compiled ignore set; the walker queries it per path. */
export class CompiledIgnore {
    entries;
    constructor(entries) {
        this.entries = entries;
    }
    /**
     * Whether one workspace-relative path is ignored. Include entries win over
     * excludes (later include of an earlier excluded path re-admits it).
     * A directory pattern also excludes everything below that directory.
     * @param relPath - forward-slash relative path (may be a bare segment).
     * @param isDirectory - whether the path names a directory.
     * @returns true when the path must be skipped.
     */
    isIgnored(relPath, isDirectory) {
        const segments = relPath.split('/');
        let verdict;
        for (const entry of this.entries) {
            let matched;
            if (entry.anchored) {
                matched = entry.regex.test(relPath);
                if (!matched && entry.dirOnly) {
                    // A directory prefix match excludes the whole subtree below it.
                    for (let depth = 1; depth < segments.length; depth += 1) {
                        if (entry.regex.test(segments.slice(0, depth).join('/'))) {
                            matched = true;
                            break;
                        }
                    }
                }
            }
            else if (entry.dirOnly) {
                // Basename directory pattern: any segment matches; a file's final
                // segment only counts when the path itself is a directory.
                matched = segments.some((segment, index) => entry.regex.test(segment) && (index < segments.length - 1 || isDirectory));
            }
            else {
                matched = segments.some(segment => entry.regex.test(segment));
            }
            if (!matched)
                continue;
            verdict = !entry.include;
        }
        return verdict ?? false;
    }
    /** Whether this ignore set excludes anything at all (fast path for empty trees). */
    get hasEntries() {
        return this.entries.length > 0;
    }
}
//# sourceMappingURL=ignore.js.map