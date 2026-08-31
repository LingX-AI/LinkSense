import { EventEmitter } from "node:events"
import type { FastifyReply, FastifyRequest } from "fastify"
import { PassThrough } from "node:stream"

import { beforeEach, describe, expect, it, vi } from "vitest"

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}))

vi.mock("node:http", () => ({ request: requestMock }))
vi.mock("node:https", () => ({ request: requestMock }))

import { proxyUserMcpHttpRequest } from "../src/mcp/http-egress-proxy.js"

describe("personal MCP HTTP egress proxy", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it("injects external auth, strips ambient headers, and applies startup timeout", async () => {
    const outbound = configureResponse(200, {
      "content-type": "application/json",
      "mcp-session-id": "session-1",
    })
    const request = fakeRequest({ method: "initialize", params: {} })
    const reply = fakeReply()

    await proxyUserMcpHttpRequest(
      {
        url: "http://mcp.example.test:8080/mcp",
        startupTimeoutMs: 5_000,
        toolTimeoutMs: 60_000,
        auth: { type: "bearer", value: "external-secret" },
      },
      request,
      reply
    )

    const options = requestMock.mock.calls[0]?.[1]
    expect(options).toMatchObject({
      method: "POST",
      agent: false,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "mcp-session-id": "client-session",
        authorization: "Bearer external-secret",
      },
    })
    expect(options.headers).not.toHaveProperty("cookie")
    expect(options).not.toHaveProperty("lookup")
    expect(outbound.setTimeout).toHaveBeenCalledWith(
      5_000,
      expect.any(Function)
    )
    expect(reply.hijack).toHaveBeenCalledOnce()
    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "content-type": "application/json",
      "mcp-session-id": "session-1",
    })
  })

  it("uses the tool timeout for non-initialize requests and injects API Key headers", async () => {
    const outbound = configureResponse(200, {
      "content-type": "application/json",
    })

    await proxyUserMcpHttpRequest(
      {
        url: "https://mcp.example.test/mcp",
        startupTimeoutMs: 5_000,
        toolTimeoutMs: 45_000,
        auth: {
          type: "api_key",
          headerName: "X-API-Key",
          value: "external-api-key",
        },
        requestHeaders: [
          { name: "X-Session-Id", value: "business-session-a" },
        ],
      },
      fakeRequest({ method: "tools/call", params: { name: "search" } }),
      fakeReply()
    )

    expect(requestMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-API-Key": "external-api-key",
      "X-Session-Id": "business-session-a",
    })
    expect(outbound.setTimeout).toHaveBeenCalledWith(
      45_000,
      expect.any(Function)
    )
  })

  it("omits optional external session headers and rejects collisions with primary auth", async () => {
    configureResponse(200, { "content-type": "application/json" })
    await proxyUserMcpHttpRequest(
      target(),
      fakeRequest({ method: "tools/list" }),
      fakeReply()
    )
    expect(requestMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "X-Session-Id"
    )

    requestMock.mockReset()
    await expect(
      proxyUserMcpHttpRequest(
        {
          ...target(),
          auth: {
            type: "api_key",
            headerName: "x-session-id",
            value: "api-key",
          },
          requestHeaders: [
            { name: "X-Session-Id", value: "business-session" },
          ],
        },
        fakeRequest({ method: "tools/list" }),
        fakeReply()
      )
    ).rejects.toEqual(
      expect.objectContaining({ code: "DESTINATION_FORBIDDEN" })
    )
    expect(requestMock).not.toHaveBeenCalled()
  })

  it("allows private targets and still rejects upstream redirects", async () => {
    configureResponse(200, { "content-type": "application/json" })
    await proxyUserMcpHttpRequest(
      { ...target(), url: "http://127.0.0.1:8080/mcp" },
      fakeRequest({ method: "initialize" }),
      fakeReply()
    )
    expect(requestMock).toHaveBeenCalledOnce()

    requestMock.mockReset()
    configureResponse(302, { location: "http://127.0.0.1/mcp" })
    await expect(
      proxyUserMcpHttpRequest(
        target(),
        fakeRequest({ method: "initialize" }),
        fakeReply()
      )
    ).rejects.toEqual(
      expect.objectContaining({
        code: "DESTINATION_FORBIDDEN",
      })
    )
  })

  it("fails closed when an upstream response is aborted", async () => {
    configureAbortedResponse()

    await expect(
      proxyUserMcpHttpRequest(
        target(),
        fakeRequest({ method: "tools/list" }),
        fakeReply()
      )
    ).rejects.toEqual(
      expect.objectContaining({
        code: "UPSTREAM_UNAVAILABLE",
      })
    )
  })
})

function target() {
  return {
    url: "https://mcp.example.test/mcp",
    startupTimeoutMs: 5_000,
    toolTimeoutMs: 60_000,
    auth: { type: "none" as const },
  }
}

function fakeRequest(body: unknown): FastifyRequest {
  const raw = new EventEmitter()
  return {
    method: "POST",
    body,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "mcp-session-id": "client-session",
      authorization: "Bearer attacker-controlled",
      cookie: "must-not-forward",
    },
    raw,
  } as unknown as FastifyRequest
}

function fakeReply(): FastifyReply & {
  hijack: ReturnType<typeof vi.fn>
  raw: PassThrough & { writeHead: ReturnType<typeof vi.fn> }
} {
  const raw = new PassThrough() as PassThrough & {
    writeHead: ReturnType<typeof vi.fn>
  }
  raw.writeHead = vi.fn()
  raw.resume()
  return {
    hijack: vi.fn(),
    raw,
  } as unknown as FastifyReply & {
    hijack: ReturnType<typeof vi.fn>
    raw: PassThrough & { writeHead: ReturnType<typeof vi.fn> }
  }
}

function configureResponse(
  statusCode: number,
  headers: Record<string, string>
) {
  const setTimeout = vi.fn()
  requestMock.mockImplementation(
    (
      _url: URL,
      _options: unknown,
      callback: (incoming: PassThrough & { statusCode: number }) => void
    ) => {
      const outgoing = new EventEmitter() as EventEmitter & {
        write(value: Buffer): void
        end(): void
        destroy(error?: Error): void
        setTimeout(timeout: number, callback: () => void): void
      }
      outgoing.write = () => undefined
      outgoing.destroy = () => undefined
      outgoing.setTimeout = (timeout, callback) => {
        setTimeout(timeout, callback)
      }
      outgoing.end = () => {
        queueMicrotask(() => {
          const incoming = new PassThrough() as PassThrough & {
            statusCode: number
            headers: Record<string, string>
          }
          incoming.statusCode = statusCode
          incoming.headers = headers
          callback(incoming)
          incoming.end(JSON.stringify({ jsonrpc: "2.0", result: {} }))
        })
      }
      return outgoing
    }
  )
  return { setTimeout }
}

function configureAbortedResponse() {
  requestMock.mockImplementation(
    (
      _url: URL,
      _options: unknown,
      callback: (incoming: PassThrough & { statusCode: number }) => void
    ) => {
      const outgoing = new EventEmitter() as EventEmitter & {
        write(value: Buffer): void
        end(): void
        destroy(error?: Error): void
        setTimeout(timeout: number, callback: () => void): void
      }
      outgoing.write = () => undefined
      outgoing.destroy = () => undefined
      outgoing.setTimeout = () => undefined
      outgoing.end = () => {
        queueMicrotask(() => {
          const incoming = new PassThrough() as PassThrough & {
            statusCode: number
            headers: Record<string, string>
          }
          incoming.statusCode = 200
          incoming.headers = { "content-type": "application/json" }
          callback(incoming)
          incoming.emit("aborted")
        })
      }
      return outgoing
    }
  )
}
