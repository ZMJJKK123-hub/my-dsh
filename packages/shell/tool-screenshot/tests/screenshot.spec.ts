import { describe, expect, it } from 'vitest'
import { defaultScreenshotPath, screenshotCommand } from '../src/screenshot.ts'

describe('screenshotCommand', () => {
  it('builds a PowerShell full-screen capture on Windows', () => {
    const command = screenshotCommand('win32', 'C:\\tmp\\a.png')
    expect(command).toContain('Add-Type -AssemblyName System.Windows.Forms,System.Drawing')
    expect(command).toContain("'C:\\tmp\\a.png'")
    expect(command).toContain('$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)')
  })

  it('builds a PowerShell region capture on Windows', () => {
    const command = screenshotCommand('win32', 'C:\\tmp\\a.png', '10,20,30,40')
    expect(command).toContain('Rectangle(10,20,30,40)')
    expect(command).toContain('$g.CopyFromScreen($r.Left,$r.Top,0,0,$r.Size)')
  })

  it('builds a macOS full-screen capture', () => {
    expect(screenshotCommand('darwin', '/tmp/a.png')).toBe("screencapture -x '/tmp/a.png'")
  })

  it('builds a Linux ImageMagick capture', () => {
    expect(screenshotCommand('linux', '/tmp/a.png')).toBe("import -window root '/tmp/a.png'")
  })

  it('rejects a malformed region', () => {
    expect(() => screenshotCommand('win32', 'C:\\tmp\\a.png', '1,2,3')).toThrow(/invalid region/)
  })

  it('returns a timestamped default path', () => {
    expect(defaultScreenshotPath()).toMatch(/dsh-screenshot-\d+\.png$/)
  })
})
