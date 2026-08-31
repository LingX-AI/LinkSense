import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { z } from "zod"

import {
  attachmentContentDisposition,
  inlineContentDisposition,
} from "../../lib/content-disposition.js"
import { sseCorsHeaders } from "../../lib/cors.js"
import { AppError } from "../../lib/errors.js"
import { ok } from "../../lib/http.js"
import type { KnowledgeCitationReadService } from "./citation-read.js"
import type { ResolveKnowledgeActor } from "./types.js"

const citationParamsSchema = z.strictObject({ citationId: z.string().uuid() })
const citationAssetParamsSchema = z.strictObject({
  citationId: z.string().uuid(),
  assetId: z.string().uuid(),
})
const emptyQuerySchema = z.strictObject({})

export const knowledgeCitationRoutes: FastifyPluginAsync<{
  service: KnowledgeCitationReadService
  publicBaseUrl: string
  resolveActor?: ResolveKnowledgeActor
}> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver

  app.get("/:citationId", async (request, reply) => {
    const actor = await actorFor(request)
    const { citationId } = citationParamsSchema.parse(request.params)
    emptyQuerySchema.parse(request.query)
    const citation = await options.service.resolve(actor, citationId)
    return reply
      .header("cache-control", "private, no-store")
      .send(ok(citation, request))
  })

  app.get("/:citationId/events", async (request, reply) => {
    const actor = await actorFor(request)
    const { citationId } = citationParamsSchema.parse(request.params)
    emptyQuerySchema.parse(request.query)
    const controller = new AbortController()
    request.raw.once("close", () => controller.abort())
    const events = options.service.subscribeEvents(
      actor,
      citationId,
      controller.signal,
    )
    reply.hijack()
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...sseCorsHeaders(request.headers.origin, options.publicBaseUrl),
    })
    reply.raw.flushHeaders()
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed && !reply.raw.writableNeedDrain) {
        reply.raw.write(": keepalive\n\n")
      }
    }, 15_000)
    heartbeat.unref()
    try {
      for await (const event of events) {
        if (controller.signal.aborted || reply.raw.destroyed) break
        const written = reply.raw.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        if (!written) await waitForDrain(reply.raw, controller.signal)
      }
    } finally {
      clearInterval(heartbeat)
      if (!reply.raw.destroyed) reply.raw.end()
    }
  })

  app.get("/:citationId/original", async (request, reply) => {
    const actor = await actorFor(request)
    const { citationId } = citationParamsSchema.parse(request.params)
    emptyQuerySchema.parse(request.query)
    const original = await options.service.getOriginalPreview(actor, citationId)
    reply.raw.once("close", () => original.stream.destroy())
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("content-length", original.sizeBytes.toString())
      .header("content-disposition", inlineContentDisposition(original.filename))
      .type(original.mimeType)
      .send(original.stream)
  })

  app.get("/:citationId/download", async (request, reply) => {
    const actor = await actorFor(request)
    const { citationId } = citationParamsSchema.parse(request.params)
    emptyQuerySchema.parse(request.query)
    const original = await options.service.downloadOriginal(actor, citationId)
    reply.raw.once("close", () => original.stream.destroy())
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-length", original.sizeBytes.toString())
      .header(
        "content-disposition",
        attachmentContentDisposition(original.filename),
      )
      .type(original.mimeType)
      .send(original.stream)
  })

  app.get("/:citationId/assets/:assetId", async (request, reply) => {
    const actor = await actorFor(request)
    const { citationId, assetId } = citationAssetParamsSchema.parse(
      request.params,
    )
    emptyQuerySchema.parse(request.query)
    const asset = await options.service.getAsset(actor, citationId, assetId)
    reply.raw.once("close", () => asset.stream.destroy())
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("content-length", asset.sizeBytes.toString())
      .header("content-disposition", inlineContentDisposition(asset.filename))
      .type(asset.mimeType)
      .send(asset.stream)
  })
}

function waitForDrain(
  response: {
    once(event: "drain" | "close", listener: () => void): unknown
    off(event: "drain" | "close", listener: () => void): unknown
  },
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => {
      response.off("drain", settle)
      response.off("close", settle)
      signal.removeEventListener("abort", settle)
      resolve()
    }
    response.once("drain", settle)
    response.once("close", settle)
    signal.addEventListener("abort", settle, { once: true })
  })
}

async function defaultActorResolver(request: FastifyRequest) {
  if (!request.authUser) throw new AppError("AUTH_REQUIRED")
  return {
    id: request.authUser.id,
    role: request.authUser.role,
    status: request.authUser.status,
    ipAddress: request.ip,
    ...(request.headers["user-agent"]
      ? { userAgent: request.headers["user-agent"] }
      : {}),
  }
}
