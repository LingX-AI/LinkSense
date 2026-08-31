import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { Agent } from "undici"

import type { McpConnectionProbe } from "./types.js"

export class SdkMcpConnectionProbe implements McpConnectionProbe {
  constructor(
    private readonly createDispatcher: (url: URL) => Promise<Agent> =
      async () => new Agent()
  ) {}

  async probe(
    input: Parameters<McpConnectionProbe["probe"]>[0]
  ): Promise<Awaited<ReturnType<McpConnectionProbe["probe"]>>> {
    const dispatcher = await this.createDispatcher(input.url)
    const headers = new Headers()
    if (input.auth.type === "bearer") {
      headers.set("authorization", `Bearer ${input.auth.value}`)
    } else if (input.auth.type === "api_key") {
      headers.set(input.auth.headerName, input.auth.value)
    }
    const transport = new StreamableHTTPClientTransport(input.url, {
      requestInit: { headers },
      reconnectionOptions: {
        maxReconnectionDelay: 500,
        initialReconnectionDelay: 100,
        reconnectionDelayGrowFactor: 1,
        maxRetries: 0,
      },
      fetch: (url, init) => {
        const options: RequestInit & { dispatcher: Agent } = {
          ...init,
          redirect: "manual",
          dispatcher,
        }
        return fetch(url, options)
      },
    })
    const client = new Client(
      { name: "linksense-mcp-connection-test", version: "1.0.0" },
      { capabilities: {} }
    )
    // SDK 1.29 exposes `sessionId: string | undefined` as a required getter,
    // which conflicts with TypeScript exact optional properties. This small
    // structural adapter also keeps the SDK transport itself fully typed.
    const clientTransport: Transport = {
      start: async () => {
        transport.onclose = () => clientTransport.onclose?.()
        transport.onerror = (error) => clientTransport.onerror?.(error)
        transport.onmessage = (message) => clientTransport.onmessage?.(message)
        await transport.start()
      },
      send: (message, options) => transport.send(message, options),
      close: () => transport.close(),
      setProtocolVersion: (version) => transport.setProtocolVersion(version),
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
    timeout.unref()
    try {
      await client.connect(clientTransport, { signal: controller.signal })
      const tools = await client.listTools(undefined, {
        signal: controller.signal,
      })
      return {
        serverName: client.getServerVersion()?.name ?? input.url.hostname,
        protocolVersion: transport.protocolVersion ?? "unknown",
        toolCount: tools.tools.length,
      }
    } finally {
      clearTimeout(timeout)
      await client.close().catch(() => undefined)
      await dispatcher.close().catch(() => undefined)
    }
  }
}
