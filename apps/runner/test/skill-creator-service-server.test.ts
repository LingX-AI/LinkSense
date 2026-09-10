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

describe("LinkSense Core MCP Skill creator module", () => {
  it("previews and confirms an opaque Skill installation over protected HTTP", async () => {
    const requests: Array<{
      url: string
      authorization: string | undefined
      body: unknown
    }> = []
    const installToken = "signed-install-token-" + "x".repeat(80)
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        requests.push({
          url: request.url ?? "",
          authorization: request.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify(
            request.url === "/preview"
              ? previewResult(installToken)
              : installResult(),
          ),
        )
      })
    })
    servers.push(server)
    await listen(server)
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing test port")
    const token = "turn-token-00000000000000000000000000000000"
    const child = startMcpServer(`http://127.0.0.1:${address.port}`, token)
    const rpc = rpcClient(child)

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
        expect.objectContaining({ name: "preview_skill_zip" }),
        expect.objectContaining({
          name: "install_skill",
          description: expect.stringContaining("Call only after the user explicitly confirms that preview"),
        }),
      ]),
    })
    await expect(
      rpc.call(3, "tools/call", {
        _meta: { progressToken: "preview-progress" },
        name: "preview_skill_zip",
        arguments: { workspace_relative_path: "artifacts/my-skill.zip" },
      }),
    ).resolves.toMatchObject({ isError: false })
    await expect(
      rpc.call(4, "tools/call", {
        name: "install_skill",
        arguments: { install_token: installToken },
      }),
    ).resolves.toMatchObject({ isError: false })

    expect(requests).toEqual([
      {
        url: "/preview",
        authorization: `Bearer ${token}`,
        body: { workspaceRelativePath: "artifacts/my-skill.zip" },
      },
      {
        url: "/confirm",
        authorization: `Bearer ${token}`,
        body: { installToken },
      },
    ])
  })

  it("rejects cross-conversation calls without contacting the API", async () => {
    let requestCount = 0
    const server = createServer((_request, response) => {
      requestCount += 1
      response.writeHead(500).end()
    })
    servers.push(server)
    await listen(server)
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing test port")
    const rpc = rpcClient(
      startMcpServer(
        `http://127.0.0.1:${address.port}`,
        "turn-token-00000000000000000000000000000000",
      ),
    )

    await expect(
      rpc.call(1, "tools/call", {
        name: "preview_skill_zip",
        arguments: {
          conversation_id: "01900000-0000-7000-8000-000000000099",
          workspace_relative_path: "artifacts/my-skill.zip",
        },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: "SKILL_CREATOR_FORBIDDEN",
            retryable: false,
          }),
        },
      ],
      isError: true,
    })
    expect(requestCount).toBe(0)
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
      LINKSENSE_SKILL_CREATOR_ENDPOINT: endpoint,
      LINKSENSE_SKILL_CREATOR_TOKEN: token,
      LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:1/current-user",
      LINKSENSE_CURRENT_USER_TOKEN:
        "unused-current-user-token-0000000000000000000000",
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

function previewResult(installToken: string) {
  return {
    success: true,
    install_token: installToken,
    expires_at: "2026-07-27T10:15:00.000Z",
    name: "my-skill",
    description: "A test Skill.",
    manifest: { format: "SKILL.md" },
    declared_capabilities: ["scripts"],
    risk_summary: {
      contains_mcp_server: false,
      contains_scripts: true,
      contains_external_connections: false,
      requires_environment_variables: false,
      requires_credentials: false,
      contains_dependency_download_commands: false,
      declared_environment_keys: [],
      dependency_commands: [],
    },
    skill_content_preview: "# My Skill",
    skill_content_truncated: false,
  }
}

function installResult() {
  return {
    success: true,
    capability_id: "40000000-0000-4000-8000-000000000001",
    name: "my-skill",
    source_type: "local",
    status: "active",
    preference_status: "enabled",
  }
}
