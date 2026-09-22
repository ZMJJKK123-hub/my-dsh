/**
 * One git command execution: argv-direct spawn through the `ctx.subprocess`
 * seam, optional confinement through `ctx.sandbox`, a caller-owned deadline,
 * and bounded collection of both output streams. The composition mirrors the
 * sandboxed bash executor: confine → spawn → classify denial — except here
 * the argv never passes through a shell, so tool arguments need no quoting.
 *
 * @module @dsh-custom/dsh-git-local
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'

/** A fully-specified one-shot git run. */
export interface GitRunInput {
  /** git arguments WITHOUT the executable; never shell-interpreted. */
  readonly argv: readonly string[]
  /** Working directory for the child. */
  readonly cwd: string
  /** Deadline in milliseconds; firing terminates the child and marks the result timed out. */
  readonly timeoutMs: number
  /** Per-stream in-memory collection cap in bytes; overflow keeps the tail. */
  readonly maxOutputBytes: number
  /** Grace period handed to the subprocess termination procedure. */
  readonly graceMs: number
  /** Caller cancellation; firing marks the result aborted. */
  readonly signal?: AbortSignal | undefined
  /** Explicit environment entries merged onto the provider's scrubbed base. */
  readonly env?: Readonly<Record<string, string>> | undefined
  /** Confinement to apply; absent means the host mounted no sandbox policy for this call. */
  readonly sandbox?: {
    readonly provider: SandboxProvider
    readonly policy: SandboxPolicy
  } | undefined
}

/** Outcome of one git run, in the shell seam's resolve-not-reject vocabulary. */
export interface GitRunResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
  readonly denied: boolean
  readonly timedOut: boolean
  readonly aborted: boolean
}

/**
 * Run one git command through `ctx.subprocess`, confined when a sandbox policy
 * is supplied. Resolves with the outcome for ANY process exit — nonzero exits,
 * timeouts, aborts, and denials included — and rejects only when the process
 * could not spawn at all.
 * @param ctx - context carrying `ctx.subprocess`.
 * @param gitPath - resolved git executable path (argv[0]).
 * @param input - the fully-specified run.
 */
export async function runGitCommand(ctx: Context, gitPath: string, input: GitRunInput): Promise<GitRunResult> {
  let argv: readonly string[] = [gitPath, ...input.argv]
  let denialSignatures: readonly string[] = []
  if (input.sandbox !== undefined) {
    const confined = input.sandbox.provider.confine([...argv], input.sandbox.policy)
    argv = confined.argv
    denialSignatures = confined.denialSignatures
  }
  const controller = new AbortController()
  let timedOut = false
  let aborted = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, input.timeoutMs)
  const onCallerAbort = () => {
    aborted = true
    controller.abort()
  }
  input.signal?.addEventListener('abort', onCallerAbort, { once: true })
  if (input.signal?.aborted === true) onCallerAbort()
  try {
    const handle = ctx.subprocess.spawn({
      argv,
      cwd: input.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: input.maxOutputBytes },
        stderr: { maxBytes: input.maxOutputBytes },
      },
      graceMs: input.graceMs,
      signal: controller.signal,
      ...input.env === undefined ? {} : { env: input.env },
    })
    const outcome = await handle.done
    const stdoutRead = handle.collected.stdout?.readFrom(0)
    const stderrRead = handle.collected.stderr?.readFrom(0)
    const stdout = stdoutRead?.text ?? ''
    const stderr = stderrRead?.text ?? ''
    const denied = (outcome.exitCode ?? 1) !== 0
      && denialSignatures.some(signature => stderr.toLowerCase().includes(signature.toLowerCase()))
    return {
      exitCode: outcome.exitCode,
      stdout,
      stderr,
      truncated: stdoutRead?.lossy === true || stderrRead?.lossy === true,
      denied,
      timedOut,
      aborted,
    }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onCallerAbort)
  }
}
