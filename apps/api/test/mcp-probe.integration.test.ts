import { createServer, type IncomingHttpHeaders, type Server } from "node:http"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { Agent } from "undici"
import { afterEach, describe, expect, it } from "vitest"

import { SdkMcpConnectionProbe } from "../src/modules/mcp/probe.js"

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve()))
    )
  )
})

describe("SdkMcpConnectionProbe", () => {
  it("performs a real Streamable HTTP initialize and tools/list handshake", async () => {
    const requestHeaders: IncomingHttpHeaders[] = []
    const endpoint = await startStatelessMcpServer(requestHeaders)
    const probe = new SdkMcpConnectionProbe(async () => new Agent())

    await expect(
      probe.probe({
        url: endpoint,
        auth: { type: "bearer", value: "probe-bearer-secret" },
        timeoutMs: 5_000,
      })
    ).resolves.toMatchObject({
      serverName: "linksense-probe-fixture",
      toolCount: 1,
    })
    expect(requestHeaders.length).toBeGreaterThanOrEqual(2)
    expect(
      requestHeaders.every(
        (headers) => headers.authorization === "Bearer probe-bearer-secret"
      )
    ).toBe(true)

    requestHeaders.splice(0)
    await expect(
      probe.probe({
        url: endpoint,
        auth: {
          type: "api_key",
          headerName: "X-Probe-Key",
          value: "probe-api-key",
        },
        timeoutMs: 5_000,
      })
    ).resolves.toMatchObject({ toolCount: 1 })
    expect(
      requestHeaders.every(
        (headers) => headers["x-probe-key"] === "probe-api-key"
      )
    ).toBe(true)
  })
})

async function startStatelessMcpServer(
  requestHeaders: IncomingHttpHeaders[]
): Promise<URL> {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.writeHead(405, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32_000, message: "Method not allowed" },
          id: null,
        })
      )
      return
    }
    requestHeaders.push(request.headers)
    const body = await readJsonBody(request)
    const mcp = new McpServer({
      name: "linksense-probe-fixture",
      version: "1.0.0",
    })
    mcp.registerTool(
      "ping",
      { description: "Returns pong", inputSchema: {} },
      async () => ({ content: [{ type: "text", text: "pong" }] })
    )
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    const mcpTransport: Transport = {
      start: async () => {
        transport.onclose = () => mcpTransport.onclose?.()
        transport.onerror = (error) => mcpTransport.onerror?.(error)
        transport.onmessage = (message) => mcpTransport.onmessage?.(message)
        await transport.start()
      },
      send: (message, options) => transport.send(message, options),
      close: () => transport.close(),
    }
    try {
      await mcp.connect(mcpTransport)
      await transport.handleRequest(request, response, body)
    } finally {
      response.once("close", () => {
        void mcp.close()
      })
    }
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("MCP test server did not expose a TCP port")
  }
  return new URL(`http://127.0.0.1:${address.port}/mcp`)
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}
