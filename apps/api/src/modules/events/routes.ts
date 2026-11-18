import { timingSafeEqual } from "node:crypto"

import {
  conversationEventSchema,
  runnerMemoryUsageCaptureSchema,
  runnerPrivacyMaskingCaptureSchema,
  runnerEventBatchSchema,
  publicKnowledgeRunnerProgressSchema,
  runnerHeartbeatSchema,
  runnerStartSettledSchema,
  runtimeServiceSessionHeader,
  type ConversationEvent,
  imagePreviewRegistrationSchema,
} from "@linksense/shared"
import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { z } from "zod"

import { sseCorsHeaders } from "../../lib/cors.js"
import { AppError } from "../../lib/errors.js"
import { ok } from "../../lib/http.js"
import type { AuthenticatedRequest } from "../../plugins/authentication.js"
import type { AppServices } from "../../services.js"
import { createReplayPump } from "./replay-pump.js"
import { projectRunnerEventBatch } from "./runner-batch.js"

const interactiveApplicationCustomEventSchema = z.strictObject({
  conversationId: z.uuid(),
  codexTurnId: z.string().min(1).max(240),
  name: z.string().min(1).max(120),
  payload: z.json(),
})

const artifactSchema = z.strictObject({
  conversationId: z.string().uuid(),
  turnId: z.string().min(1),
  workspaceRelativePath: z.string().min(1).max(2_000),
  displayName: z.string().min(1).max(260),
  mimeType: z.string().max(160).optional(),
  artifactKind: z.string().max(80).optional(),
  webRootRelativePath: z.string().min(1).max(2_000).optional(),
})

const processExitSchema = z.strictObject({
  conversationId: z.uuid(),
  projectionTurnId: z.uuid(),
  capabilityGeneration: z.string().regex(/^[a-f0-9]{64}$/u),
})
const ownerIdHeaderSchema = z.uuid()

export const internalRunnerRoutes: FastifyPluginAsync<{ services: AppServices }> =
  async (app, { services }) => {
    app.addHook("onRequest", async (request, reply) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? ""
      if (!safeEqual(token, services.config.runnerSharedSecret)) {
        return reply.code(401).send({ error_code: "AUTH_REQUIRED" })
      }
    })

    app.post("/runner/heartbeat", async (request, reply) => {
      const ownerId = parseRunnerOwnerId(request)
      const body = runnerHeartbeatSchema.parse(request.body)
      await services.events.recordRunnerHeartbeat(ownerId, body, z.uuid().optional().parse(request.headers[runtimeServiceSessionHeader]))
      return reply.send(ok({ confirmed: true }, request.id))
    })

    app.post("/runner/start-settled", async (request, reply) => {
      const ownerId = parseRunnerOwnerId(request)
      const body = runnerStartSettledSchema.parse(request.body)
      await services.conversations.assertOwner(ownerId, body.conversationId)
      const settled = await services.conversations.settleStartOperation(ownerId, body)
      return reply.send(ok({ settled }, request.id))
    })

    app.post("/runner/events", async (request, reply) => {
      const body = runnerEventBatchSchema.parse(request.body)
      const ownerId = parseRunnerOwnerId(request)
      if (body.events.some(({ event }) => "method" in event && event.method === "linksense/publicKnowledge/progress")) {
        const session = request.headers[runtimeServiceSessionHeader];
        if (session !== undefined && session !== ownerId) throw new AppError("FORBIDDEN");
        const entries = body.events.map(({ deliveryId, event }) => ({ deliveryId, event: publicKnowledgeRunnerProgressSchema.parse(event) }));
        await services.publicKnowledge.ingestRunnerEvents(ownerId, body.conversationId, entries);
        return reply.send(ok({ accepted_delivery_ids: entries.map(({ deliveryId }) => deliveryId) }, request.id));
      }
      await services.conversations.assertOwner(ownerId, body.conversationId)
      const acceptedDeliveryIds = await projectRunnerEventBatch(body.events,
        async (entry, textEntries) => {
          if (request.raw.aborted || reply.raw.destroyed) return false
          const result = textEntries.length > 1
            ? await services.events.ingestTextDeltaBatch(body.conversationId, textEntries)
            : await services.events.ingest(body.conversationId, entry.event, entry.deliveryId)
          return result.accepted === true
        },
        (error, deliveryId) => request.log.error({
            conversationId: body.conversationId,
            deliveryId,
            errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        }, "runner event batch stopped before acknowledgement"),
      )
      return reply.send(ok({ accepted_delivery_ids: acceptedDeliveryIds }, request.id))
    })

    app.post("/application-events/emit", async (request, reply) => {
      const body = interactiveApplicationCustomEventSchema.parse(request.body)
      const ownerId = parseRunnerOwnerId(request)
      return reply.send(
        ok(
          await services.events.emitInteractiveApplicationCustomEvent({
            ownerId,
            conversationId: body.conversationId,
            codexTurnId: body.codexTurnId,
            event: { name: body.name, payload: body.payload },
          }),
          request.id,
        ),
      )
    })

    app.post("/runner/process-exit", async (request, reply) => {
      const body = processExitSchema.parse(request.body)
      const ownerId = parseRunnerOwnerId(request)
      await services.conversations.assertOwner(ownerId, body.conversationId)
      const recovery = await services.events
        .reconcileAfterProcessExit(body)
        .catch(async () => {
          await services.events.scheduleProcessExitRecovery(body).catch(() => {
            request.log.warn({ conversationId: body.conversationId }, "Process-exit recovery dispatch failed")
          })
          throw new AppError("RUNNER_UNAVAILABLE")
        })
      if (recovery.outcome === "failed") {
        await services.events.scheduleProcessExitRecovery(body).catch(() => {
          request.log.warn({ conversationId: body.conversationId }, "Process-exit recovery dispatch failed")
        })
        throw new AppError("RUNNER_UNAVAILABLE")
      }
      return reply.send(
        ok(
          { confirmed: true, outcome: recovery.outcome },
          request.id,
        ),
      )
    })

    app.post("/runner/memory-usage", async (request, reply) => {
      const body = runnerMemoryUsageCaptureSchema.parse(request.body)
      const ownerId = parseRunnerOwnerId(request)
      if (body.owner_id !== ownerId) {
        throw new AppError("FORBIDDEN")
      }
      const result = await services.usageAnalytics.recordModelUsage({
        requestId: body.request_id,
        ownerId: body.owner_id,
        conversationId: body.conversation_id,
        operation: body.operation,
        workload: "memory_generation",
        modelKind: "generation",
        model: body.model,
        measurementMethod: body.measurement_method,
        tokenUsage: {
          totalTokens: body.token_usage.total_tokens,
          inputTokens: body.token_usage.input_tokens,
          cachedInputTokens: body.token_usage.cached_input_tokens,
          outputTokens: body.token_usage.output_tokens,
          reasoningOutputTokens:
            body.token_usage.reasoning_output_tokens,
        },
        pricing: body.pricing,
        observedAt: new Date(body.observed_at),
      })
      return reply.send(ok(result, request.id))
    })

    app.post("/runner/privacy-masking", async (request, reply) => {
      const ownerId = parseRunnerOwnerId(request)
      const body = runnerPrivacyMaskingCaptureSchema.parse(request.body)
      if (body.owner_id !== ownerId) {
        throw new AppError("FORBIDDEN")
      }
      await services.privacyMaskingActivity.record(body)
      return reply.send(ok({ recorded: true }, request.id))
    })

    app.post("/image-previews", async (request, reply) => {
      const body = imagePreviewRegistrationSchema.parse(request.body)
      const ownerId = parseRunnerOwnerId(request)
      return reply.send(await services.files.registerImagePreview({ ...body, ownerId }))
    })

    app.post("/file-service/register-artifact", async (request, reply) => {
      const body = artifactSchema.parse(request.body)
      const ownerId = parseRunnerOwnerId(request)
      await services.conversations.assertOwner(ownerId, body.conversationId)
      const result = await services.files.registerArtifact({
        ownerId,
        conversationId: body.conversationId,
        codexTurnId: body.turnId,
        workspaceRelativePath: body.workspaceRelativePath,
        displayName: body.displayName,
        ...(body.mimeType ? { mimeType: body.mimeType } : {}),
        ...(body.artifactKind ? { artifactKind: body.artifactKind } : {}),
        ...(body.webRootRelativePath ? { webRootRelativePath: body.webRootRelativePath } : {}),
      })
      return reply.send(result)
    })
  }

function parseRunnerOwnerId(request: FastifyRequest): string {
  return ownerIdHeaderSchema.parse(request.headers["x-linksense-owner-id"])
}

export const sseRoutes: FastifyPluginAsync<{ services: AppServices }> = async (
  app,
  { services },
) => {
  app.get(
    "/:id/events/history",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser
      const { id } = z.strictObject({ id: z.string().uuid() }).parse(request.params)
      const query = z.strictObject({
        cursor: z.string().min(1).max(160).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }).parse(request.query)
      const afterSequence = parseSequence(id, query.cursor)
      if (query.cursor && afterSequence === null) {
        throw new z.ZodError([{
          code: "custom",
          path: ["cursor"],
          message: "invalid_event_cursor",
          input: query.cursor,
        }])
      }
      const page = await services.events.historyPage(user.id, id, {
        afterSequence: afterSequence ?? 0n,
        limit: query.limit,
      })
      return reply.send(ok({
        items: page.items,
        next_cursor: page.next_cursor,
      }, request.id))
    },
  )

  app.get(
    "/:id/events",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser
      const { id } = z.strictObject({ id: z.string().uuid() }).parse(request.params)
      const lastEventId = request.headers["last-event-id"]
      const query = z.strictObject({
        last_event_id: z.string().max(160).optional(),
      }).parse(request.query)
      const after = parseSequence(
        id,
        typeof lastEventId === "string" ? lastEventId : query.last_event_id,
      ) ?? 0n
      await services.events.assertOwner(user.id, id)
      const subscriber = services.redis.duplicate()
      await subscriber.connect()

      const channel = `linksense:conversation-events:${id}`
      let heartbeat: NodeJS.Timeout | null = null
      const response = reply.raw

      const pump = createReplayPump({
        conversationId: id,
        initialSequence: after,
        pageSize: SSE_HISTORY_PAGE_SIZE,
        gapRetryDelaysMs: SSE_REPLAY_GAP_RETRY_DELAYS_MS,
        loadPage: ({ afterSequence, limit }) =>
          services.events.historyPage(user.id, id, { afterSequence, limit }),
        writeEvent: (event) => writeEventWithBackpressure(response, event),
        isDestroyed: () => response.destroyed,
        closeStream: (destroy) => {
          if (heartbeat) clearInterval(heartbeat)
          void closeSubscriber(subscriber, channel)
          if (destroy && !response.destroyed) response.destroy()
        },
        logWarn: (details, message) => request.log.warn(details, message),
        logMessages: {
          replayFailed: "conversation SSE replay failed",
          projectionBehind:
            "conversation SSE replay projection remained behind",
        },
      })

      const onMessage = (_channel: string, value: string) => {
        try {
          const parsed = conversationEventSchema.safeParse(JSON.parse(value))
          if (!parsed.success || parsed.data.conversation_id !== id) return
          pump.observe(BigInt(parsed.data.sequence_no))
        } catch {
          // Ignore malformed fan-out data; persisted events remain replayable.
        }
      }
      subscriber.on("message", onMessage)
      await subscriber.subscribe(channel)

      reply.hijack()
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        ...sseCorsHeaders(
          request.headers.origin,
          services.config.publicBaseUrl,
        ),
      })
      response.flushHeaders()
      pump.markReady()
      heartbeat = setInterval(() => {
        if (pump.isClosed()) return
        if (!response.writableNeedDrain && !response.destroyed) {
          response.write(": keepalive\n\n")
        }
        // Redis fan-out is a wake-up signal, not the durable event source.
        // Replay on heartbeat so a missed notification cannot stall an open stream.
        pump.wake()
      }, 15_000)
      heartbeat.unref()
      response.once("close", () => pump.close())
      pump.wake()
    },
  )
}

const SSE_HISTORY_PAGE_SIZE = 250
const SSE_REPLAY_GAP_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const

function parseSequence(conversationId: string, eventId?: string): bigint | null {
  if (!eventId) return 0n
  const prefix = `${conversationId}:`
  if (!eventId.startsWith(prefix)) return null
  const value = eventId.slice(prefix.length)
  if (!/^\d+$/u.test(value)) return null
  try {
    const sequence = BigInt(value)
    return sequence >= 0n ? sequence : null
  } catch {
    return null
  }
}

async function writeEventWithBackpressure(
  response: {
    destroyed: boolean
    write(chunk: string): boolean
    once(event: "drain" | "close", listener: () => void): unknown
    off(event: "drain" | "close", listener: () => void): unknown
  },
  event: ConversationEvent,
): Promise<boolean> {
  if (response.destroyed) return false
  const accepted = response.write(
    `id: ${event.sse_event_id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`,
  )
  if (accepted) return true
  return new Promise<boolean>((resolve) => {
    const settle = (written: boolean) => {
      response.off("drain", onDrain)
      response.off("close", onClose)
      resolve(written)
    }
    const onDrain = () => settle(!response.destroyed)
    const onClose = () => settle(false)
    response.once("drain", onDrain)
    response.once("close", onClose)
  })
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  )
}

async function closeSubscriber(
  subscriber: {
    unsubscribe(channel: string): Promise<unknown>
    quit(): Promise<unknown>
  },
  channel: string,
): Promise<void> {
  await subscriber.unsubscribe(channel).catch(() => undefined)
  await subscriber.quit().catch(() => undefined)
}

export const eventRouteTesting = {
  closeSubscriber,
  parseSequence,
  writeEventWithBackpressure,
}
