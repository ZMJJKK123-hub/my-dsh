/**
 * Human-hand input simulation tools: mouse trajectory/click/scroll and
 * keyboard input. Execution goes through the `ctx.shell` capability seam with
 * a full-access sandbox policy because real desktop input requires the same
 * desktop/display access as `tool-screenshot`.
 *
 * @module @deepseek-ai/dsh-tool-input
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-shell'
import {
  buildKeyboardCommand,
  buildMouseClickCommand,
  buildMouseScrollCommand,
  buildMouseTrajectoryCommand,
  type MouseAction,
  type MouseButton,
} from './input.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-input'

/** Services required by the input tools. */
export const inject = ['tools', 'shell']

const POINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number', required: true, description: '屏幕 X 坐标（像素）' },
    y: { type: 'number', required: true, description: '屏幕 Y 坐标（像素）' },
  },
} as const

async function runCommand(ctx: Context, command: string, exec: ToolExecution): Promise<void> {
  const result = await ctx.shell.run(ctx.shell.resolve({
    command,
    timeoutMs: 60_000,
    signal: exec.signal,
    // Real desktop input needs full desktop/display access, so the command
    // always runs full-access.
    sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: process.cwd() },
  }))
  if (result.exitCode !== 0) {
    const detail = result.stderr.text !== '' ? result.stderr.text : result.stdout.text
    throw new Error(`input command failed: ${detail.trim()}`)
  }
}

/**
 * Register the input simulation tools.
 * @param ctx - plugin context carrying tools and shell services.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'mouse_trajectory',
    description: '模拟鼠标沿轨迹移动，可执行点击/双击/拖动。会真实控制当前桌面鼠标。',
    parameters: {
      points: { type: 'array', required: true, items: POINT_SCHEMA, description: '轨迹点列表，至少一个点' },
      duration_ms: { type: 'number', description: '移动总耗时（毫秒，默认 300）' },
      action: { type: 'string', enum: ['move', 'click', 'double-click', 'drag'], description: '终点动作（默认 move）' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键（默认 left）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          points: { type: 'integer', required: true },
          action: { type: 'string', required: true },
          duration_ms: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `鼠标${value.action}完成：${value.points} 个轨迹点，耗时 ${value.duration_ms}ms` }],
    },
    async execute(args, exec) {
      const points = args.points as Array<{ x: number; y: number }>
      const action = (args.action ?? 'move') as MouseAction
      const button = (args.button ?? 'left') as MouseButton
      const durationMs = args.duration_ms as number | undefined
      const command = buildMouseTrajectoryCommand({ points, action, button, ...(durationMs === undefined ? {} : { durationMs }) })
      await runCommand(ctx, command, exec)
      return { points: points.length, action, duration_ms: durationMs ?? 300 }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mouse_click',
    description: '在指定屏幕坐标点击鼠标（支持左右中键、单击/双击）。会真实控制当前桌面鼠标。',
    parameters: {
      x: { type: 'number', required: true, description: '屏幕 X 坐标（像素）' },
      y: { type: 'number', required: true, description: '屏幕 Y 坐标（像素）' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标按键（默认 left）' },
      clicks: { type: 'integer', description: '点击次数（默认 1，2 表示双击）' },
      duration_ms: { type: 'number', description: '移动耗时（毫秒，默认 100）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'integer', required: true },
          y: { type: 'integer', required: true },
          button: { type: 'string', required: true },
          clicks: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已在 (${value.x}, ${value.y}) ${value.button}${value.clicks > 1 ? ` ${value.clicks} 次` : ''}点击` }],
    },
    async execute(args, exec) {
      const x = args.x as number
      const y = args.y as number
      const button = (args.button ?? 'left') as MouseButton
      const clicks = (args.clicks ?? 1) as number
      const durationMs = args.duration_ms as number | undefined
      const command = buildMouseClickCommand({ x, y, button, clicks, ...(durationMs === undefined ? {} : { durationMs }) })
      await runCommand(ctx, command, exec)
      return { x, y, button, clicks }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mouse_scroll',
    description: '模拟鼠标滚轮滚动。正数向上滚动，负数向下滚动；可选先移动到指定坐标。',
    parameters: {
      delta: { type: 'integer', required: true, description: '滚轮滚动量（正数向上，负数向下）' },
      x: { type: 'integer', description: '滚动前移动到的 X 坐标（可选）' },
      y: { type: 'integer', description: '滚动前移动到的 Y 坐标（可选）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          delta: { type: 'integer', required: true },
          x: { type: 'integer' },
          y: { type: 'integer' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `滚轮滚动 ${value.delta}${value.x !== undefined ? ` @ (${value.x}, ${value.y})` : ''}` }],
    },
    async execute(args, exec) {
      const delta = args.delta as number
      const x = args.x as number | undefined
      const y = args.y as number | undefined
      const command = buildMouseScrollCommand({
        delta,
        ...(x === undefined ? {} : { x }),
        ...(y === undefined ? {} : { y }),
      })
      await runCommand(ctx, command, exec)
      return { delta, ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'keyboard_input',
    description: '模拟键盘输入：可输入文本，也可按组合键（如 ctrl+c、alt+tab）。会真实控制当前桌面键盘。',
    parameters: {
      text: { type: 'string', description: '要输入的文本' },
      keys: { type: 'array', items: { type: 'string' }, description: '按键组合，如 ["ctrl","c"]；支持 enter/tab/esc/space/arrows/F1-F24/字母/数字等' },
      delay_ms: { type: 'integer', description: '每个字符/按键之间的延迟（毫秒，默认 30）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text_length: { type: 'integer', required: true },
          keys: { type: 'array', items: { type: 'string' }, required: true },
          delay_ms: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `键盘输入完成：文本 ${value.text_length} 字符，按键 [${value.keys.join(', ')}]` }],
    },
    async execute(args, exec) {
      const text = (args.text ?? '') as string
      const keys = (args.keys ?? []) as string[]
      const delayMs = (args.delay_ms ?? 30) as number
      const command = buildKeyboardCommand({ text, keys, delayMs })
      await runCommand(ctx, command, exec)
      return { text_length: text.length, keys, delay_ms: delayMs }
    },
  }))
}
