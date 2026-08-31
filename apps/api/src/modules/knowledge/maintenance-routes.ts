import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { z } from "zod"

import { AppError } from "../../lib/errors.js"
import { ok } from "../../lib/http.js"
import type { KnowledgeMaintenanceService } from "./maintenance.js"
import type { KnowledgeActor, ResolveKnowledgeActor } from "./types.js"

export interface KnowledgeMaintenanceRoutesOptions {
  service: KnowledgeMaintenanceService
  resolveActor?: ResolveKnowledgeActor
}

const requestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1_000),
  confirmed: z.literal(true),
})

export const knowledgeMaintenanceRoutes: FastifyPluginAsync<
  KnowledgeMaintenanceRoutesOptions
> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver

  app.get("/rebuild-all", async (request, reply) => {
    const actor = await actorFor(request)
    return reply.send(ok(await options.service.getLatest(actor), request))
  })

  app.post("/rebuild-all", async (request, reply) => {
    const actor = await actorFor(request)
    const body = requestSchema.parse(request.body)
    return reply.code(202).send(
      ok(
        await options.service.requestRebuild(actor, {
          reason: body.reason,
          confirmed: true,
        }),
        request,
      ),
    )
  })
}

function defaultActorResolver(request: FastifyRequest): KnowledgeActor {
  const user = request.authUser
  if (user === undefined) throw new AppError("AUTH_REQUIRED")
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    ipAddress: request.ip,
    ...(request.headers["user-agent"] === undefined
      ? {}
      : { userAgent: request.headers["user-agent"] }),
  }
}
