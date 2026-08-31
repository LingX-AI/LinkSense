import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { z } from "zod"

import { AppError } from "../../lib/errors.js"
import { ok } from "../../lib/http.js"
import type { McpServerService } from "./service.js"
import type { RequestActor } from "./types.js"

export interface McpServerRoutesOptions {
  service: Pick<
    McpServerService,
    "list" | "get" | "create" | "importJson" | "patch" | "test" | "delete"
  >
  resolveActor?: (request: FastifyRequest) => Promise<RequestActor> | RequestActor
}

const paramsSchema = z.strictObject({ id: z.uuid() })
const authTypeSchema = z.enum(["none", "bearer", "api_key"])
const statusSchema = z.enum(["active", "disabled"])
const environmentSchema = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u).max(120),
  z.string().max(64 * 1_024)
)
const createHttpSchema = z.strictObject({
  transport: z.literal("streamable_http").optional(),
  name: z.string().trim().min(1).max(160),
  url: z.string().trim().min(1).max(2_048),
  auth_type: authTypeSchema,
  api_key_header: z.string().trim().min(1).max(120).optional(),
  credential: z.string().trim().min(1).max(64 * 1_024).optional(),
  startup_timeout_seconds: z.number().int().min(1).max(120).optional(),
  tool_timeout_seconds: z.number().int().min(1).max(600).optional(),
  insecure_http_acknowledged: z.boolean().optional(),
})
const createStdioSchema = z.strictObject({
  transport: z.literal("stdio"),
  name: z.string().trim().min(1).max(160),
  command: z.string().trim().min(1).max(512),
  args: z.array(z.string().max(4_096)).max(128).optional(),
  environment: environmentSchema.optional(),
  startup_timeout_seconds: z.number().int().min(1).max(120).optional(),
  tool_timeout_seconds: z.number().int().min(1).max(600).optional(),
})
const createSchema = z.union([createStdioSchema, createHttpSchema])
const importSchema = z.strictObject({
  json: z.string().min(1).max(256 * 1_024),
})
const patchSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(160).optional(),
    url: z.string().trim().min(1).max(2_048).optional(),
    auth_type: authTypeSchema.optional(),
    api_key_header: z.string().trim().min(1).max(120).optional(),
    credential: z.string().trim().min(1).max(64 * 1_024).optional(),
    clear_credential: z.boolean().optional(),
    command: z.string().trim().min(1).max(512).optional(),
    args: z.array(z.string().max(4_096)).max(128).optional(),
    environment: environmentSchema.optional(),
    clear_environment: z.boolean().optional(),
    status: statusSchema.optional(),
    startup_timeout_seconds: z.number().int().min(1).max(120).optional(),
    tool_timeout_seconds: z.number().int().min(1).max(600).optional(),
    insecure_http_acknowledged: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

export const mcpServerRoutes: FastifyPluginAsync<McpServerRoutesOptions> =
  async (app, options) => {
    const actorFor = options.resolveActor ?? defaultActorResolver

    app.get("/", async (request, reply) => {
      const actor = await actorFor(request)
      return reply.send(ok({ items: await options.service.list(actor) }, request))
    })

    app.post("/", async (request, reply) => {
      const actor = await actorFor(request)
      const body = createSchema.parse(request.body)
      const created = await options.service.create(
        actor,
        body.transport === "stdio"
          ? {
              transport: "stdio",
              name: body.name,
              command: body.command,
              ...(body.args === undefined ? {} : { args: body.args }),
              ...(body.environment === undefined
                ? {}
                : { environment: body.environment }),
              ...(body.startup_timeout_seconds === undefined
                ? {}
                : { startupTimeoutSeconds: body.startup_timeout_seconds }),
              ...(body.tool_timeout_seconds === undefined
                ? {}
                : { toolTimeoutSeconds: body.tool_timeout_seconds }),
            }
          : {
              transport: "streamable_http",
              name: body.name,
              url: body.url,
              authType: body.auth_type,
              ...(body.api_key_header === undefined
                ? {}
                : { apiKeyHeader: body.api_key_header }),
              ...(body.credential === undefined
                ? {}
                : { credential: body.credential }),
              ...(body.startup_timeout_seconds === undefined
                ? {}
                : { startupTimeoutSeconds: body.startup_timeout_seconds }),
              ...(body.tool_timeout_seconds === undefined
                ? {}
                : { toolTimeoutSeconds: body.tool_timeout_seconds }),
              ...(body.insecure_http_acknowledged === undefined
                ? {}
                : {
                    insecureHttpAcknowledged:
                      body.insecure_http_acknowledged,
                  }),
            }
      )
      return reply.code(201).send(ok(created, request))
    })

    app.post("/import", async (request, reply) => {
      const actor = await actorFor(request)
      const body = importSchema.parse(request.body)
      return reply
        .code(201)
        .send(ok(await options.service.importJson(actor, body.json), request))
    })

    app.get("/:id", async (request, reply) => {
      const actor = await actorFor(request)
      const { id } = paramsSchema.parse(request.params)
      return reply.send(ok(await options.service.get(actor, id), request))
    })

    app.patch("/:id", async (request, reply) => {
      const actor = await actorFor(request)
      const { id } = paramsSchema.parse(request.params)
      const body = patchSchema.parse(request.body)
      return reply.send(
        ok(
          await options.service.patch(actor, id, {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.url === undefined ? {} : { url: body.url }),
            ...(body.auth_type === undefined
              ? {}
              : { authType: body.auth_type }),
            ...(body.api_key_header === undefined
              ? {}
              : { apiKeyHeader: body.api_key_header }),
            ...(body.credential === undefined
              ? {}
              : { credential: body.credential }),
            ...(body.clear_credential === undefined
              ? {}
              : { clearCredential: body.clear_credential }),
            ...(body.command === undefined ? {} : { command: body.command }),
            ...(body.args === undefined ? {} : { args: body.args }),
            ...(body.environment === undefined
              ? {}
              : { environment: body.environment }),
            ...(body.clear_environment === undefined
              ? {}
              : { clearEnvironment: body.clear_environment }),
            ...(body.status === undefined ? {} : { status: body.status }),
            ...(body.startup_timeout_seconds === undefined
              ? {}
              : { startupTimeoutSeconds: body.startup_timeout_seconds }),
            ...(body.tool_timeout_seconds === undefined
              ? {}
              : { toolTimeoutSeconds: body.tool_timeout_seconds }),
            ...(body.insecure_http_acknowledged === undefined
              ? {}
              : {
                  insecureHttpAcknowledged: body.insecure_http_acknowledged,
                }),
          }),
          request
        )
      )
    })

    app.post("/:id/test", async (request, reply) => {
      const actor = await actorFor(request)
      const { id } = paramsSchema.parse(request.params)
      return reply.send(ok(await options.service.test(actor, id), request))
    })

    app.delete("/:id", async (request, reply) => {
      const actor = await actorFor(request)
      const { id } = paramsSchema.parse(request.params)
      await options.service.delete(actor, id)
      return reply.code(204).send()
    })
  }

function defaultActorResolver(request: FastifyRequest): RequestActor {
  const user = request.authUser
  if (
    !user ||
    (user.role !== "admin" && user.role !== "user") ||
    (user.status !== "active" && user.status !== "disabled")
  ) {
    throw new AppError("AUTH_REQUIRED")
  }
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    ipAddress: request.ip,
    ...(request.headers["user-agent"]
      ? { userAgent: request.headers["user-agent"] }
      : {}),
  }
}
