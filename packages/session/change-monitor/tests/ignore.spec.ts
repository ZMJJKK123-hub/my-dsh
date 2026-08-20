import { describe, expect, it } from 'vitest'
import { compileIgnorePatterns, DEFAULT_IGNORE_PATTERNS } from '../src/ignore.ts'

describe('ignore patterns', () => {
  it('carries the default directory exclusions', () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.git/')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules/')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('__pycache__/')
    // Build outputs (tsc/tsdown emit `lib/`, sourcemaps, and tsbuildinfo).
    expect(DEFAULT_IGNORE_PATTERNS).toContain('lib/')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('*.map')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('*.tsbuildinfo')
    // Lock files stay visible — they are real project changes.
    expect(DEFAULT_IGNORE_PATTERNS.some(pattern => pattern.includes('lock'))).toBe(false)
  })

  it('excludes a directory at any depth', () => {
    const ignore = compileIgnorePatterns([])
    expect(ignore.isIgnored('node_modules', true)).toBe(true)
    expect(ignore.isIgnored('a/b/node_modules', true)).toBe(true)
    expect(ignore.isIgnored('a/b/node_modules/pkg/index.js', false)).toBe(true)
    expect(ignore.isIgnored('node_modules/', true)).toBe(true)
  })

  it('matches file globs against basenames at any depth', () => {
    const ignore = compileIgnorePatterns([])
    expect(ignore.isIgnored('debug.log', false)).toBe(true)
    expect(ignore.isIgnored('deep/debug.log', false)).toBe(true)
    expect(ignore.isIgnored('debug.log.old', false)).toBe(false)
  })

  it('does not exclude ordinary source files', () => {
    const ignore = compileIgnorePatterns([])
    expect(ignore.isIgnored('src/index.ts', false)).toBe(false)
    expect(ignore.isIgnored('pnpm-lock.yaml', false)).toBe(false)
    expect(ignore.isIgnored('package-lock.json', false)).toBe(false)
    expect(ignore.isIgnored('requirements.txt', false)).toBe(false)
  })

  it('appends configured exclusions', () => {
    const ignore = compileIgnorePatterns(['*.tmp', 'generated/'])
    expect(ignore.isIgnored('x.tmp', false)).toBe(true)
    expect(ignore.isIgnored('generated', true)).toBe(true)
  })

  it('lets include patterns re-admit excluded paths', () => {
    const ignore = compileIgnorePatterns([])
    expect(ignore.isIgnored('debug.log', false)).toBe(true)
    // The same name re-admitted through an include entry wins over the default.
    const withInclude = compileIgnorePatterns(['keep.log'], ['keep.log'])
    expect(withInclude.isIgnored('keep.log', false)).toBe(false)
  })

  it('applies trailing-slash directory-only patterns only to directories', () => {
    const ignore = compileIgnorePatterns([])
    expect(ignore.isIgnored('dist', true)).toBe(true)
    // A file NAMED dist is not excluded by the directory pattern.
    expect(ignore.isIgnored('dist', false)).toBe(false)
  })
})
