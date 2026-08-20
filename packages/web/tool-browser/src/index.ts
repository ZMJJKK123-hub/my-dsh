/**
 * Background browser automation tools for the screenshot-analyze-operate
 * loop. Uses headless Microsoft Edge over CDP so the browser never steals the
 * foreground from the user's current application.
 *
 * @module @deepseek-ai/dsh-tool-browser
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  closeBrowser, evaluatePage, openBrowser, screenshotPage, type BrowserSession,
} from './browser.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-browser'

/** Services required by the browser tools. */
export const inject = ['tools']

/** Live browser per agent session. */
const browsers = new Map<string, BrowserSession>()

function sessionKey(exec: ToolExecution): string {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined) throw new Error('browser tools require an agent session')
  return String(sessionId)
}

function requireBrowser(exec: ToolExecution): BrowserSession {
  const key = sessionKey(exec)
  const browser = browsers.get(key)
  if (browser === undefined) {
    throw new Error('no browser is open for this session; call browser_open first')
  }
  return browser
}

/**
 * Register the browser tools.
 * @param ctx - plugin context carrying the tools registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'browser_open',
    description: '在后台（无头 Edge）打开一个网页，返回浏览器句柄。用于自动打开测试网站后截图/分析/操作。',
    parameters: {
      url: { type: 'string', required: true, description: '要打开的网址，例如 http://localhost:8000' },
      headless: { type: 'boolean', description: '是否无头运行（默认 true，不显示窗口）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          handle: { type: 'string', required: true },
          url: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已打开 ${value.url}（handle: ${value.handle}）` }],
    },
    async execute(args, exec) {
      const key = sessionKey(exec)
      const existing = browsers.get(key)
      if (existing !== undefined) {
        await closeBrowser(existing)
        browsers.delete(key)
      }
      const browser = await openBrowser(args.url, args.headless ?? true)
      browsers.set(key, browser)
      return { handle: browser.id, url: args.url }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description: '截取当前后台网页内容并保存为 PNG，返回图片路径。用于配合 mcp__glm4v__analyze_image 分析页面。',
    parameters: {
      output_path: { type: 'string', description: '保存 PNG 的路径（默认系统临时目录）' },
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
      render: (_args, value) => [{ type: 'text', text: `页面截图已保存：${value.path}（${value.bytes} 字节）` }],
    },
    async execute(args, exec) {
      const browser = requireBrowser(exec)
      const outputPath = args.output_path?.trim() === '' || args.output_path === undefined
        ? join(tmpdir(), `dsh-browser-${Date.now()}.png`)
        : args.output_path
      return screenshotPage(browser, outputPath)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_eval',
    description: '在后台网页里执行一段 JavaScript，返回结果。用于点击、输入、读取页面状态等操作。',
    parameters: {
      expression: { type: 'string', required: true, description: '要执行的 JS 表达式，例如 document.querySelector("button").click()' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          result: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `执行结果：${value.result}` }],
    },
    async execute(args, exec) {
      const browser = requireBrowser(exec)
      const outcome = await evaluatePage(browser, args.expression)
      if (!outcome.ok) {
        throw new Error(outcome.error ?? 'browser_eval failed')
      }
      return { result: JSON.stringify(outcome.result ?? null) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_close',
    description: '关闭当前会话的后台浏览器，释放资源。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          closed: { type: 'boolean', required: true },
        },
      },
      render: () => [{ type: 'text', text: '浏览器已关闭' }],
    },
    async execute(_args, exec) {
      const key = sessionKey(exec)
      const browser = browsers.get(key)
      if (browser !== undefined) {
        await closeBrowser(browser)
        browsers.delete(key)
      }
      return { closed: true }
    },
  }))

  ctx.on('session/disposed', (session) => {
    const browser = browsers.get(String(session.id))
    if (browser !== undefined) {
      browsers.delete(String(session.id))
      void closeBrowser(browser)
    }
  })
}
