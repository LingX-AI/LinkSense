import type { LookupAddress } from "node:dns"
import { EventEmitter } from "node:events"

import { beforeEach, describe, expect, it, vi } from "vitest"

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock("node:http", () => ({ request: requestMock }))
vi.mock("node:https", () => ({ request: requestMock }))

import { fetchPublicHttpResource } from "../src/lib/safe-http-fetch.js"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

type PinnedRequestOptions = {
  agent?: unknown
  lookup?: unknown
}

type FakeIncomingMessage = EventEmitter & {
  statusCode: number
  headers: Record<string, string>
  destroy(error?: Error): void
}

function configureSuccessfulPinnedRequest(): void {
  requestMock.mockImplementation(
    ((
      _url: unknown,
      _options: PinnedRequestOptions,
      callback: (incoming: FakeIncomingMessage) => void,
    ) => {
      const outgoing = new EventEmitter() as EventEmitter & {
        end(): void
        destroy(error?: Error): void
      }
      const incoming = new EventEmitter() as FakeIncomingMessage
      incoming.statusCode = 200
      incoming.headers = { "content-length": String(PNG.byteLength) }
      incoming.destroy = () => undefined
      outgoing.end = () => {
        queueMicrotask(() => {
          callback(incoming)
          incoming.emit("data", PNG)
          incoming.emit("end")
        })
      }
      outgoing.destroy = () => undefined
      return outgoing
    }) as never,
  )
}

describe("fetchPublicHttpResource", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it("disables pooled agents on the pinned request path", async () => {
    configureSuccessfulPinnedRequest()
    const lookup = vi.fn(
      async (): Promise<LookupAddress[]> => [
        { address: "93.184.216.34", family: 4 },
      ],
    ) as unknown as typeof import("node:dns").promises.lookup

    const result = await fetchPublicHttpResource(
      new URL("https://public.example/favicon.ico"),
      {
        byteLimit: 128 * 1024,
        redirectCount: 0,
        requestTimeoutMs: 1_000,
        accept: "image/*",
        userAgent: "LinkSense-test",
        errorCode: "NOT_FOUND",
        allowedProtocols: ["https:"],
        lookup,
      },
    )

    expect(result.bytes).toEqual(PNG)
    expect(requestMock).toHaveBeenCalledTimes(1)
    const options = requestMock.mock.calls[0]?.[1] as PinnedRequestOptions
    expect(options.agent).toBe(false)
    expect(typeof options.lookup).toBe("function")
  })

  it("accepts an explicitly trusted container DNS proxy address for a hostname", async () => {
    configureSuccessfulPinnedRequest()
    const lookup = vi.fn(
      async (): Promise<LookupAddress[]> => [
        { address: "198.18.0.15", family: 4 },
      ],
    ) as unknown as typeof import("node:dns").promises.lookup

    const result = await fetchPublicHttpResource(
      new URL("https://public.example/favicon.ico"),
      {
        byteLimit: 128 * 1024,
        redirectCount: 0,
        requestTimeoutMs: 1_000,
        accept: "image/*",
        userAgent: "LinkSense-test",
        errorCode: "NOT_FOUND",
        allowedProtocols: ["https:"],
        allowBenchmarkProxyAddresses: true,
        lookup,
      },
    )

    expect(result.bytes).toEqual(PNG)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("keeps benchmark addresses blocked unless explicitly trusted and never accepts a literal address", async () => {
    const lookup = vi.fn(
      async (): Promise<LookupAddress[]> => [
        { address: "198.18.0.15", family: 4 },
      ],
    ) as unknown as typeof import("node:dns").promises.lookup
    const options = {
      byteLimit: 128 * 1024,
      redirectCount: 0,
      requestTimeoutMs: 1_000,
      accept: "image/*",
      userAgent: "LinkSense-test",
      errorCode: "NOT_FOUND" as const,
      allowedProtocols: ["https:"] as const,
      lookup,
    }

    await expect(
      fetchPublicHttpResource(
        new URL("https://public.example/favicon.ico"),
        options,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      fetchPublicHttpResource(
        new URL("https://198.18.0.15/favicon.ico"),
        { ...options, allowBenchmarkProxyAddresses: true },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(requestMock).not.toHaveBeenCalled()
  })
})
