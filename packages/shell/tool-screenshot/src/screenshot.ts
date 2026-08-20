/**
 * Screenshot command construction and execution. The tool captures the screen
 * through the shell capability seam so the same sandbox policy applies as for
 * `tool-pwsh`; the saved PNG path is then available to an external vision MCP
 * tool (`mcp__glm4v__analyze_image`) for the agent's own image-recognition loop.
 *
 * @module @deepseek-ai/dsh-tool-screenshot
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-fs'

/** Tool input for one screenshot capture. */
export interface ScreenshotOptions {
  /** Absolute or workspace-relative PNG path; defaults to the OS temp directory. */
  readonly outputPath?: string | undefined
  /** Capture region as `x,y,w,h` in pixels; defaults to the full virtual screen. */
  readonly region?: string | undefined
}

/** Canonical screenshot result returned to the model. */
export interface ScreenshotResult {
  readonly path: string
  readonly bytes: number
}

/** Default screenshot path: a timestamped PNG in the OS temp directory. */
export function defaultScreenshotPath(): string {
  return join(tmpdir(), `dsh-screenshot-${Date.now()}.png`)
}

/** Parse `x,y,w,h`; returns undefined for an absent region. */
function parseRegion(region: string | undefined): [number, number, number, number] | undefined {
  if (region === undefined || region.trim() === '') return undefined
  const parts = region.split(',').map(part => Number(part.trim()))
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part) || part < 0)) {
    throw new Error(`invalid region "${region}": expected x,y,w,h in pixels`)
  }
  const [x, y, w, h] = parts
  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    throw new Error(`invalid region "${region}": expected x,y,w,h in pixels`)
  }
  return [x, y, w, h]
}

/** Quote one path for a PowerShell single-quoted string. */
function quotePowerShell(path: string): string {
  return `'${path.replaceAll("'", "''")}'`
}

/** Quote one path for a POSIX shell single-quoted string. */
function quotePosix(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`
}

/**
 * Build the platform-specific shell command that captures the screen to a PNG.
 * @param platform - Node.js platform identifier.
 * @param outputPath - absolute PNG path to write.
 * @param region - optional `x,y,w,h` capture region.
 * @returns the shell command string.
 */
export function screenshotCommand(platform: NodeJS.Platform, outputPath: string, region?: string): string {
  const parsed = parseRegion(region)
  if (platform === 'win32') {
    const ps = [
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
      '$b=[System.Windows.Forms.SystemInformation]::VirtualScreen',
      '$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height',
      '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    ]
    if (parsed !== undefined) {
      ps.push(`$r=New-Object System.Drawing.Rectangle(${parsed[0]},${parsed[1]},${parsed[2]},${parsed[3]})`)
      ps.push('$g.CopyFromScreen($r.Left,$r.Top,0,0,$r.Size)')
    } else {
      ps.push('$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)')
    }
    ps.push(`$bmp.Save(${quotePowerShell(outputPath)},[System.Drawing.Imaging.ImageFormat]::Png)`)
    ps.push('$g.Dispose(); $bmp.Dispose()')
    return ps.join('; ')
  }
  const quoted = quotePosix(outputPath)
  if (platform === 'darwin') {
    return parsed === undefined
      ? `screencapture -x ${quoted}`
      : `screencapture -x -R ${parsed[0]},${parsed[1]},${parsed[2]},${parsed[3]} ${quoted}`
  }
  return parsed === undefined
    ? `import -window root ${quoted}`
    : `import -window root -crop ${parsed[2]}x${parsed[3]}+${parsed[0]}+${parsed[1]} ${quoted}`
}

/**
 * Capture the screen through `ctx.shell`, then stat the resulting PNG through
 * `ctx.fs` so the returned size is a harness-observed fact.
 * @param ctx - plugin context with shell and filesystem services.
 * @param options - output path and optional region.
 * @param signal - abort signal forwarded to shell and filesystem calls.
 * @returns the saved PNG path and byte size.
 */
export async function takeScreenshot(
  ctx: Context,
  options: ScreenshotOptions,
  signal: AbortSignal | undefined,
): Promise<ScreenshotResult> {
  const outputPath = options.outputPath?.trim() === '' || options.outputPath === undefined
    ? defaultScreenshotPath()
    : options.outputPath
  const command = screenshotCommand(process.platform, outputPath, options.region)
  const result = await ctx.shell.run(ctx.shell.resolve({
    command,
    timeoutMs: 30_000,
    signal,
    // Screen capture needs desktop/display access that a file-effect sandbox
    // would otherwise block, so the command always runs full-access.
    sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: process.cwd() },
  }))
  if (result.exitCode !== 0) {
    const detail = result.stderr.text !== '' ? result.stderr.text : result.stdout.text
    throw new Error(`screenshot failed: ${detail.trim()}`)
  }
  const info = await ctx.fs.lstat(outputPath, undefined, signal)
  if (info === undefined || info.type !== 'file') {
    throw new Error(`screenshot file not found after capture: ${outputPath}`)
  }
  return { path: outputPath, bytes: info.size ?? 0 }
}
