import { spawn } from "node:child_process"

import { z } from "zod"

import {
  browserCliMain,
  type BrowserCliRunner,
} from "../browser/cli-wrapper.js"

export const MAX_MANAGED_BROWSER_MCP_OUTPUT_BYTES = 256 * 1024
export const MAX_MANAGED_BROWSER_MCP_TIMEOUT_MS = 120_000

export const managedBrowserCommandArgumentsSchema = z
  .strictObject({
    command: z.string().min(1).max(128).refine((value) => !value.includes("\0")),
    arguments: z
      .array(
        z.string().max(4_096).refine((value) => !value.includes("\0")),
      )
      .max(128)
      .default([]),
    timeout_ms: z
      .number()
      .int()
      .min(1_000)
      .max(MAX_MANAGED_BROWSER_MCP_TIMEOUT_MS)
      .default(MAX_MANAGED_BROWSER_MCP_TIMEOUT_MS),
  })
  .refine(
    (input) =>
      input.command.length +
        input.arguments.reduce((total, argument) => total + argument.length, 0) <=
      32_768,
    { message: "browser command arguments are too large" },
  )

export type ManagedBrowserCommandArguments = z.infer<
  typeof managedBrowserCommandArgumentsSchema
>

export type ManagedBrowserCommandResult = {
  exit_code: number
  stdout: string
  stderr: string
  output_truncated: boolean
  timed_out: boolean
}

type CapturedOutput = {
  stdout: string
  stderr: string
  truncated: boolean
}

export type ManagedBrowserExecutionState = {
  cancelled: boolean
  timedOut: boolean
}

export class ManagedBrowserCommandCancelledError extends Error {
  constructor() {
    super("managed browser command was cancelled")
    this.name = "ManagedBrowserCommandCancelledError"
  }
}

export class ManagedBrowserCommandValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ManagedBrowserCommandValidationError"
  }
}

export class ManagedBrowserCommandQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export async function runManagedBrowserCommand(
  input: ManagedBrowserCommandArguments,
  options: {
    environment: NodeJS.ProcessEnv
    workspace: string
    signal: AbortSignal
    browserMain?: typeof browserCliMain
  },
): Promise<ManagedBrowserCommandResult> {
  const parsed = managedBrowserCommandArgumentsSchema.parse(input)
  validateManagedBrowserMcpCommand(parsed.command, parsed.arguments)
  if (options.signal.aborted) {
    throw new ManagedBrowserCommandCancelledError()
  }
  const capture = new BoundedOutputCapture(
    MAX_MANAGED_BROWSER_MCP_OUTPUT_BYTES,
  )
  const executionState: ManagedBrowserExecutionState = {
    cancelled: false,
    timedOut: false,
  }
  const runCli = createCapturedBrowserCliRunner({
    capture,
    requestSignal: options.signal,
    requestTimeoutMs: parsed.timeout_ms,
    executionState,
  })
  const browserMain = options.browserMain ?? browserCliMain
  const exitCode = await browserMain(
    [parsed.command, ...parsed.arguments],
    options.environment,
    options.workspace,
    {
      runCli,
      writeOutput: (value) => capture.append("stdout", Buffer.from(value)),
    },
  )
  if (executionState.cancelled || options.signal.aborted) {
    throw new ManagedBrowserCommandCancelledError()
  }
  const output = capture.result()
  return {
    exit_code: exitCode,
    stdout: output.stdout,
    stderr: output.stderr,
    output_truncated: output.truncated,
    timed_out: executionState.timedOut,
  }
}

export function createCapturedBrowserCliRunner(input: {
  capture: Pick<BoundedOutputCapture, "append">
  requestSignal: AbortSignal
  requestTimeoutMs: number
  executionState: ManagedBrowserExecutionState
}): BrowserCliRunner {
  return async (command) => {
    if (input.requestSignal.aborted) {
      input.executionState.cancelled = true
      return 130
    }
    const child = spawn(process.execPath, [command.cliEntry, ...command.args], {
      cwd: command.cwd,
      env: command.environment,
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout.on("data", (chunk: Buffer) =>
      input.capture.append("stdout", chunk),
    )
    child.stderr.on("data", (chunk: Buffer) =>
      input.capture.append("stderr", chunk),
    )

    const timeoutMs = Math.min(command.timeoutMs, input.requestTimeoutMs)
    let settled = false
    const stop = (reason: "cancelled" | "timed_out") => {
      if (settled) return
      if (reason === "cancelled") input.executionState.cancelled = true
      else input.executionState.timedOut = true
      child.kill("SIGKILL")
    }
    const onAbort = () => stop("cancelled")
    input.requestSignal.addEventListener("abort", onAbort, { once: true })
    const timer = setTimeout(() => stop("timed_out"), timeoutMs)
    timer.unref()

    return await new Promise<number>((resolve, reject) => {
      child.once("error", (error) => {
        settled = true
        clearTimeout(timer)
        input.requestSignal.removeEventListener("abort", onAbort)
        reject(error)
      })
      child.once("exit", (code, signal) => {
        settled = true
        clearTimeout(timer)
        input.requestSignal.removeEventListener("abort", onAbort)
        if (input.executionState.cancelled) {
          resolve(130)
          return
        }
        if (input.executionState.timedOut) {
          resolve(124)
          return
        }
        resolve(code ?? (signal ? 128 : 1))
      })
    })
  }
}

const managedBrowserMcpCommands = new Set([
  "--help",
  "--version",
  "open",
  "goto",
  "open-workspace-html",
  "close",
  "snapshot",
  "find",
  "hover",
  "mousewheel",
  "go-back",
  "go-forward",
  "reload",
  "screenshot",
  "pdf",
  "tab-list",
  "tab-new",
  "tab-close",
  "tab-select",
  "requests",
  "request",
  "request-headers",
  "request-body",
  "response-headers",
  "response-body",
  "console",
])

export function validateManagedBrowserMcpCommand(
  command: string,
  arguments_: string[],
): void {
  if (!managedBrowserMcpCommands.has(command)) {
    throw new ManagedBrowserCommandValidationError(
      "browser command is unavailable in Plan mode",
    )
  }
  if (["open", "goto", "tab-new"].includes(command)) {
    const target = arguments_[0]
    if (!target) {
      throw new ManagedBrowserCommandValidationError(
        "browser navigation requires an HTTP or HTTPS URL",
      )
    }
    let url: URL
    try {
      url = new URL(target)
    } catch {
      throw new ManagedBrowserCommandValidationError(
        "browser navigation requires an HTTP or HTTPS URL",
      )
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ManagedBrowserCommandValidationError(
        "browser navigation requires an HTTP or HTTPS URL",
      )
    }
  }
}

export class BoundedOutputCapture {
  private remainingBytes: number
  private readonly stdoutChunks: Buffer[] = []
  private readonly stderrChunks: Buffer[] = []
  private wasTruncated = false

  constructor(maximumBytes: number) {
    if (!Number.isInteger(maximumBytes) || maximumBytes < 1) {
      throw new Error("managed browser output limit must be positive")
    }
    this.remainingBytes = maximumBytes
  }

  append(stream: "stdout" | "stderr", chunk: Buffer): void {
    if (chunk.byteLength === 0) return
    const accepted = chunk.subarray(0, this.remainingBytes)
    if (accepted.byteLength > 0) {
      ;(stream === "stdout" ? this.stdoutChunks : this.stderrChunks).push(
        Buffer.from(accepted),
      )
      this.remainingBytes -= accepted.byteLength
    }
    if (accepted.byteLength < chunk.byteLength) this.wasTruncated = true
  }

  result(): CapturedOutput {
    return {
      stdout: Buffer.concat(this.stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(this.stderrChunks).toString("utf8"),
      truncated: this.wasTruncated,
    }
  }
}
