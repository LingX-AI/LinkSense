import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createServer, type Server } from "node:http"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

const CONVERSATION_ID = "01900000-0000-7000-8000-000000000001"
const children: ChildProcessWithoutNullStreams[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGTERM")
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  )
})

describe("LinkSense Core MCP current user module", () => {
  it("reads the current user over protected HTTP", async () => {
    let receivedAuthorization: string | undefined
    let receivedBody: unknown
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        receivedAuthorization = request.headers.authorization
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            success: true,
            user: {
              name: "Ada",
              email: "ada@example.com",
              user_groups: [
                {
                  id: "01900000-0000-7000-8000-000000000010",
                  name: "Research",
                },
              ],
            },
            token_quota: {
              total: null,
              weekly: {
                limit_tokens: "1000",
                used_tokens: "250",
                remaining_tokens: "750",
                remaining_percentage: 75,
                reset_at: "2026-08-24T00:00:00.000Z",
              },
              monthly: null,
            },
          }),
        )
      })
    })
    servers.push(server)
    await listen(server)
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing test port")
    const token = "turn-token-00000000000000000000000000000000"
    const rpc = rpcClient(
      startMcpServer(`http://127.0.0.1:${address.port}/info`, token),
    )

    await expect(
      rpc.call(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
    ).resolves.toMatchObject({
      serverInfo: { name: "linksense_core" },
      instructions: expect.stringContaining("Follow each tool's description and parameter schema"),
    })
    await expect(rpc.call(2, "tools/list", {})).resolves.toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "get_current_user_info",
          description: expect.stringContaining("Profile data is not authorization to access other resources"),
          annotations: expect.objectContaining({ readOnlyHint: true }),
        }),
      ]),
    })
    await expect(
      rpc.call(3, "tools/call", {
        name: "get_current_user_info",
        arguments: {},
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            user: {
              name: "Ada",
              email: "ada@example.com",
              user_groups: [
                {
                  id: "01900000-0000-7000-8000-000000000010",
                  name: "Research",
                },
              ],
            },
            token_quota: {
              total: null,
              weekly: {
                limit_tokens: "1000",
                used_tokens: "250",
                remaining_tokens: "750",
                remaining_percentage: 75,
                reset_at: "2026-08-24T00:00:00.000Z",
              },
              monthly: null,
            },
          }),
        },
      ],
      isError: false,
    })
    expect(receivedAuthorization).toBe(`Bearer ${token}`)
    expect(receivedBody).toEqual({})
  })

  it("returns stable failures for invalid arguments and upstream errors", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" })
      response.end(
        JSON.stringify({ code: "CURRENT_USER_UNAVAILABLE", retryable: true }),
      )
    })
    servers.push(server)
    await listen(server)
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing test port")
    const rpc = rpcClient(
      startMcpServer(
        `http://127.0.0.1:${address.port}/info`,
        "turn-token-00000000000000000000000000000000",
      ),
    )

    await expect(
      rpc.call(0, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
    ).resolves.toMatchObject({ serverInfo: { name: "linksense_core" } })

    await expect(
      rpc.call(1, "tools/call", {
        name: "get_current_user_info",
        arguments: { user_id: "01900000-0000-7000-8000-000000000099" },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: "CURRENT_USER_INVALID",
            retryable: false,
          }),
        },
      ],
      isError: true,
    })
    await expect(
      rpc.call(2, "tools/call", {
        name: "get_current_user_info",
        arguments: {},
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: "CURRENT_USER_UNAVAILABLE",
            retryable: true,
          }),
        },
      ],
      isError: true,
    })
  })
})

function startMcpServer(
  endpoint: string,
  token: string,
): ChildProcessWithoutNullStreams {
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"))
  const script = fileURLToPath(
    new URL("../src/mcp/core-service-server.ts", import.meta.url),
  )
  const child = spawn(process.execPath, [tsxCli, script], {
    env: {
      PATH: process.env.PATH,
      LINKSENSE_FILE_SERVICE_ENDPOINT:
        "http://127.0.0.1:1/register-artifact",
      LINKSENSE_FILE_SERVICE_TOKEN:
        "unused-file-token-000000000000000000000000000000000",
      LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:1/form",
      LINKSENSE_FORM_SERVICE_TOKEN:
        "unused-form-token-00000000000000000000000000000000",
      LINKSENSE_IMAGE_GENERATION_ENDPOINT: "http://127.0.0.1:1/generate",
      LINKSENSE_IMAGE_GENERATION_TOKEN:
        "unused-image-token-00000000000000000000000000000000",
      LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: "http://127.0.0.1:1/search",
      LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
      LINKSENSE_KNOWLEDGE_SERVICE_TOKEN:
        "unused-knowledge-token-0000000000000000000000000000",
      LINKSENSE_SKILL_CREATOR_ENDPOINT: "http://127.0.0.1:1/skill",
      LINKSENSE_SKILL_CREATOR_TOKEN:
        "unused-skill-token-00000000000000000000000000000000",
      LINKSENSE_CURRENT_USER_ENDPOINT: endpoint,
      LINKSENSE_CURRENT_USER_TOKEN: token,
      LINKSENSE_CONVERSATION_ID: CONVERSATION_ID,
      LINKSENSE_COLLABORATION_MODE: "default",
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
    const message = JSON.parse(line) as {
      id?: number
      result?: unknown
      error?: { message?: string }
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
      waiter.reject(new Error(`MCP subprocess exited with ${String(code)}`))
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

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
}
