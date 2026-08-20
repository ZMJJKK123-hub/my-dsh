/**
 * Model-facing screenshot tool: captures the current screen to a PNG so the
 * agent can recognize its own screenshots through an external vision MCP tool
 * (`mcp__glm4v__analyze_image` / `ocr_image`). Execution goes through the
 * `ctx.shell` capability seam, so the same sandbox policy applies as for other
 * shell-backed tools.
 *
 * @module @deepseek-ai/dsh-tool-screenshot
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-fs'
import { takeScreenshot } from './screenshot.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-screenshot'

/** Services required by the screenshot tool. */
export const inject = ['tools', 'shell', 'fs']

/**
 * Register the `screenshot` tool.
 * @param ctx - plugin context carrying tools, shell, and filesystem services.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'screenshot',
    description: '截取当前屏幕保存为 PNG，返回图片文件的绝对路径。截图后请调用 mcp__glm4v__analyze_image 或 mcp__glm4v__ocr_image 识别该图片。',
    parameters: {
      output_path: { type: 'string', description: '保存 PNG 的路径（默认系统临时目录，建议传入工作区绝对路径）' },
      region: { type: 'string', description: '截图区域 `x,y,w,h`（像素，默认全屏）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `截图已保存：${value.path}（${value.bytes} 字节）` }],
    },
    async execute(args, exec) {
      return takeScreenshot(ctx, { outputPath: args.output_path, region: args.region }, exec.signal)
    },
  }))
}
