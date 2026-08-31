import type { LookupAddress } from "node:dns"

import { describe, expect, it, vi } from "vitest"

import { SiteIconService } from "../src/modules/site-icons/service.js"

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

class InMemoryIconCache {
  readonly entries = new Map<string, { value: Buffer; ttlSeconds: number }>()

  async setSiteIconCache(
    key: string,
    value: Buffer,
    ttlSeconds: number,
  ): Promise<void> {
    this.entries.set(key, { value: Buffer.from(value), ttlSeconds })
  }

  async getSiteIconCache(key: string): Promise<Buffer | null> {
    const entry = this.entries.get(key)
    return entry ? Buffer.from(entry.value) : null
  }
}

function publicLookup() {
  return vi.fn(
    async (): Promise<LookupAddress[]> => [
      { address: "93.184.216.34", family: 4 },
    ],
  ) as unknown as typeof import("node:dns").promises.lookup
}

describe("SiteIconService", () => {
  it("downloads a verified HTTPS favicon once and reuses its normalized-origin cache", async () => {
    const cache = new InMemoryIconCache()
    const fetcherMock = vi.fn(async () =>
      new Response(ONE_PIXEL_PNG, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    )
    const fetcher = fetcherMock as unknown as typeof fetch
    const service = new SiteIconService(cache, {
      fetcher,
      lookup: publicLookup(),
    })

    const first = await service.get("https://example.com/docs?secret=redacted")
    const second = await service.get("https://example.com/another-page")

    expect(first).toMatchObject({
      data: ONE_PIXEL_PNG,
      mimeType: "image/png",
      sizeBytes: ONE_PIXEL_PNG.byteLength,
    })
    expect(second).toEqual(first)
    expect(fetcherMock).toHaveBeenCalledTimes(1)
    const fetchCalls = fetcherMock.mock.calls as unknown as Array<
      [RequestInfo | URL]
    >
    expect(fetchCalls[0]?.[0]).toEqual(
      new URL("https://example.com/favicon.ico"),
    )
    expect([...cache.entries.keys()]).toHaveLength(1)
    expect([...cache.entries.keys()].join(" ")).not.toContain("example.com")
    expect([...cache.entries.keys()].join(" ")).not.toContain("secret")
    expect([...cache.entries.values()][0]?.ttlSeconds).toBe(7 * 24 * 60 * 60)
  })

  it("tries common static image paths when favicon.ico is unavailable", async () => {
    const cache = new InMemoryIconCache()
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString())
      if (url.pathname === "/favicon.ico") {
        return new Response(null, { status: 404 })
      }
      if (url.pathname === "/favicon.png") {
        return new Response(ONE_PIXEL_PNG, {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      }
      return new Response(null, { status: 404 })
    })
    const service = new SiteIconService(cache, {
      fetcher: fetcherMock as unknown as typeof fetch,
      lookup: publicLookup(),
    })

    await expect(service.get("https://example.com/docs")).resolves.toMatchObject({
      data: ONE_PIXEL_PNG,
      mimeType: "image/png",
    })
    expect(
      (fetcherMock.mock.calls as unknown as Array<[RequestInfo | URL]>).map(
        ([input]) => new URL(input.toString()).href,
      ),
    ).toEqual([
      "https://example.com/favicon.ico",
      "https://example.com/favicon.png",
    ])
  })

  it("never downloads the full HTML page or accepts non-image bytes", async () => {
    const cache = new InMemoryIconCache()
    const fetcherMock = vi.fn(async () =>
      new Response(Buffer.from("<html>not an image</html>"), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    )
    const service = new SiteIconService(cache, {
      fetcher: fetcherMock as unknown as typeof fetch,
      lookup: publicLookup(),
    })

    await expect(service.get("https://example.com")).resolves.toBeNull()
    const requestedPaths = (
      fetcherMock.mock.calls as unknown as Array<[RequestInfo | URL]>
    ).map(([input]) => new URL(input.toString()).pathname)
    expect(requestedPaths).toEqual([
      "/favicon.ico",
      "/favicon.png",
      "/favicon.webp",
      "/favicon.jpg",
      "/favicon.jpeg",
      "/favicon.gif",
      "/favicon-16x16.png",
      "/favicon-32x32.png",
      "/favicon-48x48.png",
      "/favicon-96x96.png",
      "/favicon-180x180.png",
      "/favicon-192x192.png",
      "/favicon-512x512.png",
      "/icon.png",
      "/icon-192.png",
      "/icon-512.png",
      "/logo192.png",
      "/logo512.png",
      "/apple-touch-icon.png",
      "/apple-touch-icon-precomposed.png",
      "/apple-touch-icon-180x180.png",
      "/android-chrome-192x192.png",
      "/android-chrome-512x512.png",
      "/mstile-150x150.png",
      "/assets/favicon.ico",
      "/assets/favicon.png",
      "/images/favicon.ico",
      "/images/favicon.png",
      "/img/favicon.ico",
      "/img/favicon.png",
      "/static/favicon.png",
      "/icons/favicon.png",
    ])
    expect(requestedPaths).not.toContain("/")
    expect(cache.entries).toHaveLength(0)
  })

  it("finds a safe icon in a common static asset directory", async () => {
    const cache = new InMemoryIconCache()
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString())
      if (url.pathname === "/icons/favicon.png") {
        return new Response(ONE_PIXEL_PNG, {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      }
      return new Response(null, { status: 404 })
    })
    const service = new SiteIconService(cache, {
      fetcher: fetcherMock as unknown as typeof fetch,
      lookup: publicLookup(),
    })

    await expect(service.get("https://example.com")).resolves.toMatchObject({
      data: ONE_PIXEL_PNG,
      mimeType: "image/png",
    })
    expect(fetcherMock).toHaveBeenCalledTimes(32)
  })

  it("does not make network requests for unsupported or private origins", async () => {
    const cache = new InMemoryIconCache()
    const fetcherMock = vi.fn(async () => undefined)
    const fetcher = fetcherMock as unknown as typeof fetch
    const privateLookup = vi.fn(
      async (): Promise<LookupAddress[]> => [
        { address: "127.0.0.1", family: 4 },
      ],
    ) as unknown as typeof import("node:dns").promises.lookup
    const service = new SiteIconService(cache, {
      fetcher,
      lookup: privateLookup,
    })

    await expect(service.get("http://example.com")).resolves.toBeNull()
    await expect(
      service.get("https://user:password@example.com"),
    ).resolves.toBeNull()
    await expect(service.get("https://private.example")).resolves.toBeNull()

    expect(privateLookup).toHaveBeenCalledTimes(32)
    expect(fetcherMock).not.toHaveBeenCalled()
    expect(cache.entries).toHaveLength(0)
  })

  it("revalidates redirect targets before fetching a favicon", async () => {
    const cache = new InMemoryIconCache()
    const fetcherMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/private-icon.ico" },
      }),
    )
    const fetcher = fetcherMock as unknown as typeof fetch
    const lookup = vi.fn(
      async (hostname: string): Promise<LookupAddress[]> =>
        hostname === "public.example"
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }],
    ) as unknown as typeof import("node:dns").promises.lookup
    const service = new SiteIconService(cache, { fetcher, lookup })

    await expect(service.get("https://public.example")).resolves.toBeNull()

    expect(fetcherMock).toHaveBeenCalledTimes(32)
    expect(lookup).toHaveBeenCalledTimes(64)
    expect(cache.entries).toHaveLength(0)
  })

  it("never caches bytes that are not a structurally valid raster image", async () => {
    const cache = new InMemoryIconCache()
    const fetcherMock = vi.fn(async () =>
      new Response(Buffer.from("not an icon"), { status: 200 }),
    )
    const fetcher = fetcherMock as unknown as typeof fetch
    const service = new SiteIconService(cache, {
      fetcher,
      lookup: publicLookup(),
    })

    await expect(service.get("https://example.com")).resolves.toBeNull()

    expect(fetcherMock).toHaveBeenCalledTimes(32)
    expect(cache.entries).toHaveLength(0)
  })
})
