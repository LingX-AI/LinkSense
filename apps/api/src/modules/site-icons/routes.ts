import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"

import { AppError } from "../../lib/errors.js"
import type { AppServices } from "../../services.js"

const querySchema = z.strictObject({ origin: z.string().trim().min(1).max(512) })

export const siteIconRoutes: FastifyPluginAsync<{
  services: Pick<AppServices, "redis" | "siteIcons">
}> = async (app, { services }) => {
  app.get(
    "/site-icons",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const userId = request.authUser?.id
      if (!userId) throw new AppError("AUTH_REQUIRED")
      const allowed = await services.redis.takeSiteIconRequest(userId).catch(
        () => false,
      )
      if (!allowed) return reply.code(204).send()
      const { origin } = querySchema.parse(request.query)
      const icon = await services.siteIcons.get(origin)
      if (!icon) return reply.code(204).send()
      return reply
        .type(icon.mimeType)
        .header("cache-control", "private, max-age=86400")
        .header("content-length", icon.sizeBytes)
        .header("content-security-policy", "sandbox; default-src 'none'")
        .send(icon.data)
    },
  )
}
