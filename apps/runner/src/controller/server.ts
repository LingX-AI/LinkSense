import { timingSafeEqual } from "node:crypto"

import Fastify, { type FastifyReply } from "fastify"
import { z } from "zod"
import { runtimeWorkspaceHeader, runtimeServiceSessionHeader, runtimeCleanupEnvironmentHeader, userWorkspacePathSchema } from "@linksense/shared"

import type { RunnerConfig } from "../config.js"
import { deriveKnowledgeSearchTimeouts } from "../knowledge-search-timeout.js"
import {
  reconcileBodySchema,
  startTurnBodySchema,
  stdioMcpProbeBodySchema,
} from "../server.js"
import { sanitizeZodIssues } from "../turn-start-contract.js"
import { ownerWorkerSecret } from "./storage-key.js"
import {
  WorkerContractVersionMismatchError,
  type WorkerManager,
} from "./worker-manager.js"
import { RuntimeCleanupError } from "../runtime-cleanup.js"

const uuid = z.uuid()

export function buildControllerServer(
  config: RunnerConfig,
  workers: WorkerManager,
) {
  const knowledgeSearchTimeouts = deriveKnowledgeSearchTimeouts(
    config.LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS,
  )
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 16 * 1024 * 1024,
  })

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health/live") return
    const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "")
    if (request.url.startsWith("/internal/")) {
      const ownerId = parseOwnerHeader(request.headers["x-linksense-owner-id"])
      const service = uuid.optional().safeParse(request.headers[runtimeServiceSessionHeader])
      if (
        !ownerId || !service.success ||
        !token ||
        !safeEqual(
          token,
          ownerWorkerSecret(ownerId, config.LINKSENSE_RUNNER_SHARED_SECRET, service.data),
        )
      ) {
        return reply.code(401).send({ error_code: "RUNNER_UNAUTHORIZED" })
      }
      return
    }
    if (!token || !safeEqual(token, config.LINKSENSE_RUNNER_SHARED_SECRET)) {
      return reply.code(401).send({ error_code: "RUNNER_UNAUTHORIZED" })
    }
  })

  app.addHook("preHandler", async (request, reply) => {
    const scope = uuid.optional().safeParse(request.headers[runtimeServiceSessionHeader])
    if (!scope.success) return reply.code(400).send({ error_code: "RUNNER_SERVICE_SCOPE_INVALID" })
    if (!scope.data) return
    if (request.url.startsWith("/internal/skill-creator/")) {
      return reply.code(403).send({ error_code: "RUNNER_SERVICE_SCOPE_MISMATCH" })
    }
  })

  app.get(
    "/health/live",
    { logLevel: "warn" },
    async () => ({ status: "available" }),
  )
  app.get(
    "/health/ready",
    { logLevel: "warn" },
    async (request, reply) => {
      const query = z.object({ include_resource_usage: z.literal("true").optional() }).safeParse(request.query)
      if (!query.success) return reply.code(400).send({ error_code: "INVALID_INPUT" })
      const result = await workers.health({ includeResourceUsage: query.data.include_resource_usage === "true" })
      return reply.code(result.statusCode).send({
        ...result.body,
        ...(config.LINKSENSE_RUNNER_INSTANCE_ID
          ? { runner_instance_id: config.LINKSENSE_RUNNER_INSTANCE_ID }
          : {}),
      })
    },
  )

  app.get("/model-catalog", async (_request, reply) => {
    const catalog = workers.getModelCatalog()
    return catalog
      ? reply.send(catalog)
      : reply
          .code(503)
          .send({ error_code: "CODEX_MODEL_CATALOG_UNAVAILABLE" })
  })

  if (config.LINKSENSE_ENABLE_DEVELOPMENT_ENDPOINTS) {
    app.post("/development/workers/stop-all", async (_request, reply) => {
      await workers.stopAllWorkers()
      return reply.code(204).send()
    })
  }

  app.post("/workers/prewarm", async (request, reply) => {
    const ownerId = parseOwnerHeader(request.headers["x-linksense-owner-id"])
    if (!ownerId) {
      return reply.code(403).send({ error_code: "RUNNER_OWNER_REQUIRED" })
    }
    try {
      await workers.prewarm(ownerId)
      return reply.code(204).send()
    } catch (error) {
      return sendWorkerTransportFailure(reply, error)
    }
  })

  app.post("/mcp/stdio/probe", async (request, reply) => {
    const ownerId = parseOwnerHeader(request.headers["x-linksense-owner-id"])
    const body = stdioMcpProbeBodySchema.safeParse(request.body)
    if (!ownerId || !body.success || body.data.ownerId !== ownerId) {
      return reply.code(400).send({ error_code: "MCP_STDIO_PROBE_INVALID" })
    }
    try {
      const response = await workers.request(
        ownerId,
        request.url,
        request.method,
        Buffer.from(JSON.stringify(body.data)),
        Math.min(body.data.timeoutMs + 10_000, 130_000),
      )
      return sendWorkerResponse(reply, response)
    } catch (error) {
      return sendWorkerTransportFailure(reply, error)
    }
  })

  for (const route of [
    "/internal/runner/heartbeat",
    "/internal/runner/events",
    "/internal/runner/memory-usage",
    "/internal/runner/process-exit",
    "/internal/file-service/register-artifact",
    "/internal/image-generation/generate",
    "/internal/knowledge/search",
    "/internal/knowledge/documents",
    "/internal/knowledge/document-markdown",
    "/internal/skill-creator/preview",
    "/internal/skill-creator/confirm",
    "/internal/current-user/info",
    "/internal/application-events/emit",
  ]) {
    app.post(route, async (request, reply) => {
      const ownerId = parseOwnerHeader(request.headers["x-linksense-owner-id"])
      if (!ownerId) {
        return reply.code(401).send({ error_code: "RUNNER_UNAUTHORIZED" })
      }
      const controller = new AbortController()
      const abortRequest = () => controller.abort()
      const abortDisconnectedReply = () => {
        if (!reply.raw.writableEnded) controller.abort()
      }
      request.raw.once("aborted", abortRequest)
      reply.raw.once("close", abortDisconnectedReply)
      try {
        return await proxyToApi(
          config,
          route,
          request.body,
          ownerId,
          reply,
          route.startsWith("/internal/knowledge/")
            ? knowledgeSearchTimeouts.apiProxyMs
            : route.startsWith("/internal/image-generation/")
              ? 180_000
            : route === "/internal/runner/process-exit"
              ? 130_000
            : 15_000,
          controller.signal,
          uuid.optional().parse(request.headers[runtimeServiceSessionHeader]),
        )
      } finally {
        request.raw.off("aborted", abortRequest)
        reply.raw.off("close", abortDisconnectedReply)
      }
    })
  }

  for (const route of [
    { method: "GET" as const, path: "/personalization" },
    { method: "PATCH" as const, path: "/personalization" },
    {
      method: "POST" as const,
      path: "/personalization/memories/reset",
    },
  ]) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (request, reply) => {
        const ownerId = parseOwnerHeader(
          request.headers["x-linksense-owner-id"],
        )
        if (!ownerId) {
          return reply
            .code(403)
            .send({ error_code: "RUNNER_OWNER_REQUIRED" })
        }
        const serialized =
          request.body === undefined
            ? undefined
            : Buffer.from(JSON.stringify(request.body))
        try {
          const response = await workers.request(
            ownerId,
            request.url,
            request.method,
            serialized,
            route.path.endsWith("/reset") ? 30_000 : undefined,
          )
          return sendWorkerResponse(reply, response)
        } catch (error) {
          return sendWorkerTransportFailure(reply, error)
        }
      },
    })
  }

  app.delete<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/runtime",
    async (request, reply) => {
      const ownerId = parseOwnerHeader(request.headers["x-linksense-owner-id"])
      const conversationId = uuid.safeParse(request.params.conversationId)
      if (!ownerId || !conversationId.success) {
        return reply
          .code(403)
          .send({ error_code: "RUNNER_OWNER_REQUIRED" })
      }
      try {
        return sendWorkerResponse(
          reply,
          await workers.cleanupConversation(ownerId, conversationId.data, uuid.optional().parse(request.headers[runtimeServiceSessionHeader]), z.literal("true").optional().parse(request.headers[runtimeCleanupEnvironmentHeader]) === "true"),
        )
      } catch (error) {
        if (error instanceof RuntimeCleanupError) {
          return reply.code(503).send({
            error_code: error.reasonCode,
            cleanup_stage: error.stage,
          })
        }
        return sendWorkerTransportFailure(reply, error)
      }
    },
  )

  app.all("/conversations/*", async (request, reply) => {
    const ownerId = parseOwnerHeader(request.headers["x-linksense-owner-id"])
    if (!ownerId) {
      return reply.code(403).send({ error_code: "RUNNER_OWNER_REQUIRED" })
    }
    const conversationMatch = request.url.match(
      /^\/conversations\/([0-9a-f-]{36})(?:\/|$)/iu,
    )
    if (!conversationMatch || !uuid.safeParse(conversationMatch[1]).success) {
      return reply.code(404).send({ error_code: "RUNNER_ROUTE_NOT_FOUND" })
    }

    let body = request.body
    const isStartRequest =
      request.method === "POST" && /\/turns\/start(?:\?|$)/u.test(request.url)
    const isReconcileRequest =
      request.method === "POST" && /\/reconcile(?:\?|$)/u.test(request.url)
    if (
      !isStartRequest &&
      body &&
      typeof body === "object" &&
      "ownerId" in body &&
      (body as { ownerId?: unknown }).ownerId !== ownerId
    ) {
      return reply.code(403).send({ error_code: "RUNNER_OWNER_MISMATCH" })
    }
    if (isStartRequest) {
      const parsedStart = startTurnBodySchema.safeParse(body)
      if (!parsedStart.success) {
        request.log.warn(
          {
            requestId: request.id,
            conversationId: conversationMatch[1],
            phase: "controller-input",
            issues: sanitizeZodIssues(parsedStart.error),
          },
          "runner turn-start validation failed",
        )
        return reply
          .code(400)
          .send({ error_code: "RUNNER_TURN_START_INVALID" })
      }
      const start = parsedStart.data
      if (start.ownerId !== ownerId) {
        return reply.code(403).send({ error_code: "RUNNER_OWNER_MISMATCH" })
      }
      body = start
    } else if (isReconcileRequest) {
      const parsedRecovery = reconcileBodySchema.safeParse(body)
      if (!parsedRecovery.success) {
        request.log.warn(
          {
            requestId: request.id,
            conversationId: conversationMatch[1],
            phase: "controller-reconcile-input",
            issues: sanitizeZodIssues(parsedRecovery.error),
          },
          "runner recovery validation failed",
        )
        return reply
          .code(400)
          .send({ error_code: "RUNNER_RECOVERY_INVALID" })
      }
      const recovery = parsedRecovery.data
      if (recovery.ownerId !== ownerId) {
        return reply.code(403).send({ error_code: "RUNNER_OWNER_MISMATCH" })
      }
      body = recovery
    }
    const workspace = userWorkspacePathSchema.optional().safeParse(request.headers[runtimeWorkspaceHeader])
    if (!workspace.success) return reply.code(400).send({ error_code: "RUNNER_WORKSPACE_INVALID" })
    const serialized = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    try {
      const response = await workers.request(
        ownerId,
        request.url,
        request.method,
        serialized,
        request.url.endsWith("/reconcile") ? 110_000 : undefined,
        workspace.data,
        uuid.optional().parse(request.headers[runtimeServiceSessionHeader]),
      )
      return sendWorkerResponse(reply, response)
    } catch (error) {
      return sendWorkerTransportFailure(reply, error)
    }
  })

  return app
}

async function proxyToApi(
  config: RunnerConfig,
  requestPath: string,
  body: unknown,
  ownerId: string,
  reply: FastifyReply,
  timeoutMs: number,
  callerSignal?: AbortSignal,
  serviceSessionId?: string,
) {
  let response: Response
  try {
    response = await fetch(new URL(requestPath, config.LINKSENSE_API_INTERNAL_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
        "content-type": "application/json",
        ...(serviceSessionId ? { [runtimeServiceSessionHeader]: serviceSessionId } : {}),
        "x-linksense-owner-id": ownerId,
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(callerSignal ? [callerSignal] : []),
      ]),
    })
  } catch {
    return reply.code(503).send({ error_code: "RUNNER_UNAVAILABLE" })
  }
  const responseBody = Buffer.from(await response.arrayBuffer())
  const contentType = response.headers.get("content-type")
  if (contentType) reply.header("content-type", contentType)
  return reply.code(response.status).send(responseBody)
}

function sendWorkerResponse(
  reply: FastifyReply,
  response: {
    statusCode: number
    headers: Record<string, string>
    body: Buffer
  },
) {
  const contentType = response.headers["content-type"]
  if (contentType) reply.header("content-type", contentType)
  return reply.code(response.statusCode).send(response.body)
}

function sendWorkerTransportFailure(reply: FastifyReply, error: unknown) {
  return reply.code(503).send({
    error_code:
      error instanceof WorkerContractVersionMismatchError
        ? "RUNNER_CONTRACT_MISMATCH"
        : "RUNNER_UNAVAILABLE",
  })
}

function parseOwnerHeader(value: string | string[] | undefined): string | undefined {
  const parsed = uuid.safeParse(Array.isArray(value) ? value[0] : value)
  return parsed.success ? parsed.data : undefined
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}
