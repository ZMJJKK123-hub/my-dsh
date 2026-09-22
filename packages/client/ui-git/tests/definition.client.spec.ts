/** The tab type's registry definition. */
import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { GIT_ID, GIT_KIND, gitDefinition } from '../src/client/definition.ts'

const t = makeTranslate(zh as unknown as Record<string, string>)

describe('gitDefinition', () => {
  it('declares the git kind under this package identity', () => {
    const definition = gitDefinition(t)
    expect(definition.id).toBe(GIT_ID)
    expect(definition.kind).toBe(GIT_KIND)
    expect(definition.priority).toBe('builtin')
  })

  it('guides with one entry after the files tab', () => {
    const definition = gitDefinition(t)
    const guide = definition.guide ?? []
    expect(guide).toHaveLength(1)
    expect(guide[0]?.order).toBe(20)
    expect(guide[0]?.title()).toBe(zh['guide.title'])
  })
})
