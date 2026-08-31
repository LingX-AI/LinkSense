import { timingSafeEqual } from "node:crypto"

import { imageGenerationRequestSchema } from "@linksense/shared"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { z } from "zod"

import { AppError } from "../../lib/errors.js"
import type { ImageGenerationSettingsService } from "./image-generation-settings.js"

const ownerIdHeaderSchema = z.uuid()
const internalImageGenerationInputSchema = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
  request: imageGenerationRequestSchema,
})

export const internalImageGenerationRoutes: FastifyPluginAsync<{
  service: ImageGenerationSettingsService
  sharedSecret: string
}> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? ""
    if (!safeEqual(token, options.sharedSecret)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" })
    }
  })

  app.post("/image-generation/generate", async (request, reply) => {
    const ownerId = parseRunnerOwnerId(request)
    const body = internalImageGenerationInputSchema.parse(request.body)
    const controller = new AbortController()
    const abortRequest = () => controller.abort()
    const abortDisconnectedReply = () => {
      if (!reply.raw.writableEnded) controller.abort()
    }
    request.raw.once("aborted", abortRequest)
    reply.raw.once("close", abortDisconnectedReply)
    try {
      return reply.send(
        await options.service.generate({
          ownerId,
          conversationId: body.conversationId,
          turnId: body.turnId,
          request: body.request,
          signal: controller.signal,
        }),
      )
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError("IMAGE_GENERATION_UNAVAILABLE")
    } finally {
      request.raw.off("aborted", abortRequest)
      reply.raw.off("close", abortDisconnectedReply)
    }
  })
}

function parseRunnerOwnerId(request: FastifyRequest): string {
  return ownerIdHeaderSchema.parse(request.headers["x-linksense-owner-id"])
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}
