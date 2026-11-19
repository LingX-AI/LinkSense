import { timingSafeEqual } from "node:crypto"
import path from "node:path"
import Fastify from "fastify"
import {
  browserUseFailure, browserUseRequestSchema, desktopArtifactMaxBytes, desktopArtifactPrepareSchema,
  desktopArtifactUploadLifetimeMs, desktopBrowserScreenshotMaxBytes, desktopBrowserScreenshotPath,
  desktopConnectionRequestBodySchema, desktopExecutionMaxFrameBytes, errorCatalog, internalKnowledgeDocumentListRequestSchema,
  internalKnowledgeDocumentMarkdownRequestSchema, internalKnowledgeSearchRequestSchema,
  runnerEventBatchSchema, runnerHeartbeatSchema, runnerStartSettledSchema, webSearchRequestSchema,
  type DesktopToolResult,
} from "@linksense/shared"
import { z } from "zod"
import { desktopWorkerSecret } from "../controller/desktop-worker-provider.js"
import { acknowledgedEventCount } from "../event-sink.js"
import { FileServiceRequestError } from "../file-service-error.js"
import { openDesktopArtifactSource, type DesktopArtifactSource } from "./artifact-source.js"
import { uploadDesktopArtifact } from "./artifact-upload.js"
import type { DesktopLink, DesktopToolInvocation } from "./link.js"
import type { DesktopTurns } from "./turns.js"

// Bound the whole local transfer even when a worker stops responding.
const desktopArtifactTimeoutMs = desktopArtifactUploadLifetimeMs + 10_000

const workerIdentity = z.strictObject({ ownerId: z.uuid(), conversationId: z.uuid() })
const processExit = runnerStartSettledSchema.pick({ conversationId: true }).extend({
  projectionTurnId: z.uuid(), capabilityGeneration: z.string().regex(/^[a-f0-9]{64}$/u),
})

async function whileResponseOpen<T>(
  response: import("node:http").ServerResponse, work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  // A POST request can close normally as soon as its body has been read.
  const controller = new AbortController()
  const onClose = () => { if (!response.writableEnded) controller.abort() }
  response.once("close", onClose)
  try {
    if (response.destroyed) controller.abort()
    return await work(controller.signal)
  } finally {
    response.off("close", onClose)
  }
}

async function readScreenshot(response: Response): Promise<Buffer | null> {
  const length = Number(response.headers.get("content-length"))
  if (!response.ok || response.headers.get("content-type") !== "image/jpeg" ||
      !Number.isSafeInteger(length) || length < 1 || length > desktopBrowserScreenshotMaxBytes || !response.body) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body.getReader()
  const bytes = Buffer.alloc(length)
  let offset = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return offset === length ? bytes : null
      if (value.length > length - offset) {
        await reader.cancel()
        return null
      }
      bytes.set(value, offset)
      offset += value.length
    }
  } finally {
    reader.releaseLock()
  }
}

export function desktopWorkerCallbacks(
  localSecret: string,
  current: () => { link: DesktopLink; turns: DesktopTurns } | undefined,
  serverOrigin: string,
) {
  const app = Fastify({ logger: false, bodyLimit: desktopExecutionMaxFrameBytes, requestTimeout: 10_000 })
  const authenticate = (headers: Record<string, unknown>) => {
    const identity = workerIdentity.parse({
      ownerId: headers["x-linksense-owner-id"], conversationId: headers["x-linksense-service-session"],
    })
    const state = current()
    const run = state?.turns.scopedRun(identity.conversationId)
    if (!state || !run || identity.ownerId !== run.scope.owner_id) throw new Error("worker scope unavailable")
    const expected = Buffer.from(`Bearer ${desktopWorkerSecret(identity.ownerId, localSecret, identity.conversationId, {
      turnId: run.scope.turn_id, runtimeGeneration: run.scope.runtime_generation,
    })}`)
    const actual = typeof headers.authorization === "string" ? Buffer.from(headers.authorization) : Buffer.alloc(0)
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new Error("worker scope unavailable")
    return { ...state, run }
  }
  app.setErrorHandler((_error, _request, reply) => {
    return reply.code(503).send({ error_code: "RUNNER_UNAVAILABLE" })
  })
  app.post("/internal/runner/heartbeat", async request => {
    authenticate(request.headers)
    runnerHeartbeatSchema.parse(request.body)
    return { data: { confirmed: true } }
  })
  app.post("/internal/runner/attachments-ready", async (request, reply) => {
    const { run } = authenticate(request.headers)
    const body = runnerStartSettledSchema.parse(request.body)
    if (!run.confirmAttachments || body.conversationId !== run.scope.conversation_id ||
      body.projectionTurnId !== run.scope.turn_id || body.runtimeGeneration !== run.scope.runtime_generation) {
      throw new Error("desktop attachment scope unavailable")
    }
    const confirm = run.confirmAttachments
    const expiresAt = await whileResponseOpen(reply.raw, signal => confirm(signal))
    return { confirmed: true, expiresAt }
  })
  app.post("/internal/runner/start-settled", async (request, reply) => {
    const { link, turns, run } = authenticate(request.headers)
    const body = runnerStartSettledSchema.parse(request.body)
    if (body.conversationId !== run.scope.conversation_id ||
      body.projectionTurnId !== run.scope.turn_id || body.runtimeGeneration !== run.scope.runtime_generation) {
      throw new Error("desktop start scope unavailable")
    }
    const status = await turns.inspectRun(run)
    if (status?.status === "failed") {
      reply.raw.once("finish", () => turns.finishAfterAcknowledgement(run))
    }
    const receipt = await link.callback(run, "start.settled", body)
    if (!receipt.ok || receipt.operation !== "start.settled") throw new Error("desktop start projection pending")
    return { data: receipt.data }
  })
  app.post("/internal/runner/events", async (request, reply) => {
    const { link, turns, run } = authenticate(request.headers)
    const body = runnerEventBatchSchema.parse(request.body)
    if (body.conversationId !== run.scope.conversation_id) {
      throw new Error("desktop event scope unavailable")
    }
    const terminalIndex = body.events.findIndex(({ event }) => "method" in event &&
      event.method === "turn/completed" && event.params.turn.status !== "inProgress")
    if (terminalIndex !== -1) {
      const event = body.events[terminalIndex]?.event
      const start = await turns.inspectRun(run)
      if (!event || !("method" in event) || event.method !== "turn/completed" || start?.status !== "succeeded" ||
        start.result.codexTurnId !== event.params.turn.id || start.result.codexThreadId !== event.params.threadId) {
        throw new Error("desktop terminal event has no matching native start")
      }
    }
    const receipt = await link.callback(run, "events", body)
    if (!receipt.ok || receipt.operation !== "events") throw new Error("desktop event delivery pending")
    const acceptedCount = acknowledgedEventCount(body.events, receipt.data.accepted_delivery_ids)
    if (terminalIndex !== -1 && terminalIndex < acceptedCount) {
      // Worker shutdown drains its durable outbox after the response releases its delivery wait.
      reply.raw.once("finish", () => turns.finishAfterAcknowledgement(run))
    }
    return { data: receipt.data }
  })
  app.post("/internal/runner/process-exit", async (request, reply) => {
    const { link, turns, run } = authenticate(request.headers)
    const body = processExit.parse(request.body)
    if (body.conversationId !== run.scope.conversation_id || body.projectionTurnId !== run.scope.turn_id) {
      throw new Error("desktop process exit scope unavailable")
    }
    // The app-server has stopped; retire its wrapper before reading the journal.
    reply.raw.once("finish", () => turns.finishAfterAcknowledgement(run, () => link.reportTurnExit(run)))
    return { data: { confirmed: true, outcome: "not_applicable" } }
  })
  const artifactRequest = z.strictObject({
    conversationId: z.uuid(), turnId: z.uuid(),
    workspaceRelativePath: z.string().min(1).max(2_000),
    displayName: z.string().min(1).max(260),
    mimeType: z.string().max(160).optional(),
    // Accepted only so the rejection is explicit; Mac has no website snapshot.
    webRootRelativePath: z.string().min(1).max(2_000).optional(),
  })
  app.post("/internal/file-service/register-artifact", { bodyLimit: 16_384 }, async (request, reply) => {
    const { link, run } = authenticate(request.headers)
    const parsed = artifactRequest.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: "ARTIFACT_REGISTRATION_INVALID", retryable: false })
    const body = parsed.data
    if (body.conversationId !== run.scope.conversation_id || body.turnId !== run.scope.turn_id) {
      return reply.code(403).send({ code: "FILE_SERVICE_FORBIDDEN", retryable: false })
    }
    // Reject before touching the filesystem: desktop artifacts are single files.
    if (body.webRootRelativePath) return reply.code(400).send({ code: "ARTIFACT_REGISTRATION_INVALID", retryable: false })
    const artifacts = run.artifacts
    if (!artifacts) return reply.code(403).send({ code: "FILE_SERVICE_FORBIDDEN", retryable: false })
    try {
      return await whileResponseOpen(reply.raw, async signal => {
        const lifetime = AbortSignal.any([
          signal, link.signal, artifacts.signal, AbortSignal.timeout(desktopArtifactTimeoutMs),
        ])
        let source: DesktopArtifactSource | undefined
        try {
          source = await openDesktopArtifactSource(artifacts.workspace, body.workspaceRelativePath, desktopArtifactMaxBytes, lifetime, artifacts.check)
          const prepared = desktopArtifactPrepareSchema.safeParse({
            filename: path.posix.basename(body.workspaceRelativePath),
            display_name: body.displayName,
            ...(body.mimeType ? { mime_type: body.mimeType } : {}),
            size_bytes: source.sizeBytes,
            sha256: source.sha256,
          })
          if (!prepared.success) throw invalidArtifact()
          const grant = await link.requestTool(run, { operation: "artifact.prepare", body: prepared.data }, lifetime)
          if (!grant.ok) throw artifactToolFailure(grant)
          if (grant.operation !== "artifact.prepare") {
            throw new FileServiceRequestError("ARTIFACT_REGISTRATION_UNAVAILABLE", true, 503)
          }
          return await uploadDesktopArtifact({
            origin: serverOrigin, turnId: run.scope.turn_id, runToken: run.token, source, grant: grant.data, signal: lifetime,
          })
        } finally {
          if (source) await source.close().catch(() => undefined)
        }
      })
    } catch (error) {
      const failure = artifactFailure(error)
      return reply.code(failure.statusCode).send({
        code: failure.code, retryable: failure.retryable,
        ...(failure.artifactId && { artifact_id: failure.artifactId }),
      })
    }
  })
  const toolScope = z.strictObject({ conversationId: z.uuid(), turnId: z.uuid() })
  const registerTool = <T extends z.infer<typeof toolScope>>(
    path: string, schema: z.ZodType<T>, invoke: (body: T) => DesktopToolInvocation, bodyLimit = 8_192,
  ) => {
    app.post(path, { bodyLimit }, async (request, reply) => {
      const { link, run } = authenticate(request.headers)
      const body = schema.safeParse(request.body)
      if (!body.success) return reply.code(400).send({ error_code: "VALIDATION_ERROR" })
      if (body.data.conversationId !== run.scope.conversation_id || body.data.turnId !== run.scope.turn_id) {
        return reply.code(403).send({ error_code: "FORBIDDEN" })
      }
      return whileResponseOpen(reply.raw, async signal => {
        const result = await link.requestTool(run, invoke(body.data), signal)
        if (result.ok) {
          if (result.operation === "browser.execute") {
            const { result: browser, screenshot_id } = result.data
            if (!browser.ok || !screenshot_id) return browser
            const response = await fetch(new URL(`${desktopBrowserScreenshotPath}/${run.scope.turn_id}/${screenshot_id}`, serverOrigin), {
              headers: { authorization: `Bearer ${run.token}`, "accept-encoding": "identity" },
              signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
              redirect: "error",
              cache: "no-store",
            })
            const bytes = await readScreenshot(response)
            if (!bytes) return browserUseFailure("BROWSER_USE_COMMAND_FAILED")
            if (signal.aborted || current()?.turns.scopedRun(run.scope.conversation_id) !== run)
              return browserUseFailure("BROWSER_USE_CANCELLED")
            return { ...browser, data: { ...browser.data, image: bytes.toString("base64") } }
          }
          return result.data
        }
        return reply.code(errorCatalog[result.error_code].http_status).send({ error_code: result.error_code })
      })
    })
  }
  registerTool("/internal/web-search/search", toolScope.extend({ request: webSearchRequestSchema }),
    ({ request }) => ({ operation: "web.search", body: request }))
  registerTool("/internal/knowledge/search", internalKnowledgeSearchRequestSchema,
    ({ query, finalTopK, candidateMultiplier, numCandidates, minScore }) => ({
    operation: "knowledge.search",
    body: { query, final_top_k: finalTopK, candidate_multiplier: candidateMultiplier, num_candidates: numCandidates, min_score: minScore },
  }), desktopExecutionMaxFrameBytes)
  registerTool("/internal/knowledge/documents", internalKnowledgeDocumentListRequestSchema,
    ({ cursor }) => ({ operation: "knowledge.documents", body: { cursor } }))
  registerTool("/internal/knowledge/document-markdown", internalKnowledgeDocumentMarkdownRequestSchema,
    ({ cursor, documentRef }) => ({ operation: "knowledge.markdown", body: { cursor, document_ref: documentRef } }))
  registerTool("/internal/connections/execute", toolScope.extend({ request: desktopConnectionRequestBodySchema }),
    ({ request }) => ({ operation: "connection.execute", body: request }), 40_000)
  registerTool("/internal/browser-use/execute", toolScope.extend({ input: browserUseRequestSchema }),
    ({ input }) => ({ operation: "browser.execute", body: input }), 64_000)
  return app
}

function invalidArtifact(): FileServiceRequestError {
  return new FileServiceRequestError("ARTIFACT_REGISTRATION_INVALID", false, 400)
}

/** Map only negotiated artifact failures; unknown codes stay retryable. */
function artifactToolFailure(result: Extract<DesktopToolResult, { ok: false }>): FileServiceRequestError {
  switch (result.error_code) {
    case "ARTIFACT_REGISTRATION_INVALID":
      return invalidArtifact()
    case "FILE_LIMIT_EXCEEDED":
      return new FileServiceRequestError("FILE_LIMIT_EXCEEDED", false, 413)
    case "FORBIDDEN":
      return new FileServiceRequestError("FILE_SERVICE_FORBIDDEN", false, 403)
    default:
      return new FileServiceRequestError("ARTIFACT_REGISTRATION_UNAVAILABLE", true, 503)
  }
}

function artifactFailure(error: unknown): FileServiceRequestError {
  return error instanceof FileServiceRequestError
    ? error
    : new FileServiceRequestError("ARTIFACT_REGISTRATION_UNAVAILABLE", true, 503)
}
