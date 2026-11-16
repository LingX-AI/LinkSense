import { timingSafeEqual } from "node:crypto"
import { webSearchRequestSchema } from "@linksense/shared"
import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"
import type { WebSearchSettingsService } from "./web-search-settings.js"

const bodySchema = z.strictObject({ conversationId: z.uuid(), turnId: z.uuid(), request: webSearchRequestSchema })
export const internalWebSearchRoutes: FastifyPluginAsync<{
  service: Pick<WebSearchSettingsService, "search">; sharedSecret: string
}> = async (app, { service, sharedSecret }) => {
  app.addHook("onRequest", async (request, reply) => {
    const token = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "")
    const expected = Buffer.from(sharedSecret)
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" })
    }
  })
  app.post("/web-search/search", { bodyLimit: 8_192 }, async (request, reply) => {
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"])
    const body = bodySchema.parse(request.body)
    const controller = new AbortController()
    const abort = () => controller.abort()
    const abortOnClose = () => { if (!reply.raw.writableEnded) abort() }
    request.raw.once("aborted", abort)
    reply.raw.once("close", abortOnClose)
    try {
      return await service.search({ ownerId, ...body, signal: controller.signal })
    } finally {
      request.raw.off("aborted", abort)
      reply.raw.off("close", abortOnClose)
    }
  })
}
