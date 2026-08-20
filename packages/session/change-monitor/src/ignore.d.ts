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
export declare const DEFAULT_IGNORE_PATTERNS: readonly string[]
/** One compiled ignore entry with its optional include override. */
interface CompiledEntry {
  readonly include: boolean
  readonly dirOnly: boolean
  readonly anchored: boolean
  readonly regex: RegExp
}
/** Compile the effective exclude+include pattern list once per monitor config. */
export declare function compileIgnorePatterns(exclude: readonly string[], include?: readonly string[]): CompiledIgnore
/** Immutable compiled ignore set; the walker queries it per path. */
export declare class CompiledIgnore {
  private readonly entries
  constructor(entries: readonly CompiledEntry[])
  /**
     * Whether one workspace-relative path is ignored. Include entries win over
     * excludes (later include of an earlier excluded path re-admits it).
     * A directory pattern also excludes everything below that directory.
     * @param relPath - forward-slash relative path (may be a bare segment).
     * @param isDirectory - whether the path names a directory.
     * @returns true when the path must be skipped.
     */
  isIgnored(relPath: string, isDirectory: boolean): boolean
  /** Whether this ignore set excludes anything at all (fast path for empty trees). */
  get hasEntries(): boolean
}
export {}
//# sourceMappingURL=ignore.d.ts.map
