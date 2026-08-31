import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

const conversationId = "01900000-0000-7000-8000-000000000001"
const children: ChildProcessWithoutNullStreams[] = []
const roots: string[] = []

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL")
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("managed browser MCP server", () => {
  it("keeps browser output inside a bounded JSON-RPC tool response", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-browser-mcp-"))
    roots.push(root)
    const home = path.join(root, "home")
    const codexHome = path.join(home, ".codex")
    const workspace = path.join(home, "workspaces", conversationId)
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      ...["artifacts", "attachments", "temp"].map((directory) =>
        mkdir(path.join(workspace, directory), { recursive: true }),
      ),
    ])
    const child = startMcpServer(home, codexHome)
    const rpc = rpcClient(child)

    await expect(
      rpc.call(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
    ).resolves.toMatchObject({
      serverInfo: { name: "linksense-managed-browser" },
    })
    await expect(rpc.call(2, "tools/list", {})).resolves.toMatchObject({
      tools: [
        expect.objectContaining({
          name: "run_browser_command",
          annotations: expect.objectContaining({ readOnlyHint: true }),
        }),
      ],
    })

    const response = (await rpc.call(3, "tools/call", {
      name: "run_browser_command",
      arguments: { command: "--help" },
    })) as {
      content: Array<{ type: string; text: string }>
      isError: boolean
    }
    const result = JSON.parse(response.content[0]?.text ?? "") as {
      exit_code: number
      stdout: string
      stderr: string
      output_truncated: boolean
      timed_out: boolean
    }
    expect(result).toMatchObject({
      exit_code: expect.any(Number),
      stdout: expect.any(String),
      stderr: expect.any(String),
      output_truncated: expect.any(Boolean),
      timed_out: false,
    })
    expect(
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
    ).toBeLessThanOrEqual(256 * 1024)

    await expect(
      rpc.call(4, "tools/call", {
        name: "run_browser_command",
        arguments: { command: "run-code", arguments: ["process.exit()"] },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ code: "BROWSER_COMMAND_INVALID" }),
        },
      ],
      isError: true,
    })
  })
})

function startMcpServer(
  home: string,
  codexHome: string,
): ChildProcessWithoutNullStreams {
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"))
  const script = fileURLToPath(
    new URL("../src/mcp/managed-browser-service-server.ts", import.meta.url),
  )
  const child = spawn(process.execPath, [tsxCli, script], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      LINKSENSE_CONVERSATION_ID: conversationId,
      LINKSENSE_BROWSER_READ_ONLY: "1",
    },
    stdio: "pipe",
  })
  children.push(child)
  return child
}

function rpcClient(child: ChildProcessWithoutNullStreams) {
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >()
  const lines = createInterface({ input: child.stdout })
  lines.on("line", (line) => {
    let message: {
      id?: number
      result?: unknown
      error?: { message?: string }
    }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      for (const waiter of pending.values()) {
        waiter.reject(new Error(`non-JSON MCP stdout: ${line}`))
      }
      pending.clear()
      return
    }
    if (typeof message.id !== "number") return
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) {
      waiter.reject(new Error(message.error.message ?? "MCP request failed"))
    } else {
      waiter.resolve(message.result)
    }
  })
  child.once("exit", (code) => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error(`MCP server exited with ${String(code)}`))
    }
    pending.clear()
  })
  return {
    call(id: number, method: string, params: unknown): Promise<unknown> {
      const result = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      return result
    },
  }
}
