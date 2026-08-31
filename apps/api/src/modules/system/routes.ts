import type { FastifyPluginAsync } from "fastify"
import {
  deleteModelProviderSchema,
  deleteModelProviderModelSchema,
  patchProductSettingsSchema,
  updateKnowledgeModelSettingsSchema,
  updateImageGenerationSettingsSchema,
  updateImageUnderstandingSelectionSchema,
  updateMaintenanceSettingsSchema,
  updateRegistrationSettingsSchema,
  updateModelAvailabilitySchema,
  updateModelProviderSettingsSchema,
  updateOidcAuthenticationSettingsSchema,
  updateSmtpAuthenticationSettingsSchema,
  updateTeamsAuthenticationSettingsSchema,
  updateSharePointConnectionSettingsSchema,
} from "@linksense/shared"
import { z } from "zod"

import { AppError } from "../../lib/errors.js"
import { ok, sendAppError } from "../../lib/http.js"
import type { AuthenticatedRequest } from "../../plugins/authentication.js"
import type { AppServices } from "../../services.js"

const DEPLOYMENT_KEYS = new Set([
  "database_url",
  "redis_url",
  "minio_endpoint",
  "smtp_host",
  "oidc_issuer_url",
  "teams_tenant_id",
  "runner_url",
  "jwt_secret",
  "credential_master_key",
  "max_concurrent_conversations",
  "upload_max_file_size_mb",
])

function isAdminModelManagementEnabled(services: AppServices): boolean {
  return services.config?.adminModelManagementEnabled !== false
}

function requireAdminModelManagement(services: AppServices): void {
  if (!isAdminModelManagementEnabled(services)) {
    throw new AppError("MODEL_MANAGEMENT_DISABLED")
  }
}

export const systemRoutes: FastifyPluginAsync<{
  services: AppServices
}> = async (app, { services }) => {
  app.get("/bootstrap", async (request, reply) =>
    reply.send(ok(await services.system.bootstrap(), request.id))
  )

  app.get("/logo", async (_request, reply) => {
    const logo = await services.system.readProductLogo()
    if (!logo) throw new AppError("NOT_FOUND")
    return reply
      .header("content-type", logo.contentType)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("last-modified", new Date(logo.updatedAt).toUTCString())
      .send(logo.data)
  })

  app.get("/health/live", async (request, reply) =>
    reply.send(ok({ status: "available" }, request.id))
  )

  app.get("/health/ready", async (request, reply) => {
    const health = await services.system.health()
    return reply
      .code(health.readiness === "ready" ? 200 : 503)
      .send(ok(health, request.id))
  })
}

export const adminSystemRoutes: FastifyPluginAsync<{
  services: AppServices
}> = async (app, { services }) => {
  app.addHook("preHandler", app.requireAdmin)

  app.get("/product-settings", async (request, reply) =>
    reply.send(ok(await services.system.getProductSettings(), request.id))
  )

  app.patch("/product-settings", async (request, reply) => {
    const raw =
      request.body &&
      typeof request.body === "object" &&
      !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {}
    const keys = Object.keys(raw)
    if (keys.some((key) => DEPLOYMENT_KEYS.has(key))) {
      throw new AppError("DEPLOYMENT_SETTING_READ_ONLY")
    }
    if (
      keys.some(
        (key) => key !== "organization_display_name" && key !== "default_locale"
      )
    ) {
      throw new AppError("PRODUCT_SETTING_UNKNOWN")
    }
    const patch = patchProductSettingsSchema.parse(raw)
    const actor = (request as AuthenticatedRequest).authUser
    const result = await services.system.patchProductSettings(
      actor.id,
      {
        ...(patch.organization_display_name
          ? { organization_display_name: patch.organization_display_name }
          : {}),
        ...(patch.default_locale
          ? { default_locale: patch.default_locale }
          : {}),
      },
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }
    )
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", ...result }, request.id)
    )
  })

  app.post("/product-settings/logo", async (request, reply) => {
    if (!request.isMultipart()) throw new AppError("PRODUCT_LOGO_UPLOAD_INVALID")
    const file = await request.file({
      limits: { files: 1, fileSize: 2 * 1024 * 1024 },
    })
    if (!file) throw new AppError("PRODUCT_LOGO_UPLOAD_INVALID")
    let bytes: Buffer
    try {
      bytes = await file.toBuffer()
    } catch {
      throw new AppError("PRODUCT_LOGO_UPLOAD_INVALID")
    }
    const actor = (request as AuthenticatedRequest).authUser
    const result = await services.system.replaceProductLogo(
      actor.id,
      {
        filename: file.filename,
        declaredMimeType: file.mimetype,
        bytes,
      },
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }
    )
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", ...result }, request.id)
    )
  })

  app.delete("/product-settings/logo", async (request, reply) => {
    const actor = (request as AuthenticatedRequest).authUser
    const result = await services.system.deleteProductLogo(actor.id, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", ...result }, request.id)
    )
  })

  app.get("/maintenance-settings", async (request, reply) =>
    reply.send(ok(await services.system.getMaintenanceStatus(), request.id))
  )

  app.put("/maintenance-settings", async (request, reply) => {
    const actor = (request as AuthenticatedRequest).authUser
    const settings = await services.system.updateMaintenanceSettings(
      actor.id,
      updateMaintenanceSettingsSchema.parse(request.body),
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }
    )
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
    )
  })

  app.get("/registration-settings", async (request, reply) =>
    reply.send(ok(await services.system.getRegistrationSettings(), request.id))
  )

  app.put("/registration-settings", async (request, reply) => {
    const actor = (request as AuthenticatedRequest).authUser
    const settings = await services.system.updateRegistrationSettings(
      actor.id,
      updateRegistrationSettingsSchema.parse(request.body),
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }
    )
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
    )
  })

  app.get("/authentication-settings", async (request, reply) =>
    reply.send(
      ok(await services.authenticationSettings.getAdminSettings(), request.id)
    )
  )

  app.put("/authentication-settings/:provider", async (request, reply) => {
    const { provider } = z
      .strictObject({ provider: z.enum(["smtp", "oidc", "teams"]) })
      .parse(request.params)
    const actor = (request as AuthenticatedRequest).authUser
    const context = {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    }
    const settings =
      provider === "smtp"
        ? await services.authenticationSettings.updateSmtp(
            actor.id,
            updateSmtpAuthenticationSettingsSchema.parse(request.body),
            context
          )
        : provider === "oidc"
          ? await services.authenticationSettings.updateOidc(
              actor.id,
              updateOidcAuthenticationSettingsSchema.parse(request.body),
              context
            )
          : await services.authenticationSettings.updateTeams(
              actor.id,
              updateTeamsAuthenticationSettingsSchema.parse(request.body),
              context
            )
    return reply.send(
      ok({ code: "AUTHENTICATION_SETTINGS_UPDATED", settings }, request.id)
    )
  })

  app.get("/model-provider-settings", async (request, reply) => {
    const settings = await services.modelProviderSettings.getAdminSettings()
    return reply.send(
      ok(
        {
          ...settings,
          management_enabled: isAdminModelManagementEnabled(services),
        },
        request.id
      )
    )
  })

  app.put("/model-provider-settings", async (request, reply) => {
    requireAdminModelManagement(services)
    const actor = (request as AuthenticatedRequest).authUser
    const settings = await services.modelProviderSettings.update(
      actor.id,
      updateModelProviderSettingsSchema.parse(request.body),
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }
    )
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
    )
  })

  app.patch(
    "/model-provider-settings/models/availability",
    async (request, reply) => {
      requireAdminModelManagement(services)
      const actor = (request as AuthenticatedRequest).authUser
      const settings =
        await services.modelProviderSettings.updateModelAvailability(
          actor.id,
          updateModelAvailabilitySchema.parse(request.body),
          {
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          }
        )
      return reply.send(
        ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
      )
    }
  )

  app.delete("/model-provider-settings/models", async (request, reply) => {
    requireAdminModelManagement(services)
    const actor = (request as AuthenticatedRequest).authUser
    const settings = await services.modelProviderSettings.deleteModel(
      actor.id,
      deleteModelProviderModelSchema.parse(request.body),
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }
    )
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
    )
  })

  app.delete("/model-provider-settings/providers", async (request, reply) => {
    requireAdminModelManagement(services)
    const actor = (request as AuthenticatedRequest).authUser
    const settings = await services.modelProviderSettings.deleteProvider(
      actor.id,
      deleteModelProviderSchema.parse(request.body),
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }
    )
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
    )
  })

  app.get("/image-understanding-settings", async (request, reply) =>
    reply.send(
      ok(
        await services.imageUnderstandingSettings.getAdminSettings(),
        request.id
      )
    )
  )

  app.get("/image-generation-settings", async (request, reply) =>
    reply.send(
      ok(await services.imageGenerationSettings.getAdminSettings(), request.id)
    )
  )

  app.put("/image-generation-settings", async (request, reply) => {
    requireAdminModelManagement(services)
    const actor = (request as AuthenticatedRequest).authUser
    const settings = await services.imageGenerationSettings.update(
      actor.id,
      updateImageGenerationSettingsSchema.parse(request.body),
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }
    )
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
    )
  })

  app.put("/image-understanding-settings", async (request, reply) => {
    requireAdminModelManagement(services)
    const actor = (request as AuthenticatedRequest).authUser
    const settings = await services.imageUnderstandingSettings.update(
      actor.id,
      updateImageUnderstandingSelectionSchema.parse(request.body),
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }
    )
    return reply.send(
      ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
    )
  })

  const knowledgeModelSettings = services.knowledgeModelSettings
  if (knowledgeModelSettings) {
    app.get("/knowledge-model-settings", async (request, reply) =>
      reply.send(ok(await knowledgeModelSettings.getAdminSettings(), request.id))
    )

    app.put("/knowledge-model-settings", async (request, reply) => {
      requireAdminModelManagement(services)
      const actor = (request as AuthenticatedRequest).authUser
      const settings = await knowledgeModelSettings.update(
        actor.id,
        updateKnowledgeModelSettingsSchema.parse(request.body),
        {
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        }
      )
      return reply.send(
        ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
      )
    })
  }

  const sharePointSettings = services.sharePointSettings
  if (sharePointSettings) {
    app.get("/knowledge-source-settings/sharepoint", async (request, reply) =>
      reply.send(ok(await sharePointSettings.getAdminSettings(), request.id))
    )

    app.put("/knowledge-source-settings/sharepoint", async (request, reply) => {
      const actor = (request as AuthenticatedRequest).authUser
      const settings = await sharePointSettings.update(
        actor.id,
        updateSharePointConnectionSettingsSchema.parse(request.body),
        {
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        }
      )
      return reply.send(
        ok({ code: "SYSTEM_SETTINGS_UPDATED", settings }, request.id)
      )
    })
  }

  app.get("/health", async (request, reply) =>
    reply.send(
      ok(
        await services.system.health({ includeCleanupFailures: true }),
        request.id
      )
    )
  )

  app.post("/health/cleanup/retry-all", async (request, reply) => {
    const confirmation = z
      .strictObject({ confirmed: z.literal(true) })
      .safeParse(request.body)
    if (!confirmation.success) {
      return sendAppError(
        reply,
        request,
        new AppError("VALIDATION_ERROR"),
        (request as AuthenticatedRequest).authUser.preferredLocale,
      )
    }
    const actor = (request as AuthenticatedRequest).authUser
    const result = await services.system.retryAllCleanupFailures(actor.id, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })
    return reply.code(202).send(ok(result, request.id))
  })

  app.post("/health/cleanup/:jobId/retry", async (request, reply) => {
    const { jobId } = z
      .strictObject({
        jobId: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .regex(/^[A-Za-z0-9_-]+$/u),
      })
      .parse(request.params)
    const actor = (request as AuthenticatedRequest).authUser
    const result = await services.system.retryCleanupFailure(actor.id, jobId, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    })
    return reply.code(202).send(ok(result, request.id))
  })
}
