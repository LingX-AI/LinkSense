import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  BoundedOutputCapture,
  MAX_MANAGED_BROWSER_MCP_OUTPUT_BYTES,
  ManagedBrowserCommandCancelledError,
  ManagedBrowserCommandQueue,
  createCapturedBrowserCliRunner,
  managedBrowserCommandArgumentsSchema,
  runManagedBrowserCommand,
  validateManagedBrowserMcpCommand,
} from "../src/mcp/managed-browser-service.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("managed browser MCP helper", () => {
  it("serializes browser commands and keeps the queue usable after failure", async () => {
    const queue = new ManagedBrowserCommandQueue()
    const events: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = queue.run(async () => {
      events.push("first:start")
      await firstGate
      events.push("first:end")
      throw new Error("first failed")
    })
    const second = queue.run(async () => {
      events.push("second:start")
      return "second result"
    })

    await vi.waitFor(() => expect(events).toEqual(["first:start"]))
    releaseFirst?.()
    await expect(first).rejects.toThrow("first failed")
    await expect(second).resolves.toBe("second result")
    expect(events).toEqual(["first:start", "first:end", "second:start"])
  })

  it("accepts only bounded strict tool arguments", () => {
    expect(
      managedBrowserCommandArgumentsSchema.parse({
        command: "snapshot",
      }),
    ).toEqual({
      command: "snapshot",
      arguments: [],
      timeout_ms: 120_000,
    })
    expect(() =>
      managedBrowserCommandArgumentsSchema.parse({
        command: "snapshot",
        unknown: true,
      }),
    ).toThrow()
    expect(() =>
      managedBrowserCommandArgumentsSchema.parse({
        command: "snapshot",
        arguments: ["x".repeat(4_097)],
      }),
    ).toThrow()
  })

  it("allows only read-oriented commands and HTTP navigation", () => {
    expect(() =>
      validateManagedBrowserMcpCommand("open", ["https://github.com/trending"]),
    ).not.toThrow()
    expect(() =>
      validateManagedBrowserMcpCommand("snapshot", []),
    ).not.toThrow()
    for (const command of [
      "run-code",
      "eval",
      "upload",
      "state-load",
      "cookie-list",
      "localstorage-get",
      "route",
      "install",
      "attach",
      "kill-all",
      "click",
      "fill",
    ]) {
      expect(() => validateManagedBrowserMcpCommand(command, [])).toThrow(
        "browser command is unavailable in Plan mode",
      )
    }
    for (const target of [
      "file:///etc/passwd",
      "data:text/html,unsafe",
      "javascript:alert(1)",
      "/workspace/report.html",
    ]) {
      expect(() => validateManagedBrowserMcpCommand("goto", [target])).toThrow(
        "browser navigation requires an HTTP or HTTPS URL",
      )
    }
  })

  it("keeps the combined stdout and stderr capture within one byte limit", () => {
    const capture = new BoundedOutputCapture(8)
    capture.append("stdout", Buffer.from("abcdef"))
    capture.append("stderr", Buffer.from("123456"))

    expect(capture.result()).toEqual({
      stdout: "abcdef",
      stderr: "12",
      truncated: true,
    })
  })

  it("captures browser CLI output without inheriting MCP stdout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-browser-mcp-"))
    roots.push(root)
    const script = path.join(root, "browser-command.mjs")
    await writeFile(
      script,
      'process.stdout.write(`cwd=${process.cwd()};snapshot output`); process.stderr.write("browser warning")\n',
    )
    const capture = new BoundedOutputCapture(
      MAX_MANAGED_BROWSER_MCP_OUTPUT_BYTES,
    )
    const executionState = { cancelled: false, timedOut: false }
    const workspace = path.join(root, "workspace")
    await mkdir(workspace)
    const runner = createCapturedBrowserCliRunner({
      capture,
      requestSignal: new AbortController().signal,
      requestTimeoutMs: 5_000,
      executionState,
    })

    await expect(
      runner({
        cliEntry: script,
        args: [],
        environment: process.env,
        cwd: workspace,
        timeoutMs: 5_000,
      }),
    ).resolves.toBe(0)
    expect(capture.result()).toEqual({
      stdout: `cwd=${await realpath(workspace)};snapshot output`,
      stderr: "browser warning",
      truncated: false,
    })
    expect(executionState).toEqual({ cancelled: false, timedOut: false })
  })

  it("terminates a timed-out browser CLI child and reports timeout state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-browser-mcp-"))
    roots.push(root)
    const script = path.join(root, "slow-browser-command.mjs")
    await writeFile(script, "setInterval(() => undefined, 1_000)\n")
    const capture = new BoundedOutputCapture(1_024)
    const executionState = { cancelled: false, timedOut: false }
    const workspace = path.join(root, "workspace")
    await mkdir(workspace)
    const runner = createCapturedBrowserCliRunner({
      capture,
      requestSignal: new AbortController().signal,
      requestTimeoutMs: 25,
      executionState,
    })

    await expect(
      runner({
        cliEntry: script,
        args: [],
        environment: process.env,
        cwd: workspace,
        timeoutMs: 5_000,
      }),
    ).resolves.toBe(124)
    expect(executionState.timedOut).toBe(true)
  })

  it("passes only allowlisted arguments to browserCliMain and propagates cancellation", async () => {
    const browserMain = vi.fn(async (_args, _environment, _workspace, deps) => {
      deps.writeOutput?.("managed help")
      return 0
    })
    await expect(
      runManagedBrowserCommand(
        {
          command: "--help",
          arguments: [],
          timeout_ms: 5_000,
        },
        {
          environment: {},
          workspace: "/task/workspace",
          signal: new AbortController().signal,
          browserMain,
        },
      ),
    ).resolves.toEqual({
      exit_code: 0,
      stdout: "managed help",
      stderr: "",
      output_truncated: false,
      timed_out: false,
    })
    expect(browserMain).toHaveBeenCalledWith(
      ["--help"],
      {},
      "/task/workspace",
      expect.objectContaining({
        runCli: expect.any(Function),
        writeOutput: expect.any(Function),
      }),
    )

    browserMain.mockClear()
    const controller = new AbortController()
    controller.abort()
    await expect(
      runManagedBrowserCommand(
        { command: "snapshot", arguments: [], timeout_ms: 5_000 },
        {
          environment: {},
          workspace: "/task/workspace",
          signal: controller.signal,
          browserMain,
        },
      ),
    ).rejects.toBeInstanceOf(ManagedBrowserCommandCancelledError)
    expect(browserMain).not.toHaveBeenCalled()
  })
})
