import multipart from "@fastify/multipart"
import Fastify, { type FastifyRequest } from "fastify"
import { describe, expect, it, vi } from "vitest"

import { AppError, errorDetails, normalizeError } from "../src/lib/errors.js"
import { adminSystemRoutes, systemRoutes } from "../src/modules/system/routes.js"
import type { AppServices } from "../src/services.js"

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
)

describe("system routes", () => {
  it.each(["ready", "unready"] as const)("returns the %s readiness result without full diagnostics", async (state) => {
    const readiness = vi.fn().mockResolvedValue({
      status: state === "ready" ? "available" : "unavailable",
      readiness: state,
      checked_at: "2026-09-06T00:00:00.000Z",
    })
    const health = vi.fn()
    const app = Fastify()
    await app.register(systemRoutes, {
      prefix: "/api/v1/system",
      services: { system: { readiness, health } } as unknown as AppServices,
    })
    const response = await app.inject({ method: "GET", url: "/api/v1/system/health/ready" })
    expect(response.statusCode).toBe(state === "ready" ? 200 : 503)
    expect(response.json().data.readiness).toBe(state)
    expect(health).not.toHaveBeenCalled()
    await app.close()
  })
  it("suppresses info request logs for readiness probes", async () => {
    const logLines: string[] = []
    const app = Fastify({
      logger: {
        level: "info",
        stream: {
          write(line: string) {
            logLines.push(line)
          },
        },
      },
    })
    await app.register(systemRoutes, {
      prefix: "/api/v1/system",
      services: {
        system: {
          bootstrap: vi.fn().mockResolvedValue({ initialized: true }),
          readiness: vi.fn().mockResolvedValue({
            status: "available",
            readiness: "ready",
            checked_at: "2026-09-06T00:00:00.000Z",
          }),
        },
      } as unknown as AppServices,
    })

    await app.inject({ method: "GET", url: "/api/v1/system/health/ready" })
    expect(logLines.join("")).not.toContain("/api/v1/system/health/ready")

    await app.inject({ method: "GET", url: "/api/v1/system/bootstrap" })
    expect(logLines.join("")).toContain("/api/v1/system/bootstrap")
    await app.close()
  })

  it("serves the configured system logo through a same-origin endpoint", async () => {
    const readProductLogo = vi.fn().mockResolvedValue({
      data: ONE_PIXEL_PNG,
      contentType: "image/png",
      updatedAt: "2026-08-05T00:00:00.000Z",
    })
    const app = Fastify()
    await app.register(systemRoutes, {
      prefix: "/api/v1/system",
      services: { system: { readProductLogo } } as unknown as AppServices,
    })

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/system/logo?v=2026-08-05T00%3A00%3A00.000Z",
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("image/png")
    expect(response.headers["cache-control"]).toContain("immutable")
    expect(response.rawPayload).toEqual(ONE_PIXEL_PNG)
    await app.close()
  })
})

function multipartLogo(
  image: Buffer,
  filename = "logo.png",
  mimeType = "image/png",
  extraHeaders: Record<string, string> = {}
) {
  const boundary = "linksense-product-logo-boundary"
  return {
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      ...extraHeaders,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  }
}

describe("admin system routes", () => {
  it("reads the cached update status and supports an explicit refresh", async () => {
    const updateStatus = {
      status: "update_available",
      current_version: "v0.1.1",
      latest_release: {
        version: "v0.2.0",
        name: "LinkSense v0.2.0",
        published_at: "2026-09-01T08:00:00.000Z",
        url: "https://github.com/LingX-AI/linksense/releases/tag/v0.2.0",
        release_notes: null,
      },
      checked_at: "2026-09-01T09:00:00.000Z",
      error_code: null,
    }
    const getStatus = vi.fn().mockResolvedValue(updateStatus)
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services: {
        systemUpdate: { getStatus },
      } as unknown as AppServices,
    })

    const automaticResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/system-update",
    })
    expect(automaticResponse.statusCode).toBe(200)
    expect(automaticResponse.headers["cache-control"]).toBe(
      "private, no-store",
    )
    expect(automaticResponse.json().data).toEqual(updateStatus)
    expect(getStatus).toHaveBeenNthCalledWith(1)

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/system-update/check",
    })
    expect(refreshResponse.statusCode).toBe(200)
    expect(getStatus).toHaveBeenNthCalledWith(2, true)
    await app.close()
  })

  it("rejects update checks before calling the service when admin access is denied", async () => {
    const getStatus = vi.fn()
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => {
      const normalized = normalizeError(error)
      const details = errorDetails(normalized.code, "zh-CN")
      return reply.code(details.status).send({ error_code: normalized.code })
    })
    app.decorate("requireAdmin", async () => {
      throw new AppError("FORBIDDEN")
    })
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services: {
        systemUpdate: { getStatus },
      } as unknown as AppServices,
    })

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/system-update",
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error_code: "FORBIDDEN" })
    expect(getStatus).not.toHaveBeenCalled()
    await app.close()
  })

  it("reads and updates open registration as an administrator", async () => {
    const getRegistrationSettings = vi.fn().mockResolvedValue({
      enabled: false,
    })
    const updateRegistrationSettings = vi.fn().mockResolvedValue({
      enabled: true,
    })
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => {
      const normalized = normalizeError(error)
      const details = errorDetails(normalized.code, "zh-CN")
      return reply.code(details.status).send({ error_code: normalized.code })
    })
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services: {
        system: { getRegistrationSettings, updateRegistrationSettings },
      } as unknown as AppServices,
    })

    const readResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/registration-settings",
    })
    expect(readResponse.statusCode).toBe(200)
    expect(readResponse.json().data).toEqual({
      enabled: false,
    })

    const invalidUpdateResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/registration-settings",
      payload: { enabled: "invalid" },
    })
    expect(invalidUpdateResponse.statusCode).toBe(400)
    expect(updateRegistrationSettings).not.toHaveBeenCalled()

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/registration-settings",
      headers: { "user-agent": "registration-settings-test" },
      payload: { enabled: true },
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json().data).toEqual({
      code: "SYSTEM_SETTINGS_UPDATED",
      settings: { enabled: true },
    })
    expect(updateRegistrationSettings).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      { enabled: true },
      expect.objectContaining({ userAgent: "registration-settings-test" }),
    )
    await app.close()
  })

  it("reads and updates execution concurrency overrides as an administrator", async () => {
    const settings = {
      max_concurrent_conversations: null,
      runner_app_server_process_limit: 12,
      environment_defaults: {
        max_concurrent_conversations: 20,
        runner_app_server_process_limit: 20,
      },
      effective: {
        max_concurrent_conversations: 20,
        runner_app_server_process_limit: 12,
      },
    }
    const getExecutionConcurrencySettings = vi.fn().mockResolvedValue(settings)
    const updateExecutionConcurrencySettings = vi
      .fn()
      .mockResolvedValue(settings)
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => {
      const normalized = normalizeError(error)
      const details = errorDetails(normalized.code, "zh-CN")
      return reply.code(details.status).send({ error_code: normalized.code })
    })
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services: {
        system: {
          getExecutionConcurrencySettings,
          updateExecutionConcurrencySettings,
        },
      } as unknown as AppServices,
    })

    const readResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/execution-concurrency-settings",
    })
    expect(readResponse.statusCode).toBe(200)
    expect(readResponse.json().data).toEqual(settings)

    const invalidResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/execution-concurrency-settings",
      payload: {
        max_concurrent_conversations: 0,
        runner_app_server_process_limit: null,
      },
    })
    expect(invalidResponse.statusCode).toBe(400)
    expect(updateExecutionConcurrencySettings).not.toHaveBeenCalled()

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/execution-concurrency-settings",
      headers: { "user-agent": "concurrency-settings-test" },
      payload: {
        max_concurrent_conversations: null,
        runner_app_server_process_limit: 12,
      },
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json().data).toEqual({
      code: "SYSTEM_SETTINGS_UPDATED",
      settings,
    })
    expect(updateExecutionConcurrencySettings).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      {
        max_concurrent_conversations: null,
        runner_app_server_process_limit: 12,
      },
      expect.objectContaining({ userAgent: "concurrency-settings-test" }),
    )
    await app.close()
  })

  it("accepts replacing and removing the system logo as an administrator", async () => {
    const settings = {
      organization_display_name: "LinkSense",
      default_locale: "zh-CN",
      logo_url: "/api/v1/system/logo?v=2026-08-05T00%3A00%3A00.000Z",
      logo_updated_at: "2026-08-05T00:00:00.000Z",
    }
    const replaceProductLogo = vi.fn().mockResolvedValue(settings)
    const deleteProductLogo = vi
      .fn()
      .mockResolvedValue({ ...settings, logo_url: null, logo_updated_at: null })
    const app = Fastify()
    await app.register(multipart)
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      system: { replaceProductLogo, deleteProductLogo },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const uploadResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/product-settings/logo",
      ...multipartLogo(ONE_PIXEL_PNG, "logo.png", "image/png", {
        "user-agent": "product-logo-test",
      }),
    })
    expect(uploadResponse.statusCode).toBe(200)
    expect(uploadResponse.json().data).toMatchObject({
      code: "SYSTEM_SETTINGS_UPDATED",
      logo_url: settings.logo_url,
    })
    expect(replaceProductLogo).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      {
        filename: "logo.png",
        declaredMimeType: "image/png",
        bytes: ONE_PIXEL_PNG,
      },
      expect.objectContaining({ userAgent: "product-logo-test" })
    )

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/product-settings/logo",
      headers: { "user-agent": "product-logo-test" },
    })
    expect(deleteResponse.statusCode).toBe(200)
    expect(deleteResponse.json().data).toMatchObject({
      code: "SYSTEM_SETTINGS_UPDATED",
      logo_url: null,
      logo_updated_at: null,
    })
    expect(deleteProductLogo).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      expect.objectContaining({ userAgent: "product-logo-test" })
    )
    await app.close()
  })

  it("reads and updates the scheduled maintenance window as an administrator", async () => {
    const maintenance = {
      enabled: true,
      active: false,
      reason: "Database upgrade",
      start_at: "2026-08-04T12:00:00.000Z",
      end_at: "2026-08-04T13:00:00.000Z",
    }
    const getMaintenanceStatus = vi.fn().mockResolvedValue(maintenance)
    const updateMaintenanceSettings = vi.fn().mockResolvedValue(maintenance)
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      system: { getMaintenanceStatus, updateMaintenanceSettings },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const readResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/maintenance-settings",
    })
    expect(readResponse.statusCode).toBe(200)
    expect(readResponse.json().data).toEqual(maintenance)

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/maintenance-settings",
      headers: { "user-agent": "maintenance-settings-test" },
      payload: {
        enabled: true,
        reason: " Database upgrade ",
        start_at: maintenance.start_at,
        end_at: maintenance.end_at,
      },
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json().data).toEqual({
      code: "SYSTEM_SETTINGS_UPDATED",
      settings: maintenance,
    })
    expect(updateMaintenanceSettings).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      {
        enabled: true,
        reason: "Database upgrade",
        start_at: maintenance.start_at,
        end_at: maintenance.end_at,
      },
      expect.objectContaining({ userAgent: "maintenance-settings-test" })
    )
    await app.close()
  })

  it("accepts enabling scheduled maintenance without a reason", async () => {
    const maintenance = {
      enabled: true,
      active: false,
      reason: null,
      start_at: "2026-08-04T12:00:00.000Z",
      end_at: "2026-08-04T13:00:00.000Z",
    }
    const updateMaintenanceSettings = vi.fn().mockResolvedValue(maintenance)
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services: {
        system: {
          getMaintenanceStatus: vi.fn(),
          updateMaintenanceSettings,
        },
      } as unknown as AppServices,
    })

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/maintenance-settings",
      payload: {
        enabled: true,
        reason: null,
        start_at: maintenance.start_at,
        end_at: maintenance.end_at,
      },
    })

    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json().data).toEqual({
      code: "SYSTEM_SETTINGS_UPDATED",
      settings: maintenance,
    })
    expect(updateMaintenanceSettings).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      {
        enabled: true,
        reason: null,
        start_at: maintenance.start_at,
        end_at: maintenance.end_at,
      },
      expect.any(Object)
    )
    await app.close()
  })

  it("accepts disabling scheduled maintenance without a reason or time window", async () => {
    const disabledMaintenance = {
      enabled: false,
      active: false,
      reason: null,
      start_at: null,
      end_at: null,
    }
    const updateMaintenanceSettings = vi
      .fn()
      .mockResolvedValue(disabledMaintenance)
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      system: {
        getMaintenanceStatus: vi.fn(),
        updateMaintenanceSettings,
      },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/maintenance-settings",
      payload: {
        enabled: false,
        reason: null,
        start_at: null,
        end_at: null,
      },
    })

    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json().data).toEqual({
      code: "SYSTEM_SETTINGS_UPDATED",
      settings: disabledMaintenance,
    })
    expect(updateMaintenanceSettings).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      {
        enabled: false,
        reason: null,
        start_at: null,
        end_at: null,
      },
      expect.any(Object)
    )
    await app.close()
  })

  it("keeps model settings visible but rejects every model-management mutation when deployment configuration disables them", async () => {
    const getAdminSettings = vi.fn().mockResolvedValue({
      configured: false,
      revision: 0,
      providers: [],
      default_model: null,
    })
    const update = vi.fn()
    const updateModelAvailability = vi.fn()
    const deleteModel = vi.fn()
    const deleteProvider = vi.fn()
    const discoverModels = vi.fn()
    const updateImageUnderstanding = vi.fn()
    const updateKnowledgeModels = vi.fn()
    const updateVoiceTranscription = vi.fn()
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    app.setErrorHandler((error, _request, reply) => {
      const normalized = normalizeError(error)
      const details = errorDetails(normalized.code, "zh-CN")
      return reply.code(details.status).send({ error_code: normalized.code })
    })
    const services = {
      config: { adminModelManagementEnabled: false },
      modelProviderSettings: {
        getAdminSettings,
        update,
        updateModelAvailability,
        deleteModel,
        deleteProvider,
        discoverModels,
      },
      imageUnderstandingSettings: { update: updateImageUnderstanding },
      knowledgeModelSettings: { update: updateKnowledgeModels },
      voiceTranscriptionSettings: { update: updateVoiceTranscription },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const readResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/model-provider-settings",
    })
    expect(readResponse.statusCode).toBe(200)
    expect(readResponse.json().data).toMatchObject({
      management_enabled: false,
      configured: false,
    })

    const mutationRequests = [
      { method: "PUT", url: "/api/v1/admin/model-provider-settings" },
      {
        method: "PATCH",
        url: "/api/v1/admin/model-provider-settings/models/availability",
      },
      {
        method: "DELETE",
        url: "/api/v1/admin/model-provider-settings/models",
      },
      {
        method: "DELETE",
        url: "/api/v1/admin/model-provider-settings/providers",
      },
      { method: "PUT", url: "/api/v1/admin/image-understanding-settings" },
      { method: "PUT", url: "/api/v1/admin/knowledge-model-settings" },
      { method: "PUT", url: "/api/v1/admin/voice-transcription-settings" },
    ] as const

    for (const request of mutationRequests) {
      const response = await app.inject({ ...request, payload: {} })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({
        error_code: "MODEL_MANAGEMENT_DISABLED",
      })
    }
    const discoveryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/model-provider-settings/providers/provider-a/discoverable-models",
    })
    expect(discoveryResponse.statusCode).toBe(403)
    expect(discoveryResponse.json()).toEqual({
      error_code: "MODEL_MANAGEMENT_DISABLED",
    })
    expect(update).not.toHaveBeenCalled()
    expect(updateModelAvailability).not.toHaveBeenCalled()
    expect(deleteModel).not.toHaveBeenCalled()
    expect(deleteProvider).not.toHaveBeenCalled()
    expect(discoverModels).not.toHaveBeenCalled()
    expect(updateImageUnderstanding).not.toHaveBeenCalled()
    expect(updateKnowledgeModels).not.toHaveBeenCalled()
    expect(updateVoiceTranscription).not.toHaveBeenCalled()
    await app.close()
  })

  it("reads and updates provider-scoped authentication settings as an administrator", async () => {
    const settings = {
      smtp: {
        mode: "inherit",
        status: "not_configured",
        source: "none",
        revision: 0,
        host: null,
        port: null,
        security: null,
        username: null,
        from: null,
        password_configured: false,
      },
      oidc: {
        mode: "managed",
        status: "configured",
        source: "system",
        revision: 1,
        issuer_url: "https://identity.example.com",
        client_id: "linksense",
        redirect_uri:
          "https://linksense.example.test/api/v1/auth/oidc/callback",
        client_secret_configured: true,
      },
      teams: {
        mode: "inherit",
        status: "not_configured",
        source: "none",
        revision: 0,
        tenant_id: null,
        client_id: null,
      },
    } as const
    const getAdminSettings = vi.fn().mockResolvedValue(settings)
    const updateOidc = vi.fn().mockResolvedValue(settings)
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      authenticationSettings: { getAdminSettings, updateOidc },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const readResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/authentication-settings",
    })
    expect(readResponse.statusCode).toBe(200)
    expect(readResponse.json().data.oidc).not.toHaveProperty("client_secret")

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/authentication-settings/oidc",
      headers: { "user-agent": "settings-page-test" },
      payload: {
        mode: "managed",
        expected_revision: 1,
        issuer_url: "https://identity.example.com",
        client_id: "linksense",
        client_secret: "  replacement-secret  ",
      },
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json()).toMatchObject({
      success: true,
      data: { code: "AUTHENTICATION_SETTINGS_UPDATED" },
    })
    expect(JSON.stringify(updateResponse.json())).not.toContain(
      "replacement-secret"
    )
    expect(updateOidc).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      expect.objectContaining({ client_secret: "replacement-secret" }),
      expect.objectContaining({ userAgent: "settings-page-test" })
    )
    await app.close()
  })

  it("returns a provider model catalog without exposing its credential", async () => {
    const discoverModels = vi.fn().mockResolvedValue({
      provider_id: "provider-a",
      models: [
        {
          id: "model-a",
          display_name: "Model A",
          kind: "chat",
          context_window: 128_000,
          supports_image_input: true,
          supported_reasoning_efforts: ["medium"],
          default_reasoning_effort: "medium",
        },
      ],
    })
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      modelProviderSettings: { discoverModels },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/model-provider-settings/providers/provider-a/discoverable-models",
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("private, no-store")
    expect(response.json().data).toMatchObject({
      provider_id: "provider-a",
      models: [{ id: "model-a" }],
    })
    expect(JSON.stringify(response.json())).not.toContain("secret")
    expect(discoverModels).toHaveBeenCalledWith(
      "provider-a",
      expect.any(AbortSignal)
    )
    await app.close()
  })

  it("updates one model availability through the dedicated administrator endpoint", async () => {
    const settings = {
      configured: true,
      revision: 3,
      providers: [
        {
          id: "provider-a",
          name: "Primary channel",
          base_url: "https://models.example.test/v1",
          protocol_mode: "native_responses",
          api_key_configured: true,
          models: [
            {
              id: "model-a",
              display_name: "Model A",
              enabled: false,
              supported_reasoning_efforts: ["medium"],
              default_reasoning_effort: "medium",
            },
            {
              id: "model-b",
              display_name: "Model B",
              enabled: true,
              supported_reasoning_efforts: ["medium"],
              default_reasoning_effort: "medium",
            },
          ],
        },
      ],
      default_model: "model-b",
    } as const
    const updateModelAvailability = vi.fn().mockResolvedValue(settings)
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      modelProviderSettings: { updateModelAvailability },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/model-provider-settings/models/availability",
      headers: { "user-agent": "model-settings-page-test" },
      payload: {
        expected_revision: 2,
        model_id: "model-a",
        enabled: false,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        code: "SYSTEM_SETTINGS_UPDATED",
        settings: { revision: 3, default_model: "model-b" },
      },
    })
    expect(updateModelAvailability).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      {
        expected_revision: 2,
        model_id: "model-a",
        enabled: false,
      },
      expect.objectContaining({ userAgent: "model-settings-page-test" })
    )
    await app.close()
  })

  it("deletes one model through the dedicated administrator endpoint", async () => {
    const settings = {
      configured: true,
      revision: 4,
      providers: [
        {
          id: "provider-a",
          name: "Primary channel",
          base_url: "https://models.example.test/v1",
          protocol_mode: "native_responses",
          api_key_configured: true,
          models: [
            {
              id: "model-b",
              display_name: "Model B",
              enabled: true,
              supported_reasoning_efforts: ["medium"],
              default_reasoning_effort: "medium",
            },
          ],
        },
      ],
      default_model: "model-b",
    } as const
    const deleteModel = vi.fn().mockResolvedValue(settings)
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      modelProviderSettings: { deleteModel },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/model-provider-settings/models",
      headers: { "user-agent": "model-settings-page-test" },
      payload: {
        expected_revision: 3,
        model_id: "model-a",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        code: "SYSTEM_SETTINGS_UPDATED",
        settings: { revision: 4, default_model: "model-b" },
      },
    })
    expect(deleteModel).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      {
        expected_revision: 3,
        model_id: "model-a",
      },
      expect.objectContaining({ userAgent: "model-settings-page-test" })
    )
    await app.close()
  })

  it("deletes one model channel through the dedicated administrator endpoint", async () => {
    const settings = {
      configured: true,
      revision: 5,
      providers: [
        {
          id: "provider-b",
          name: "Backup channel",
          provider: "openai_compatible",
          provider_project: null,
          provider_location: null,
          base_url: "https://models-b.example.test/v1",
          protocol_mode: "native_responses",
          api_key_configured: true,
          models: [
            {
              id: "model-b",
              display_name: "Model B",
              enabled: true,
              kind: "chat",
              input_price_per_million: "0",
              cached_input_price_per_million: "0",
              output_price_per_million: "0",
              supports_image_input: false,
              context_window: null,
              supported_reasoning_efforts: ["medium"],
              default_reasoning_effort: "medium",
            },
          ],
        },
      ],
      default_model: "model-b",
    } as const
    const deleteProvider = vi.fn().mockResolvedValue(settings)
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      modelProviderSettings: { deleteProvider },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/model-provider-settings/providers",
      headers: { "user-agent": "model-settings-page-test" },
      payload: {
        expected_revision: 4,
        provider_id: "provider-a",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        code: "SYSTEM_SETTINGS_UPDATED",
        settings: { revision: 5, default_model: "model-b" },
      },
    })
    expect(deleteProvider).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      {
        expected_revision: 4,
        provider_id: "provider-a",
      },
      expect.objectContaining({ userAgent: "model-settings-page-test" })
    )
    await app.close()
  })

  it("reads and updates encrypted knowledge model settings through the administrator API", async () => {
    const settings = {
      revision: 1,
      embedding: {
        configured: true,
        base_url: "https://embedding.example.test",
        api_key_configured: true,
        model: "embedding-v2",
        dimensions: 8,
        maximum_input_tokens: 8192,
      },
      rerank: {
        enabled: false,
        base_url: null,
        api_key_configured: false,
        model: null,
        maximum_input_tokens: 8192,
        timeout_ms: 60000,
      },
    } as const
    const getAdminSettings = vi.fn().mockResolvedValue(settings)
    const update = vi.fn().mockResolvedValue({ ...settings, revision: 2 })
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      knowledgeModelSettings: { getAdminSettings, update },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/admin/knowledge-model-settings",
    })
    expect(read.statusCode).toBe(200)
    expect(read.json().data.embedding).not.toHaveProperty("api_key")

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/knowledge-model-settings",
      headers: { "user-agent": "knowledge-model-page-test" },
      payload: {
        expected_revision: 1,
        embedding: {
          model: "embedding-v2",
        },
        rerank: {
          enabled: false,
          model: null,
        },
      },
    })
    expect(response.statusCode).toBe(200)
    expect(update).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      expect.objectContaining({
        embedding: { model: "embedding-v2" },
        rerank: { enabled: false, model: null },
      }),
      expect.objectContaining({ userAgent: "knowledge-model-page-test" })
    )
    await app.close()
  })

  it("reads and updates administrator-managed voice transcription settings", async () => {
    const settings = {
      configured: true,
      revision: 2,
      enabled: true,
      provider: "openai",
      provider_options: { api_version: null },
      base_url: "https://api.openai.com/v1",
      api_key_configured: true,
      model: "gpt-4o-mini-transcribe",
      providers: [],
    }
    const getAdminSettings = vi.fn().mockResolvedValue(settings)
    const update = vi.fn().mockResolvedValue({ ...settings, revision: 3 })
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services: {
        voiceTranscriptionSettings: { getAdminSettings, update },
      } as unknown as AppServices,
    })

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/admin/voice-transcription-settings",
    })
    expect(read.statusCode).toBe(200)
    expect(read.json().data).not.toHaveProperty("api_key")

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/voice-transcription-settings",
      headers: { "user-agent": "voice-transcription-page-test" },
      payload: {
        expected_revision: 2,
        enabled: true,
        provider: "openai",
        provider_options: { api_version: null },
        base_url: "https://api.openai.com/v1",
        model: "gpt-4o-transcribe",
      },
    })
    expect(response.statusCode).toBe(200)
    expect(update).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      expect.objectContaining({
        expected_revision: 2,
        provider: "openai",
        model: "gpt-4o-transcribe",
      }),
      expect.objectContaining({ userAgent: "voice-transcription-page-test" }),
    )
    await app.close()
  })

  it("exposes cleanup retry by opaque job id and forwards the audit context", async () => {
    const retryCleanupFailure = vi.fn().mockResolvedValue({
      code: "CLEANUP_RETRY_REQUESTED",
      cleanup_failure: {
        id: "runtime-redacted-id",
        resource_type: "workspace",
        failed_at: "2026-07-11T00:00:00.000Z",
        reason_code: "CLEANUP_OPERATION_FAILED",
        attempts_made: 5,
        max_attempts: 5,
      },
    })
    const health = vi.fn().mockResolvedValue({ status: "available" })
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    const services = {
      system: { retryCleanupFailure, health },
    } as unknown as AppServices
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services,
    })

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/health/cleanup/runtime-redacted-id/retry",
      headers: { "user-agent": "health-page-test" },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({
      success: true,
      data: { code: "CLEANUP_RETRY_REQUESTED" },
    })
    expect(retryCleanupFailure).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      "runtime-redacted-id",
      expect.objectContaining({ userAgent: "health-page-test" })
    )
    const healthResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/health",
    })
    expect(healthResponse.statusCode).toBe(200)
    expect(health).toHaveBeenCalledWith({ includeCleanupFailures: true })
    await app.close()
  })

  it("requires confirmation before retrying all cleanup failures", async () => {
    const retryAllCleanupFailures = vi.fn().mockResolvedValue({
      code: "CLEANUP_BULK_RETRY_REQUESTED",
      requested_count: 3,
      rejected_count: 0,
    })
    const app = Fastify()
    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      request.authUser = {
        id: "01900000-0000-7000-8000-000000000099",
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        status: "active",
        preferredLocale: "zh-CN",
        avatarObjectKey: null,
        authValidAfter: new Date(0),
      }
    })
    await app.register(adminSystemRoutes, {
      prefix: "/api/v1/admin",
      services: {
        system: {
          retryAllCleanupFailures,
          health: vi.fn(),
        },
      } as unknown as AppServices,
    })

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/admin/health/cleanup/retry-all",
      payload: { confirmed: false },
    })
    expect(rejected.statusCode).toBe(400)
    expect(retryAllCleanupFailures).not.toHaveBeenCalled()

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/admin/health/cleanup/retry-all",
      headers: { "user-agent": "health-bulk-test" },
      payload: { confirmed: true },
    })
    expect(accepted.statusCode).toBe(202)
    expect(accepted.json()).toMatchObject({
      success: true,
      data: { requested_count: 3, rejected_count: 0 },
    })
    expect(retryAllCleanupFailures).toHaveBeenCalledWith(
      "01900000-0000-7000-8000-000000000099",
      expect.objectContaining({ userAgent: "health-bulk-test" }),
    )
    await app.close()
  })
})
