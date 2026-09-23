import { describe, expect, it } from 'vitest'
import { CUA_TOOL_NAMES, captureProbeCommand } from '../src/index.ts'

describe('CUA_TOOL_NAMES', () => {
  it('covers screenshot and all input simulation tools', () => {
    expect(CUA_TOOL_NAMES).toContain('screenshot')
    expect(CUA_TOOL_NAMES).toContain('mouse_click')
    expect(CUA_TOOL_NAMES).toContain('mouse_trajectory')
    expect(CUA_TOOL_NAMES).toContain('mouse_scroll')
    expect(CUA_TOOL_NAMES).toContain('keyboard_input')
  })
})

describe('captureProbeCommand', () => {
  it('uses PowerShell on Windows', () => {
    expect(captureProbeCommand('win32')).toContain('powershell')
    expect(captureProbeCommand('win32')).toContain('SystemInformation')
  })

  it('uses screencapture on macOS', () => {
    expect(captureProbeCommand('darwin')).toContain('screencapture')
  })

  it('uses import on Linux', () => {
    expect(captureProbeCommand('linux')).toContain('import')
  })
})
