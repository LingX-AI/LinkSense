import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { z } from "zod"

import { AppError } from "../../lib/errors.js"
import { ok } from "../../lib/http.js"
import type { KnowledgeAdminService } from "./admin.js"
import type { KnowledgeActor, ResolveKnowledgeActor } from "./types.js"

export interface KnowledgeAdminRoutesOptions {
  service: KnowledgeAdminService
  resolveActor?: ResolveKnowledgeActor
}

const uuid = z.string().uuid()
const baseParamsSchema = z.strictObject({ id: uuid })
const grantParamsSchema = z.strictObject({ id: uuid, grantId: uuid })
const requiredReasonSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1_000),
})
const transferOwnerSchema = requiredReasonSchema.extend({
  owner_id: uuid,
})
const retryCleanupSchema = requiredReasonSchema.extend({
  target_type: z
    .enum(["outbox", "document", "document_version", "object"])
    .optional(),
  target_id: uuid.optional(),
}).superRefine((value, context) => {
  if ((value.target_type === undefined) !== (value.target_id === undefined)) {
    context.addIssue({
      code: "custom",
      message: "cleanup target type and id must be provided together",
    })
  }
})
const listQuerySchema = z.strictObject({
  search: z.string().trim().min(1).max(240).optional(),
  lifecycle_status: z.enum(["active", "archived", "deleted"]).optional(),
  availability_status: z.enum(["enabled", "disabled"]).optional(),
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/**
 * Dedicated governance endpoints. Register this plugin only below the
 * authenticated admin API prefix; the service repeats the role/status check.
 */
export const knowledgeAdminRoutes: FastifyPluginAsync<
  KnowledgeAdminRoutesOptions
> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver

  app.get("/", async (request, reply) => {
    const actor = await actorFor(request)
    const query = listQuerySchema.parse(request.query)
    const result = await options.service.list(actor, {
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.lifecycle_status === undefined
        ? {}
        : { lifecycleStatus: query.lifecycle_status }),
      ...(query.availability_status === undefined
        ? {}
        : { availabilityStatus: query.availability_status }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: query.limit,
    })
    return reply.send(ok(result, request))
  })

  app.post("/:id/disable", async (request, reply) => {
    const actor = await actorFor(request)
    const { id } = baseParamsSchema.parse(request.params)
    const body = requiredReasonSchema.parse(request.body)
    await options.service.disable(actor, id, body.reason)
    return reply.code(204).send()
  })

  app.post("/:id/enable", async (request, reply) => {
    const actor = await actorFor(request)
    const { id } = baseParamsSchema.parse(request.params)
    const body = requiredReasonSchema.parse(request.body)
    await options.service.enable(actor, id, body.reason)
    return reply.code(204).send()
  })

  app.post("/:id/transfer-owner", async (request, reply) => {
    const actor = await actorFor(request)
    const { id } = baseParamsSchema.parse(request.params)
    const body = transferOwnerSchema.parse(request.body)
    await options.service.transferOwnership(actor, id, body.owner_id, body.reason)
    return reply.code(204).send()
  })

  app.post("/:id/archive", async (request, reply) => {
    const actor = await actorFor(request)
    const { id } = baseParamsSchema.parse(request.params)
    const body = requiredReasonSchema.parse(request.body)
    await options.service.archive(actor, id, body.reason)
    return reply.code(204).send()
  })

  app.delete("/:id/grants/:grantId", async (request, reply) => {
    const actor = await actorFor(request)
    const { id, grantId } = grantParamsSchema.parse(request.params)
    const body = requiredReasonSchema.parse(request.body)
    await options.service.revokeGrant(actor, id, grantId, body.reason)
    return reply.code(204).send()
  })

  app.delete("/:id", async (request, reply) => {
    const actor = await actorFor(request)
    const { id } = baseParamsSchema.parse(request.params)
    const body = requiredReasonSchema.parse(request.body)
    await options.service.forceDelete(actor, id, body.reason)
    return reply.code(204).send()
  })

  app.post("/:id/cleanup/retry", async (request, reply) => {
    const actor = await actorFor(request)
    const { id } = baseParamsSchema.parse(request.params)
    const body = retryCleanupSchema.parse(request.body)
    const target =
      body.target_type === undefined || body.target_id === undefined
        ? undefined
        : { type: body.target_type, id: body.target_id }
    return reply.send(
      ok(
        await options.service.retryCleanup(
          actor,
          id,
          target,
          body.reason,
        ),
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
