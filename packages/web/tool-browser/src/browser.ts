/**
 * Minimal CDP browser automation for headless Microsoft Edge. Launches a
 * background Edge instance, connects over the DevTools WebSocket, and exposes
 * navigate/screenshot/evaluate primitives for the agent's
 * screenshot-analyze-operate loop.
 *
 * @module @deepseek-ai/dsh-tool-browser
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** One live headless browser owned by one agent session. */
export interface BrowserSession {
  readonly id: string
  readonly process: ChildProcess
  readonly ws: WebSocket
  readonly port: number
  readonly userDataDir: string
  readonly targetId: string
}

/** One CDP response frame. */
interface CdpResponse {
  readonly id?: number
  readonly result?: Record<string, unknown>
  readonly error?: { readonly code: number; readonly message: string }
}

interface PendingCall {
  readonly resolve: (value: CdpResponse) => void
  readonly reject: (reason: Error) => void
  readonly timer: NodeJS.Timeout
}

const pending = new Map<number, PendingCall>()
const loadWaiters = new Map<string, () => void>()
let nextId = 1

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function edgeExecutable(): string {
  const programFiles86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const candidates = [
    join(programFiles86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
  const found = candidates.find(path => existsSync(path))
  if (found === undefined) {
    throw new Error('Microsoft Edge was not found on this system')
  }
  return found
}

async function readDevToolsPort(userDataDir: string, process: ChildProcess): Promise<number> {
  const file = join(userDataDir, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) throw new Error('Edge exited before the DevTools port was ready')
    try {
      const text = await readFile(file, 'utf8')
      const port = Number(text.split(/\r?\n/)[0])
      if (Number.isInteger(port) && port > 0) return port
    } catch {
      // Port file not written yet; retry.
    }
    await delay(100)
  }
  throw new Error('Timed out waiting for Edge DevTools port')
}

async function findPageTarget(port: number): Promise<{ id: string; webSocketDebuggerUrl: string }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json() as Array<{
        id?: string
        type?: string
        webSocketDebuggerUrl?: string
      }>
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl !== undefined)
      if (page?.id !== undefined && page.webSocketDebuggerUrl !== undefined) {
        return { id: page.id, webSocketDebuggerUrl: page.webSocketDebuggerUrl }
      }
    } catch {
      // DevTools endpoint not ready yet; retry.
    }
    await delay(100)
  }
  throw new Error('Timed out waiting for Edge page target')
}

function cdpSend(session: BrowserSession, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = nextId
    nextId += 1
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP ${method} timed out`))
    }, 30_000)
    pending.set(id, {
      resolve: (message) => {
        if (message.error !== undefined) {
          reject(new Error(`CDP ${method} failed: ${message.error.message}`))
          return
        }
        resolve(message.result ?? {})
      },
      reject,
      timer,
    })
    session.ws.send(JSON.stringify({ id, method, params }))
  })
}

async function navigateAndWait(session: BrowserSession, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (loadWaiters.delete(session.id)) resolve()
    }, 15_000)
    loadWaiters.set(session.id, () => {
      clearTimeout(timer)
      resolve()
    })
    void cdpSend(session, 'Page.navigate', { url }).catch((error: unknown) => {
      clearTimeout(timer)
      loadWaiters.delete(session.id)
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

/** Launch headless Edge, open the URL, and return a connected session. */
export async function openBrowser(url: string, headless: boolean): Promise<BrowserSession> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'dsh-browser-'))
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-features=Translate',
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ]
  const child = spawn(edgeExecutable(), args, { stdio: 'ignore', windowsHide: true })
  child.on('error', () => undefined)

  const port = await readDevToolsPort(userDataDir, child)
  const target = await findPageTarget(port)

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => { resolve() }
    ws.onerror = () => { reject(new Error('CDP WebSocket connection failed')) }
  })

  const session: BrowserSession = {
    id: randomUUID(),
    process: child,
    ws,
    port,
    userDataDir,
    targetId: target.id,
  }

  ws.onmessage = (event: MessageEvent) => {
    let message: CdpResponse & { method?: string }
    try {
      message = JSON.parse(String(event.data)) as CdpResponse & { method?: string }
    } catch {
      return
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (call === undefined) return
      clearTimeout(call.timer)
      call.resolve(message)
      return
    }
    if (message.method === 'Page.loadEventFired') {
      const waiter = loadWaiters.get(session.id)
      if (waiter !== undefined) {
        loadWaiters.delete(session.id)
        waiter()
      }
    }
  }

  await cdpSend(session, 'Page.enable')
  await cdpSend(session, 'Runtime.enable')
  await navigateAndWait(session, url)
  return session
}

/** Capture the current page as a PNG file. */
export async function screenshotPage(
  session: BrowserSession,
  outputPath: string,
): Promise<{ path: string; bytes: number }> {
  const result = await cdpSend(session, 'Page.captureScreenshot', { format: 'png' })
  const data = result.data
  if (typeof data !== 'string') throw new Error('CDP screenshot returned no data')
  const buffer = Buffer.from(data, 'base64')
  await writeFile(outputPath, buffer)
  return { path: outputPath, bytes: buffer.length }
}

/** Evaluate a JavaScript expression in the page and return the JSON-safe value. */
export async function evaluatePage(
  session: BrowserSession,
  expression: string,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const response = await cdpSend(session, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  const exceptionDetails = response.exceptionDetails as
    | { text?: string; exception?: { description?: string } }
    | undefined
  if (exceptionDetails !== undefined) {
    return {
      ok: false,
      error: exceptionDetails.exception?.description
        ?? exceptionDetails.text
        ?? 'page evaluation failed',
    }
  }
  const evaluated = response.result as { type?: string; value?: unknown; description?: string } | undefined
  return { ok: true, result: evaluated?.value }
}

/** Close the browser, kill the child process, and remove its profile. */
export async function closeBrowser(session: BrowserSession): Promise<void> {
  try {
    session.ws.close()
  } catch {
    // Already closed.
  }
  try {
    session.process.kill()
  } catch {
    // Already exited.
  }
  await rm(session.userDataDir, { recursive: true, force: true }).catch(() => undefined)
}
