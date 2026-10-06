import jwt from "@fastify/jwt"
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { AppError, errorDetails, normalizeError } from "../src/lib/errors.js"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import { authenticationPlugin } from "../src/plugins/authentication.js"
import { adminSystemRoutes } from "../src/modules/system/routes.js"
import type { AppServices } from "../src/services.js"

const userId = "01900000-0000-7000-8000-000000000099"
const draft = { provider: "openai_compatible", base_url: "https://models.example.test/v1", protocol_mode: "chat_completions_bridge", api_key: "synthetic-key" }
const paths = ["discover", "test-connection"] as const

async function fixture(role: "admin" | "user" = "admin", enabled = true, status = "active") {
  const app = Fastify()
  const user = { id: userId, email: "admin@example.test", name: "Admin", role, status, preferredLocale: "zh-CN", avatarObjectKey: null, authValidAfter: new Date(0) }
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } } as unknown as PrismaClient
  await app.register(jwt, { secret: "test".repeat(8), sign: { expiresIn: "5m" } })
  await app.register(authenticationPlugin, { prisma })
  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error)
    const details = errorDetails(normalized.code, "zh-CN")
    return reply.code(details.status).send({ error_code: normalized.code, message: details.message })
  })
  const discover = vi.fn().mockResolvedValue({ status: "supported", models: [{ id: "test-model", display_name: "Test Model", context_window: null, supports_image_input: null }], truncated: false })
  const testConnection = vi.fn().mockResolvedValue({ status: "success", model_id: "test-model" })
  await app.register(adminSystemRoutes, { prefix: "/api/v1/admin", services: {
    config: { adminModelManagementEnabled: enabled }, modelProviderSettings: { discover, testConnection },
  } as unknown as AppServices })
  const headers = { authorization: `Bearer ${app.jwt.sign({ sub: userId, email: user.email, role, auth_valid_after: user.authValidAfter.toISOString() })}` }
  return { app, headers, discover, testConnection }
}

describe("administrator model provider probes", () => {
  it.each(paths)("requires authentication for %s", async (path) => {
    const { app, discover, testConnection } = await fixture()
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/admin/model-provider-settings/${path}`, payload: { ...draft, ...(path === "test-connection" ? { model_id: "test-model" } : {}) } })
      expect(response.statusCode).toBe(401)
      expect(response.json().error_code).toBe("AUTH_REQUIRED")
      expect(discover).not.toHaveBeenCalled()
      expect(testConnection).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it.each(paths)("denies a non-administrator %s request", async (path) => {
    const { app, headers, discover, testConnection } = await fixture("user")
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/admin/model-provider-settings/${path}`, headers, payload: {} })
      expect(response.statusCode).toBe(403)
      expect(response.json().error_code).toBe("FORBIDDEN")
      expect(discover).not.toHaveBeenCalled()
      expect(testConnection).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it.each(paths)("denies %s when deployment disables model management before parsing the body", async (path) => {
    const { app, headers, discover, testConnection } = await fixture("admin", false)
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/admin/model-provider-settings/${path}`, headers, payload: {} })
      expect(response.statusCode).toBe(403)
      expect(response.json().error_code).toBe("MODEL_MANAGEMENT_DISABLED")
      expect(discover).not.toHaveBeenCalled()
      expect(testConnection).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it("rejects an inactive administrator session", async () => {
    const { app, headers, discover } = await fixture("admin", true, "disabled")
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/model-provider-settings/discover", headers, payload: draft })
      expect(response.statusCode).toBe(401)
      expect(response.json().error_code).toBe("AUTH_SESSION_EXPIRED")
      expect(discover).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it("returns validated discovery and inference results without caching them", async () => {
    const { app, headers, discover, testConnection } = await fixture()
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/model-provider-settings/discover", headers, payload: draft })
      expect(response.statusCode).toBe(200)
      expect(response.headers["cache-control"]).toBe("private, no-store")
      expect(response.json().data).toMatchObject({ status: "supported", models: [{ id: "test-model" }] })
      expect(discover).toHaveBeenCalledWith({ ...draft, provider_project: null, provider_location: null, discovery_protocol: "openai_compatible" })
      const tested = await app.inject({ method: "POST", url: "/api/v1/admin/model-provider-settings/test-connection", headers, payload: { ...draft, model_id: "test-model" } })
      expect(tested.statusCode).toBe(200)
      expect(tested.json().data).toEqual({ status: "success", model_id: "test-model" })
      expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({ kind: "chat", model_id: "test-model" }))
      expect(response.body + tested.body).not.toContain(draft.api_key)
    } finally { await app.close() }
  })

  it("rejects invalid drafts and returns a plain error for failed inference", async () => {
    const { app, headers, discover, testConnection } = await fixture()
    try {
      const invalid = await app.inject({ method: "POST", url: "/api/v1/admin/model-provider-settings/discover", headers, payload: { ...draft, base_url: "file:///secret" } })
      expect(invalid.statusCode).toBe(400)
      expect(discover).not.toHaveBeenCalled()
      testConnection.mockRejectedValue(new AppError("MODEL_PROVIDER_CONNECTION_FAILED"))
      const failed = await app.inject({ method: "POST", url: "/api/v1/admin/model-provider-settings/test-connection", headers, payload: { ...draft, model_id: "test-model" } })
      expect(failed.statusCode).toBe(502)
      expect(failed.json().error_code).toBe("MODEL_PROVIDER_CONNECTION_FAILED")
      expect(failed.body).not.toContain(draft.api_key)
      expect(failed.body).not.toContain(draft.base_url)
    } finally { await app.close() }
  })
})
