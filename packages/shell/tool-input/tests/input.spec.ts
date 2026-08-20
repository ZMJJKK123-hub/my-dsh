import { describe, expect, it } from 'vitest'
import {
  buildKeyboardCommand,
  buildMouseClickCommand,
  buildMouseScrollCommand,
  buildMouseTrajectoryCommand,
} from '../src/input.ts'

describe('mouse input command builders', () => {
  it('builds a trajectory move command with points and duration', () => {
    const command = buildMouseTrajectoryCommand({ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], durationMs: 200 })
    expect(command).toContain('Add-Type -TypeDefinition')
    expect(command).toContain('Trajectory(@(10,30), @(20,40), 200, \'move\', \'left\')')
  })

  it('builds a click command', () => {
    const command = buildMouseClickCommand({ x: 100, y: 200, button: 'right', clicks: 1 })
    expect(command).toContain('Trajectory(@(100), @(200), 100, \'click\', \'right\')')
  })

  it('builds a double-click command', () => {
    const command = buildMouseClickCommand({ x: 100, y: 200, clicks: 2 })
    expect(command).toContain('double-click')
  })

  it('builds a scroll command', () => {
    const command = buildMouseScrollCommand({ delta: -120, x: 50, y: 60 })
    expect(command).toContain('Scroll(-120, 50, 60)')
  })

  it('rejects empty trajectory points', () => {
    expect(() => buildMouseTrajectoryCommand({ points: [] })).toThrow(/at least one point/)
  })

  it('rejects non-finite scroll delta', () => {
    expect(() => buildMouseScrollCommand({ delta: Number.NaN })).toThrow(/finite number/)
  })
})

describe('keyboard input command builders', () => {
  it('builds a text input command with base64 encoding', () => {
    const command = buildKeyboardCommand({ text: 'hello', delayMs: 50 })
    expect(command).toContain('Add-Type -TypeDefinition')
    expect(command).toContain('aGVsbG8=')
    expect(command).toContain('Keyboard(')
  })

  it('builds a keys combo command', () => {
    const command = buildKeyboardCommand({ keys: ['ctrl', 'c'] })
    expect(command).toContain("@('ctrl','c')")
  })

  it('rejects empty keyboard input', () => {
    expect(() => buildKeyboardCommand({})).toThrow(/requires text or keys/)
  })

  it('supports both text and keys', () => {
    const command = buildKeyboardCommand({ text: 'a', keys: ['alt', 'tab'] })
    expect(command).toContain('YQ==')
    expect(command).toContain("@('alt','tab')")
  })
})
