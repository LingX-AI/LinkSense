import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { webSearchCoreMcpModule } from "../src/mcp/core-services/web-search-service.js"
import { parseRunnerConfig } from "../src/config.js"
import type { AppServerProcessPool } from "../src/process-pool.js"
import { buildRunnerServer } from "../src/server.js"
import { WorkspaceManager } from "../src/workspace/workspace-manager.js"
import { WebSearchRequestError, webSearchErrorFromApi } from "../src/web-search-error.js"

const token = "synthetic-search-task-token-000000000000000000000"
const environment = { LINKSENSE_WEB_SEARCH_ENDPOINT: "https://internal.example.test/search", LINKSENSE_WEB_SEARCH_TOKEN: token }
const result = { success: true, provider: "deepseek", query: "test", results: [] }
afterEach(() => vi.restoreAllMocks())

describe("web search Core MCP module", () => {
  it("registers a read-only tool in Default and Plan and sends no administrator credentials", async () => {
    expect(webSearchCoreMcpModule.modes).toEqual(["default", "plan"])
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result))
    const module = webSearchCoreMcpModule.create({ environment, workspaceRoot: "/tmp/test", fetch: request })
    expect(module.tools[0]).toMatchObject({ name: "search_web", annotations: { readOnlyHint: true, openWorldHint: true } })
    expect(await module.callTool({ toolName: "search_web", argumentsValue: { query: "test", max_results: 3 }, signal: new AbortController().signal })).toMatchObject({ isError: false, content: [{ text: JSON.stringify(result) }] })
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ query: "test", max_results: 3 })
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(`Bearer ${token}`)
  })
  it("rejects caller-supplied endpoints and keys before making an HTTP request", async () => {
    const request = vi.fn<typeof fetch>()
    const module = webSearchCoreMcpModule.create({ environment, workspaceRoot: "/tmp/test", fetch: request })
    for (const argumentsValue of [{ query: "test", api_key: "key" }, { query: "test", base_url: "https://example.com" }, { query: " " }]) {
      expect(await module.callTool({ toolName: "search_web", argumentsValue, signal: new AbortController().signal })).toMatchObject({ isError: true, content: [{ text: JSON.stringify({ code: "WEB_SEARCH_INVALID", retryable: false }) }] })
    }
    expect(request).not.toHaveBeenCalled()
  })
  it.each(["WEB_SEARCH_DISABLED", "WEB_SEARCH_AUTH_FAILED", "WEB_SEARCH_RATE_LIMITED"])("preserves a structured %s failure without replaying the search", async (code) => {
    const failure = { code, retryable: code === "WEB_SEARCH_RATE_LIMITED" }
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(failure, { status: 503 }))
    const module = webSearchCoreMcpModule.create({ environment, workspaceRoot: "/tmp/test", fetch: request })
    expect(await module.callTool({ toolName: "search_web", argumentsValue: { query: "test" }, signal: new AbortController().signal })).toMatchObject({ isError: true, content: [{ text: JSON.stringify(failure) }] })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it("propagates tool cancellation to the underlying request", async () => {
    const request: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }) })
    const controller = new AbortController()
    const module = webSearchCoreMcpModule.create({ environment, workspaceRoot: "/tmp/test", fetch: request })
    const pending = module.callTool({ toolName: "search_web", argumentsValue: { query: "test" }, signal: controller.signal })
    const reason = new Error("test cancellation")
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })
  it("does not send a search that was cancelled before the tool started", async () => {
    const request = vi.fn<typeof fetch>()
    const controller = new AbortController()
    const reason = new Error("test cancellation")
    controller.abort(reason)
    const module = webSearchCoreMcpModule.create({ environment, workspaceRoot: "/tmp/test", fetch: request })
    await expect(module.callTool({ toolName: "search_web", argumentsValue: { query: "test" }, signal: controller.signal })).rejects.toBe(reason)
    expect(request).not.toHaveBeenCalled()
  })
})

describe("web search worker boundary", () => {
  it("validates task requests, delegates scoped authorization, and preserves errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-search-route-"))
    const searchWeb = vi.fn<AppServerProcessPool["searchWeb"]>().mockResolvedValue(result)
    const server = buildRunnerServer(parseRunnerConfig({ LINKSENSE_USER_DATA_ROOT: root, LINKSENSE_RUNNER_SHARED_SECRET: "synthetic-runner-secret-00000000000000000000", LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000/internal" }), { searchWeb } as unknown as AppServerProcessPool, new WorkspaceManager(root))
    try {
      const conversationId = "01900000-0000-7000-8000-000000000001"
      const input = { method: "POST" as const, url: `/mcp-web-search/${conversationId}/search`, headers: { authorization: `Bearer ${token}` }, payload: { query: "test" } }
      expect((await server.inject({ ...input, headers: {} })).statusCode).toBe(401)
      expect((await server.inject({ ...input, payload: { query: "test", api_key: "key" } })).statusCode).toBe(400)
      expect(searchWeb).not.toHaveBeenCalled()
      expect((await server.inject(input)).json()).toEqual(result)
      expect(searchWeb).toHaveBeenCalledWith(conversationId, token, input.payload, expect.any(AbortSignal))
      searchWeb.mockRejectedValue(new WebSearchRequestError("WEB_SEARCH_DISABLED"))
      expect((await server.inject(input)).json()).toEqual({ code: "WEB_SEARCH_DISABLED", retryable: false })
      expect(webSearchErrorFromApi({ error_code: "FORBIDDEN" }).code).toBe("WEB_SEARCH_FORBIDDEN")
      expect(webSearchErrorFromApi({ error_code: "untrusted-provider-text" }).message).toBe("WEB_SEARCH_UNAVAILABLE")
    } finally {
      await server.close(); await rm(root, { recursive: true, force: true })
    }
  })
})
