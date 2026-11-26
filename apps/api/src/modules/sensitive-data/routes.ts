import {
  sensitiveDataChoiceSchema,
  sensitiveDataModelSwitchSchema,
  updateSensitiveDataPreferenceSchema,
  updateSensitiveDataSettingsSchema,
} from "@linksense/shared"
import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"

import { ok } from "../../lib/http.js"
import type { AuthenticatedRequest } from "../../plugins/authentication.js"
import type { SensitiveDataService } from "./service.js"

const conversationParamsSchema = z.strictObject({ id: z.uuid() })

export const sensitiveDataRoutes: FastifyPluginAsync<{ service: SensitiveDataService }> =
  async (app, { service }) => {
    app.get("/api/v1/system/sensitive-data-settings", { preHandler: app.requireAdmin }, async (request, reply) => {
      return reply.send(ok(await service.settings.getAdminSettings(), request))
    })

    app.put("/api/v1/system/sensitive-data-settings", { preHandler: app.requireAdmin }, async (request, reply) => {
      const { authUser } = request as AuthenticatedRequest
      const input = updateSensitiveDataSettingsSchema.parse(request.body)
      return reply.send(ok(await service.settings.update(authUser.id, input, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      }), request))
    })

    app.get("/api/v1/me/sensitive-data", { preHandler: app.authenticate }, async (request, reply) => {
      const { authUser } = request as AuthenticatedRequest
      return reply.send(ok(await service.getUserSettings(authUser.id), request))
    })

    app.put("/api/v1/me/sensitive-data", { preHandler: app.authenticate }, async (request, reply) => {
      const { authUser } = request as AuthenticatedRequest
      const preference = updateSensitiveDataPreferenceSchema.parse(request.body)
      return reply.send(ok(await service.updateUserSettings(authUser.id, preference), request))
    })

    app.get("/api/v1/conversations/:id/sensitive-data", { preHandler: app.authenticate }, async (request, reply) => {
      const { authUser } = request as AuthenticatedRequest
      const { id } = conversationParamsSchema.parse(request.params)
      return reply.send(ok(await service.getTaskStatus(authUser.id, id), request))
    })

    app.put("/api/v1/conversations/:id/sensitive-data", { preHandler: app.authenticate }, async (request, reply) => {
      const { authUser } = request as AuthenticatedRequest
      const { id } = conversationParamsSchema.parse(request.params)
      const choice = sensitiveDataChoiceSchema.parse(request.body)
      return reply.send(ok(await service.chooseModel(authUser.id, id, choice), request))
    })

    app.patch("/api/v1/conversations/:id/sensitive-data", { preHandler: app.authenticate }, async (request, reply) => {
      const { authUser } = request as AuthenticatedRequest
      const { id } = conversationParamsSchema.parse(request.params)
      const selection = sensitiveDataModelSwitchSchema.parse(request.body)
      return reply.send(ok(await service.switchModel(authUser.id, id, selection), request))
    })
  }
