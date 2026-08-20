import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

describe('tool-browser plugin contract', () => {
  it('exports the cordis plugin shape', () => {
    expect(plugin.name).toBe('tool-browser')
    expect(plugin.inject).toContain('tools')
    expect(typeof plugin.apply).toBe('function')
  })
})
