import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { AppError, errorDetails, normalizeError } from "../src/lib/errors.js"
import { adminSystemRoutes } from "../src/modules/system/routes.js"
import { internalWebSearchRoutes } from "../src/modules/system/web-search-internal-routes.js"
import type { AppServices } from "../src/services.js"

const ownerId = "10000000-0000-4000-8000-000000000001"
const conversationId = "20000000-0000-4000-8000-000000000001"
const turnId = "30000000-0000-4000-8000-000000000001"
const sharedSecret = "synthetic-runner-secret-that-is-long-enough"
const settings = { enabled: true, provider: "deepseek", base_url: null, search_engine_id: null, default_max_results: 5, timeout_ms: 15_000, revision: 1, api_key_configured: true }
const draft = { ...settings, revision: undefined, api_key_configured: undefined, expected_revision: 1 }

function appFixture() {
  const app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error)
    return reply.code(errorDetails(normalized.code, "zh-CN").status).send({ error_code: normalized.code })
  })
  return app
}

describe("web search endpoints", () => {
  it.each(["AUTH_REQUIRED", "FORBIDDEN"] as const)("denies administrator operations for %s", async (denial) => {
    const app = appFixture()
    const getAdminSettings = vi.fn()
    app.decorate("requireAdmin", async () => { throw new AppError(denial) })
    await app.register(adminSystemRoutes, { prefix: "/admin", services: { webSearchSettings: { getAdminSettings } } as unknown as AppServices })
    for (const method of ["GET", "PUT", "POST"] as const) {
      const response = await app.inject({ method, url: `/admin/web-search-settings${method === "POST" ? "/test-connection" : ""}`, ...(method === "GET" ? {} : { payload: {} }) })
      expect(response.statusCode).toBe(denial === "AUTH_REQUIRED" ? 401 : 403)
    }
    expect(getAdminSettings).not.toHaveBeenCalled()
    await app.close()
  })
  it("protects saved settings, saves validated drafts and tests without writing", async () => {
    const app = appFixture()
    const service = { getAdminSettings: vi.fn().mockResolvedValue(settings), update: vi.fn().mockResolvedValue(settings), testConnection: vi.fn().mockResolvedValue({ success: true, provider: "deepseek", query: "test", results: [] }) }
    app.decorate("requireAdmin", async (request) => { request.authUser = {
      id: ownerId, email: "admin@example.test", name: "Admin", role: "admin", status: "active",
      preferredLocale: null, avatarObjectKey: null, authValidAfter: new Date(0),
    } })
    await app.register(adminSystemRoutes, { prefix: "/admin", services: { webSearchSettings: service } as unknown as AppServices })
    const read = await app.inject({ method: "GET", url: "/admin/web-search-settings" })
    expect(read.headers["cache-control"]).toBe("private, no-store")
    expect(read.json().data).toEqual(settings)
    expect((await app.inject({ method: "PUT", url: "/admin/web-search-settings", payload: draft })).statusCode).toBe(200)
    expect(service.update).toHaveBeenCalledWith(ownerId, expect.objectContaining({ expected_revision: 1 }), expect.any(Object))
    expect((await app.inject({ method: "POST", url: "/admin/web-search-settings/test-connection", payload: { settings: draft, request: { query: "test" } } })).statusCode).toBe(200)
    expect(service.testConnection).toHaveBeenCalledWith(expect.objectContaining({ request: { query: "test" } }), expect.any(AbortSignal))
    expect(service.update).toHaveBeenCalledTimes(1)
    expect((await app.inject({ method: "PUT", url: "/admin/web-search-settings", payload: { ...draft, base_url: "http://localhost/search" } })).statusCode).toBe(400)
    expect(service.update).toHaveBeenCalledTimes(1)
    await app.close()
  })
  it("requires a runner secret, validates owner and task input, and propagates cancellation", async () => {
    const app = appFixture()
    const search = vi.fn().mockResolvedValue({ success: true, provider: "deepseek", query: "test", results: [] })
    await app.register(internalWebSearchRoutes, { prefix: "/internal", service: { search }, sharedSecret })
    const input = { method: "POST" as const, url: "/internal/web-search/search", headers: { authorization: `Bearer ${sharedSecret}`, "x-linksense-owner-id": ownerId }, payload: { conversationId, turnId, request: { query: "test" } } }
    expect((await app.inject({ ...input, headers: {} })).statusCode).toBe(401)
    expect((await app.inject({ ...input, headers: { ...input.headers, "x-linksense-owner-id": "bad" } })).statusCode).toBe(400)
    expect(search).not.toHaveBeenCalled()
    expect((await app.inject(input)).statusCode).toBe(200)
    expect(search).toHaveBeenCalledWith({ ownerId, ...input.payload, signal: expect.any(AbortSignal) })
    await app.close()
  })
})
