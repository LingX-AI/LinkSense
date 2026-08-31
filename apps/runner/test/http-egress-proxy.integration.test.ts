import { createServer, type IncomingHttpHeaders, type Server } from "node:http"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"

import { proxyUserMcpHttpRequest } from "../src/mcp/http-egress-proxy.js"

const nodeServers: Server[] = []
const fastifyServers: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(
    fastifyServers.splice(0).map((server) => server.close())
  )
  await Promise.all(
    nodeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve()))
    )
  )
})

describe("personal MCP HTTP egress proxy integration", () => {
  it("forwards the configured API key and external session id on a real MCP tool call", async () => {
    const capturedHeaders: IncomingHttpHeaders[] = []
    const upstreamUrl = await startStatelessMcpServer(capturedHeaders)
    const proxyUrl = await startProxyServer(upstreamUrl)
    const transport = new StreamableHTTPClientTransport(proxyUrl)
    const client = new Client(
      { name: "linksense-proxy-integration-test", version: "1.0.0" },
      { capabilities: {} }
    )
    const clientTransport = adaptClientTransport(transport)

    try {
      await client.connect(clientTransport)
      const result = await client.callTool({ name: "ping", arguments: {} })

      expect(result.content).toEqual([{ type: "text", text: "pong" }])
      expect(capturedHeaders.length).toBeGreaterThanOrEqual(2)
      expect(
        capturedHeaders.every(
          (headers) =>
            headers["x-api-key"] === "configured-api-key" &&
            headers["x-session-id"] === "business-session-a"
        )
      ).toBe(true)
    } finally {
      await client.close().catch(() => undefined)
    }
  })
})

async function startProxyServer(upstreamUrl: URL): Promise<URL> {
  const app = Fastify()
  fastifyServers.push(app)
  app.post("/mcp", async (request, reply) => {
    await proxyUserMcpHttpRequest(
      {
        url: upstreamUrl.toString(),
        startupTimeoutMs: 5_000,
        toolTimeoutMs: 5_000,
        auth: {
          type: "api_key",
          headerName: "X-API-Key",
          value: "configured-api-key",
        },
        requestHeaders: [
          { name: "X-Session-Id", value: "business-session-a" },
        ],
      },
      request,
      reply
    )
  })
  const address = await app.listen({ host: "127.0.0.1", port: 0 })
  return new URL("/mcp", address)
}

async function startStatelessMcpServer(
  capturedHeaders: IncomingHttpHeaders[]
): Promise<URL> {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.writeHead(405, { "content-type": "application/json" })
      response.end()
      return
    }
    capturedHeaders.push(request.headers)
    const body = await readJsonBody(request)
    const mcp = new McpServer({
      name: "linksense-proxy-upstream",
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
    const serverTransport: Transport = {
      start: async () => {
        transport.onclose = () => serverTransport.onclose?.()
        transport.onerror = (error) => serverTransport.onerror?.(error)
        transport.onmessage = (message) => serverTransport.onmessage?.(message)
        await transport.start()
      },
      send: (message, options) => transport.send(message, options),
      close: () => transport.close(),
    }
    await mcp.connect(serverTransport)
    await transport.handleRequest(request, response, body)
    response.once("close", () => void mcp.close())
  })
  nodeServers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("MCP upstream did not expose a TCP port")
  }
  return new URL(`http://127.0.0.1:${address.port}/mcp`)
}

function adaptClientTransport(
  transport: StreamableHTTPClientTransport
): Transport {
  const adapted: Transport = {
    start: async () => {
      transport.onclose = () => adapted.onclose?.()
      transport.onerror = (error) => adapted.onerror?.(error)
      transport.onmessage = (message) => adapted.onmessage?.(message)
      await transport.start()
    },
    send: (message, options) => transport.send(message, options),
    close: () => transport.close(),
    setProtocolVersion: (version) => transport.setProtocolVersion(version),
  }
  return adapted
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}
