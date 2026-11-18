import { timingSafeEqual } from "node:crypto"
import Fastify from "fastify"
import { desktopExecutionMaxFrameBytes, runnerEventBatchSchema, runnerHeartbeatSchema, runnerStartSettledSchema, webSearchRequestSchema } from "@linksense/shared"
import { z } from "zod"
import { desktopWorkerSecret } from "../controller/desktop-worker-provider.js"
import { acknowledgedEventCount } from "../event-sink.js"
import type { DesktopLink } from "./link.js"
import type { DesktopTurns } from "./turns.js"
import { WebSearchRequestError, webSearchErrorFromApi } from "../web-search-error.js"

const workerIdentity = z.strictObject({ ownerId: z.uuid(), conversationId: z.uuid() })
const processExit = runnerStartSettledSchema.pick({ conversationId: true }).extend({
  projectionTurnId: z.uuid(), capabilityGeneration: z.string().regex(/^[a-f0-9]{64}$/u),
})

export function desktopWorkerCallbacks(
  localSecret: string,
  current: () => { link: DesktopLink; turns: DesktopTurns } | undefined,
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
  const searchBody = z.strictObject({ conversationId: z.uuid(), turnId: z.uuid(), request: webSearchRequestSchema })
  app.post("/internal/web-search/search", { bodyLimit: 8_192 }, async (request, reply) => {
    const { link, run } = authenticate(request.headers)
    const body = searchBody.parse(request.body)
    if (body.conversationId !== run.scope.conversation_id || body.turnId !== run.scope.turn_id) {
      return reply.code(403).send({ error_code: "WEB_SEARCH_FORBIDDEN" })
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    const onClose = () => { if (!reply.raw.writableEnded) abort() }
    request.raw.once("aborted", abort)
    reply.raw.once("close", onClose)
    try {
      const result = await link.searchWeb(run, body.request, controller.signal)
      if (result.type !== "tool.result") throw new Error("desktop search response unavailable")
      if (result.ok) return result.data
      const error = webSearchErrorFromApi(result)
      return reply.code(error.statusCode).send({ error_code: error.code })
    } catch (error) {
      if (error instanceof WebSearchRequestError) return reply.code(error.statusCode).send({ error_code: error.code })
      throw error
    } finally {
      request.raw.off("aborted", abort)
      reply.raw.off("close", onClose)
    }
  })
  return app
}
