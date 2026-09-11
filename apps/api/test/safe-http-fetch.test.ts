import type { LookupAddress } from "node:dns"
import { EventEmitter } from "node:events"
import type { LookupFunction } from "node:net"
import { PassThrough } from "node:stream"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock("node:http", () => ({ request: requestMock }))
vi.mock("node:https", () => ({ request: requestMock }))

import { fetchPublicHttpResource } from "../src/lib/safe-http-fetch.js"
import { SiteIconService } from "../src/modules/site-icons/service.js"
import { ExternalImageService } from "../src/modules/external-images/service.js"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

type PinnedRequestOptions = {
  agent?: unknown
  headers?: Record<string, string>
  lookup?: unknown
}

class FakeIncomingMessage extends PassThrough {
  statusCode = 200
  headers: Record<string, string> = {}
}

function configurePinnedRequest({
  status = 200,
  headers = { "content-length": String(PNG.byteLength) },
  chunks = [PNG],
  end = true,
  responseError,
}: {
  status?: number
  headers?: Record<string, string>
  chunks?: Buffer[]
  end?: boolean
  responseError?: Error
} = {}) {
  const escapedErrors: unknown[] = []
  const incoming = new FakeIncomingMessage()
  incoming.statusCode = status
  incoming.headers = headers
  requestMock.mockImplementation(
    (
      _url: unknown,
      options: PinnedRequestOptions & { signal: AbortSignal },
      callback: (incoming: FakeIncomingMessage) => void,
    ) => {
      const outgoing = new EventEmitter() as EventEmitter & {
        end(): void
        destroy(error?: Error): void
      }
      outgoing.end = () => {
        queueMicrotask(() => {
          // Record exceptions escaping the actual HTTP callback without taking
          // down the test worker. These would be uncaught in production.
          try {
            callback(incoming)
            for (const chunk of chunks) incoming.write(chunk)
            if (responseError) incoming.destroy(responseError)
            else if (end) incoming.end()
          } catch (error) {
            escapedErrors.push(error)
            outgoing.emit("error", error)
          }
        })
      }
      outgoing.destroy = (error) => {
        incoming.destroy(error)
        if (error) outgoing.emit("error", error)
      }
      options.signal.addEventListener("abort", () => {
        outgoing.destroy(new Error("request aborted"))
      }, { once: true })
      return outgoing
    },
  )
  return { incoming, escapedErrors }
}

function fetchResource(overrides: Partial<Parameters<typeof fetchPublicHttpResource>[1]> = {}) {
  return fetchPublicHttpResource(new URL("https://public.example/favicon.ico"), {
    byteLimit: 128 * 1024,
    redirectCount: 0,
    requestTimeoutMs: 1_000,
    accept: "image/*",
    userAgent: "LinkSense-test",
    errorCode: "NOT_FOUND",
    lookup: vi.fn(async (): Promise<LookupAddress[]> => [
      { address: "93.184.216.34", family: 4 },
    ]) as unknown as typeof import("node:dns").promises.lookup,
    ...overrides,
  })
}

describe("fetchPublicHttpResource", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it.each([204, 205, 304])("isolates a bodyless %i response and allows the next download", async (status) => {
    const { escapedErrors, incoming } = configurePinnedRequest({ status, headers: {}, chunks: [] })
    await expect(fetchResource()).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(escapedErrors).toEqual([])
    expect(incoming.destroyed).toBe(true)
    configurePinnedRequest()
    await expect(fetchResource()).resolves.toMatchObject({ bytes: PNG })
  })

  it.each([
    { status: 600, headers: {} },
    { status: 200, headers: { "invalid header": "value" } },
  ])("contains invalid upstream response metadata: %j", async (response) => {
    const { escapedErrors, incoming } = configurePinnedRequest(response)
    await expect(fetchResource()).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(escapedErrors).toEqual([])
    expect(incoming.destroyed).toBe(true)
  })

  it("handles an oversized declared body before reading the stream", async () => {
    const { incoming } = configurePinnedRequest({ headers: { "content-length": "999999" } })
    await expect(fetchResource()).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(incoming.destroyed).toBe(true)
  })

  it("bounds streamed bytes even when the content length is missing", async () => {
    const { incoming } = configurePinnedRequest({ headers: {}, chunks: [PNG, PNG] })
    await expect(fetchResource({ byteLimit: PNG.byteLength })).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(incoming.destroyed).toBe(true)
  })

  it("accepts a body exactly at the limit", async () => {
    configurePinnedRequest()
    await expect(fetchResource({ byteLimit: PNG.byteLength })).resolves.toMatchObject({ bytes: PNG })
  })

  it("forwards controlled authentication headers through the pinned transport", async () => {
    configurePinnedRequest()

    await fetchResource({ headers: { authorization: "Bearer test-secret" } })

    const options = requestMock.mock.calls[0]?.[1] as
      | PinnedRequestOptions
      | undefined
    expect(options?.headers).toMatchObject({
      accept: "image/*",
      "accept-encoding": "identity",
      authorization: "Bearer test-secret",
      "user-agent": "LinkSense-test",
    })
  })

  it("pins the validated DNS result into the request transport", async () => {
    configurePinnedRequest()
    const lookup = vi.fn(async (): Promise<LookupAddress[]> => [
      { address: "93.184.216.34", family: 4 },
    ]) as unknown as typeof import("node:dns").promises.lookup

    await fetchResource({ lookup })

    const options = requestMock.mock.calls[0]?.[1] as
      | PinnedRequestOptions
      | undefined
    const pinnedLookup = options?.lookup as LookupFunction | undefined
    expect(pinnedLookup).toBeTypeOf("function")
    await new Promise<void>((resolve, reject) => {
      pinnedLookup?.(
        "public.example",
        { all: true },
        (error, addresses) => {
          if (error) reject(error)
          else {
            expect(addresses).toEqual([
              { address: "93.184.216.34", family: 4 },
            ])
            resolve()
          }
        }
      )
    })
  })

  it("rejects mixed public and private DNS answers before opening a socket", async () => {
    const lookup = vi.fn(async (): Promise<LookupAddress[]> => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]) as unknown as typeof import("node:dns").promises.lookup

    await expect(fetchResource({ lookup })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
    expect(requestMock).not.toHaveBeenCalled()
  })

  it("applies timeout and caller cancellation while DNS is pending", async () => {
    vi.useFakeTimers()
    const lookup = vi.fn(
      () => new Promise<LookupAddress[]>(() => undefined)
    ) as unknown as typeof import("node:dns").promises.lookup
    const timedOut = expect(
      fetchResource({ lookup, requestTimeoutMs: 1_000 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })

    await vi.advanceTimersByTimeAsync(1_000)
    await timedOut

    const controller = new AbortController()
    const cancelled = expect(
      fetchResource({ lookup, signal: controller.signal })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    controller.abort()
    await cancelled
    expect(requestMock).not.toHaveBeenCalled()
  })

  it("rejects a response stream error without leaving a pending request", async () => {
    configurePinnedRequest({ responseError: new Error("upstream reset") })
    await expect(fetchResource()).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("rejects a premature close without an error event", async () => {
    const { incoming } = configurePinnedRequest({ end: false })
    const checked = expect(fetchResource()).rejects.toMatchObject({ code: "NOT_FOUND" })
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledOnce())
    incoming.destroy()
    await checked
  })

  it("aborts a stalled body at the deadline", async () => {
    vi.useFakeTimers()
    const { incoming } = configurePinnedRequest({ end: false })
    const checked = expect(fetchResource()).rejects.toMatchObject({ code: "NOT_FOUND" })
    await vi.advanceTimersByTimeAsync(1_000)
    await checked
    expect(incoming.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("accepts caller cancellation for an in-flight request", async () => {
    const controller = new AbortController()
    const { incoming } = configurePinnedRequest({ end: false })
    const checked = expect(
      fetchResource({ signal: controller.signal })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledOnce())

    controller.abort()

    await checked
    expect(incoming.destroyed).toBe(true)
  })

  it("revalidates redirect destinations and never requests a private address", async () => {
    const { incoming } = configurePinnedRequest({ status: 302, headers: { location: "https://private.example/file" } })
    const lookup = vi.fn(async (hostname: string): Promise<LookupAddress[]> => [
      { address: hostname === "public.example" ? "93.184.216.34" : "127.0.0.1", family: 4 },
    ]) as unknown as typeof import("node:dns").promises.lookup
    await expect(fetchResource({ redirectCount: 1, lookup })).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(requestMock).toHaveBeenCalledOnce()
    expect(incoming.destroyed).toBe(true)
  })

  it.each([302, 404])("cancels an unused fetcher body for status %i", async (status) => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { status })
    await expect(fetchResource({ fetcher: async () => response })).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("continues favicon discovery after a native 204 and preserves subsequent downloads", async () => {
    configurePinnedRequest({ status: 204, headers: {}, chunks: [] })
    const noContentResponse = requestMock.getMockImplementation()
    if (!noContentResponse) throw new Error("missing request fixture")
    configurePinnedRequest()
    requestMock.mockImplementationOnce(noContentResponse)
    const cache = { getSiteIconCache: vi.fn(async () => null), setSiteIconCache: vi.fn(async () => undefined) }
    const service = new SiteIconService(cache, {
      lookup: vi.fn(async (): Promise<LookupAddress[]> => [
        { address: "93.184.216.34", family: 4 },
      ]) as unknown as typeof import("node:dns").promises.lookup,
    })
    await expect(service.get("https://public.example")).resolves.toMatchObject({ data: PNG })
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(cache.setSiteIconCache).toHaveBeenCalledOnce()
  })

  it("maps an external image's native 204 to its existing business error", async () => {
    configurePinnedRequest({ status: 204, headers: {}, chunks: [] })
    const service = new ExternalImageService({
      lookup: vi.fn(async (): Promise<LookupAddress[]> => [
        { address: "93.184.216.34", family: 4 },
      ]) as unknown as typeof import("node:dns").promises.lookup,
    })
    await expect(service.download("https://public.example/image.png"))
      .rejects.toMatchObject({ code: "EXTERNAL_IMAGE_DOWNLOAD_FAILED" })
    configurePinnedRequest()
    await expect(service.download("https://public.example/image.png"))
      .resolves.toMatchObject({ data: PNG })
  })

  it("disables pooled agents on the pinned request path", async () => {
    configurePinnedRequest()
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
    configurePinnedRequest()
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
