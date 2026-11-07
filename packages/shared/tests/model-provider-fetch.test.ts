import { describe, expect, it, vi } from "vitest"

import { createModelProviderFetch } from "../src/model-provider-fetch.js"

describe("model provider endpoint adaptation", () => {
  it.each([
    ["https://models.example.test", "https://models.example.test/v1"],
    ["https://models.example.test/v1/", "https://models.example.test"],
    ["https://models.example.test/proxy", "https://models.example.test/proxy/v1"],
    ["https://models.example.test/proxy/v1", "https://models.example.test/proxy"],
  ])("adapts %s once while preserving its proxy prefix", async (baseUrl, alternateBaseUrl) => {
    const missing = new Response("not found", { status: 404 })
    const success = Response.json({ ok: true })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(missing).mockResolvedValueOnce(success)
    const init = {
      method: "POST", body: JSON.stringify({ model: "test-model" }),
      headers: { authorization: "Bearer synthetic-key" },
      signal: new AbortController().signal, redirect: "manual" as const,
    }
    const url = new URL(`${baseUrl.replace(/\/+$/u, "")}/chat/completions?trace=1`)

    expect(await createModelProviderFetch(baseUrl, fetcher)(url, init)).toBe(success)
    expect(fetcher.mock.calls).toEqual([
      [url, init], [new URL(`${alternateBaseUrl}/chat/completions?trace=1`), init],
    ])
    expect(missing.bodyUsed).toBe(true)
  })

  it.each(["/v1", "", "/api/v2", "/v1beta/openai"])("keeps a working %s endpoint unchanged", async (path) => {
    const success = Response.json({ ok: true })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(success)
    expect(await createModelProviderFetch(`https://models.example.test${path}`, fetcher)(`https://models.example.test${path}/models`)).toBe(success)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([400, 401, 403, 408, 429, 500, 503, 302])("does not change paths on HTTP %i", async (status) => {
    const response = new Response(null, { status })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
    expect(await createModelProviderFetch("https://models.example.test", fetcher)("https://models.example.test/responses")).toBe(response)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([404, 405])("stops after both paths return HTTP %i", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status }))
    expect((await createModelProviderFetch("https://models.example.test/v1", fetcher)("https://models.example.test/v1/responses")).status).toBe(status)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(["https://other.example.test/v1/models", "https://models.example.test/outside/models"])("does not expand the credential scope for %s", async (url) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }))
    await createModelProviderFetch("https://models.example.test/proxy/v1", fetcher)(url)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("does not replay network failures or cancelled requests", async () => {
    const failure = new Error("synthetic network failure")
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure)
    const request = createModelProviderFetch("https://models.example.test", fetcher)
    await expect(request("https://models.example.test/models")).rejects.toBe(failure)
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockClear()
    await expect(request("https://models.example.test/models", { signal: AbortSignal.abort(failure) })).rejects.toBe(failure)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("honors cancellation between the original and alternate paths", async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort()
      return new Response(null, { status: 404 })
    })
    await expect(createModelProviderFetch("https://models.example.test", fetcher)("https://models.example.test/models", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("does not wait for an unresponsive missing-endpoint body to cancel", async () => {
    const success = Response.json({ ok: true })
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: () => new Promise<void>(() => undefined) }), { status: 404 }))
      .mockResolvedValueOnce(success)

    expect(await createModelProviderFetch("https://models.example.test", fetcher)("https://models.example.test/models")).toBe(success)
  })

  it("does not replay stream-backed requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 404 }))
    const request = createModelProviderFetch("https://models.example.test", fetcher)
    await request(new Request("https://models.example.test/responses", { method: "POST", body: "{}" }))
    await request("https://models.example.test/responses", { method: "POST", body: new ReadableStream() })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
