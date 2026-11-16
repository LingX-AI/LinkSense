import { afterEach, describe, expect, it, vi } from "vitest"
import { createWebSearchRunner, type WebSearchRuntime } from "../src/adapters/web-search-provider.js"

const runtime: WebSearchRuntime = { provider: "deepseek", endpoint: "https://search.example.test/search", apiKey: "test-key", searchEngineId: "test-engine", defaultMaxResults: 5, timeoutMs: 1_000 }
const source = { title: "Source", url: "https://example.com/source", snippet: "Short excerpt", summary: "Long excerpt", date: "2026-11-13T00:00:00Z" }
afterEach(() => vi.useRealTimers())

describe("web search SDK integration", () => {
  it("adds DeepSeek with its native authentication, count and source fields through SDK webSearch", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [source] }))
    const result = await createWebSearchRunner(transport)(runtime, { query: "test", max_results: 3 })
    const [, init] = transport.mock.calls[0] ?? []
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key")
    expect(JSON.parse(String(init?.body))).toEqual({ query: "test", count: 3, need_content: false })
    expect(result).toEqual({ success: true, provider: "deepseek", query: "test", results: [{ title: "Source", url: source.url, snippet: source.snippet, summary: source.summary, published_at: source.date }] })
  })

  it.each([
    { provider: "tavily", response: { results: [{ title: source.title, url: source.url, content: source.snippet, published_date: source.date }] }, method: "POST", parameter: "max_results" },
    { provider: "exa", response: { results: [{ title: source.title, url: source.url, text: source.snippet, publishedDate: source.date }] }, method: "POST", parameter: "numResults" },
    { provider: "brave", response: { type: "search", web: { results: [{ title: source.title, url: source.url, description: source.snippet, age: source.date }] } }, method: "GET", parameter: "count" },
    { provider: "google", response: { kind: "customsearch#search", items: [{ title: source.title, link: source.url, snippet: source.snippet }] }, method: "GET", parameter: "num" },
    { provider: "serpapi", response: { organic_results: [{ title: source.title, link: source.url, snippet: source.snippet }] }, method: "GET", parameter: "num" },
    { provider: "searxng", response: { results: [{ title: source.title, url: source.url, content: source.snippet }] }, method: "GET", parameter: "count" },
  ] as const)("uses the existing $provider adapter with correct result and count mapping", async ({ provider, response, method, parameter }) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response))
    const result = await createWebSearchRunner(transport)({ ...runtime, provider }, { query: "test", max_results: 3 })
    const [url, init] = transport.mock.calls[0] ?? []
    expect(init?.method).toBe(method)
    if (method === "POST") expect(JSON.parse(String(init?.body))[parameter]).toBe(3)
    else expect(new URL(String(url)).searchParams.get(parameter)).toBe("3")
    if (provider === "exa") expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key")
    if (provider === "tavily") expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key")
    if (provider === "google") expect(new URL(String(url)).searchParams.get("cx")).toBe("test-engine")
    expect(result.results[0]).toMatchObject({ title: source.title, url: source.url, snippet: source.snippet })
  })

  it.each([
    [401, "WEB_SEARCH_AUTH_FAILED"], [403, "WEB_SEARCH_AUTH_FAILED"], [429, "WEB_SEARCH_RATE_LIMITED"],
    [500, "WEB_SEARCH_UNAVAILABLE"], [302, "WEB_SEARCH_UNAVAILABLE"],
  ] as const)("classifies HTTP %s without leaking provider text or retrying", async (status, code) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret-provider-content", { status }))
    await expect(createWebSearchRunner(transport)(runtime, { query: "test" })).rejects.toMatchObject({ code, message: code })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each([{}, { results: null }, { results: [{}] }, { results: [{ ...source, url: "javascript:alert(1)" }] }])("rejects malformed provider responses: %j", async (body) => {
    await expect(createWebSearchRunner(async () => Response.json(body))(runtime, { query: "test" })).rejects.toMatchObject({ code: "WEB_SEARCH_RESPONSE_INVALID" })
  })
  it("keeps an empty successful response and bounds returned content", async () => {
    await expect(createWebSearchRunner(async () => Response.json({ results: [] }))(runtime, { query: "test" })).resolves.toMatchObject({ results: [] })
    const result = await createWebSearchRunner(async () => Response.json({ results: Array.from({ length: 8 }, () => ({ ...source, snippet: "x".repeat(9_000) })) }))(runtime, { query: "test", max_results: 2 })
    expect(result.results).toHaveLength(2)
    expect(result.results[0]?.snippet).toHaveLength(8_000)
  })
  it.each([
    { provider: "google", body: { kind: "customsearch#search" } },
    { provider: "brave", body: { type: "search" } },
    { provider: "serpapi", body: { search_metadata: { status: "Success" } } },
  ] as const)("recognizes $provider empty successes while rejecting missing response envelopes", async ({ provider, body }) => {
    await expect(createWebSearchRunner(async () => Response.json(body))({ ...runtime, provider }, { query: "test" })).resolves.toMatchObject({ results: [] })
    await expect(createWebSearchRunner(async () => Response.json({}))({ ...runtime, provider }, { query: "test" })).rejects.toMatchObject({ code: "WEB_SEARCH_RESPONSE_INVALID" })
  })
  it("bounds upstream response bytes before parsing or returning provider content", async () => {
    const transport: typeof fetch = async () => Response.json({ results: [{ ...source, snippet: "x".repeat(2 * 1024 * 1024) }] })
    await expect(createWebSearchRunner(transport)(runtime, { query: "test" })).rejects.toMatchObject({ code: "WEB_SEARCH_RESPONSE_INVALID" })
  })
  it("propagates cancellation into existing SDK provider requests", async () => {
    const controller = new AbortController()
    const transport = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    }))
    const pending = createWebSearchRunner(transport)({ ...runtime, provider: "tavily" }, { query: "test" }, controller.signal)
    const reason = new Error("test cancellation")
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })
  it("enforces a total request deadline", async () => {
    vi.useFakeTimers()
    const transport: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    })
    const assertion = expect(createWebSearchRunner(transport)(runtime, { query: "test" })).rejects.toMatchObject({ code: "WEB_SEARCH_TIMEOUT" })
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })
})
