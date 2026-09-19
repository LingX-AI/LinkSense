import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { applicationDevelopmentOpenSchema, applicationDevelopmentInstallSchema, applicationDevelopmentDiagnosticSchema, applicationBuilderRequestSchema, applicationTestSessionsQuerySchema, applicationTestRestartSchema, applicationDevelopmentCapabilitiesUpdateSchema, applicationDevelopmentMetadataUpdateSchema } from "@linksense/shared";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import { measureTaskStage } from "../../lib/task-latency.js";
import { ok } from "../../lib/http.js";
import { defaultActorResolver } from "./routes.js";
import type { ResolveRequestActor } from "../capabilities/types.js";
import type { ApplicationDevelopmentService } from "./development-service.js";

const idParams = z.object({ id: z.uuid() });
export const applicationDevelopmentRoutes: FastifyPluginAsync<{
  service: ApplicationDevelopmentService;
  resolveActor?: ResolveRequestActor;
}> = async (app, { service, resolveActor = defaultActorResolver }) => {
  app.addHook("preHandler", app.authenticate);
  app.post("/", async (request, reply) => reply.code(201).send(ok(await service.create(await resolveActor(request), applicationDevelopmentOpenSchema.parse(request.body), (request as AuthenticatedRequest).authUser.preferredLocale ?? "zh-CN"), request.id)));
  app.get("/by-conversation/:id", async (request, reply) => reply.send(ok(await service.byConversation(await resolveActor(request), idParams.parse(request.params).id), request.id)));
  app.post("/by-application/:id", async (request, reply) => reply.send(ok(await measureTaskStage("application_development_open", async () => service.resume(await resolveActor(request), idParams.parse(request.params).id, (request as AuthenticatedRequest).authUser.preferredLocale ?? "zh-CN")), request.id)));
  app.get("/:id", async (request, reply) => reply.send(ok(await service.get(await resolveActor(request), idParams.parse(request.params).id), request.id)));
  app.post("/:id/resume", async (request, reply) => reply.send(ok(await measureTaskStage("application_development_open", async () => service.reopen(await resolveActor(request), idParams.parse(request.params).id, (request as AuthenticatedRequest).authUser.preferredLocale ?? "zh-CN")), request.id)));
  app.delete("/:id", async (request, reply) => {
    await service.delete(await resolveActor(request), idParams.parse(request.params).id);
    return reply.send(ok({ success: true }, request.id));
  });
  app.get("/:id/test-sessions", async (request, reply) => reply.header("cache-control", "private, no-store").send(ok(await service.testSessions(await resolveActor(request), idParams.parse(request.params).id, applicationTestSessionsQuerySchema.parse(request.query)), request.id)));
  app.post("/:id/test-sessions/restart", async (request, reply) => reply.send(ok(await service.restartTest(await resolveActor(request), idParams.parse(request.params).id, applicationTestRestartSchema.parse(request.body)), request.id)));
  app.delete("/:id/test-sessions/:conversationId", async (request, reply) => {
    const params = z.strictObject({ id: z.uuid(), conversationId: z.uuid() }).parse(request.params);
    await service.deleteTest(await resolveActor(request), params.id, params.conversationId);
    return reply.send(ok({ success: true }, request.id));
  });
  app.post("/:id/sync", async (request, reply) => reply.send(ok(await service.sync(await resolveActor(request), idParams.parse(request.params).id), request.id)));
  app.patch("/:id/metadata", async (request, reply) => reply.send(ok(await service.updateMetadata(await resolveActor(request), idParams.parse(request.params).id, applicationDevelopmentMetadataUpdateSchema.parse(request.body)), request.id)));
  app.get("/:id/capabilities", async (request, reply) => reply.header("cache-control", "private, no-store").send(ok(await service.capabilities(await resolveActor(request), idParams.parse(request.params).id), request.id)));
  app.patch("/:id/capabilities", async (request, reply) => reply.send(ok(await service.updateCapabilities(await resolveActor(request), idParams.parse(request.params).id, applicationDevelopmentCapabilitiesUpdateSchema.parse(request.body)), request.id)));
  app.post("/:id/install", async (request, reply) => {
    const { source_hash, ...release } = applicationDevelopmentInstallSchema.parse(request.body);
    return reply.send(ok(await service.install(await resolveActor(request), idParams.parse(request.params).id, source_hash, release), request.id));
  });
  app.put("/:id/diagnostics", async (request, reply) => {
    const body = z.strictObject({ revision: z.number().int().nonnegative(), diagnostics: z.array(applicationDevelopmentDiagnosticSchema).max(20) }).parse(request.body);
    await service.reportDiagnostics(await resolveActor(request), idParams.parse(request.params).id, body.revision, body.diagnostics);
    return reply.send(ok({ success: true }, request.id));
  });
};

export const internalApplicationBuilderRoutes: FastifyPluginAsync<{ service: ApplicationDevelopmentService; sharedSecret: string }> = async (app, { service, sharedSecret }) => {
  app.addHook("onRequest", async (request, reply) => {
    const provided = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    const expected = Buffer.from(sharedSecret);
    if (!expected.length || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
  });
  app.post("/", async request => {
    const owner = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const body = z.strictObject({ conversationId: z.uuid(), turnId: z.uuid(), request: applicationBuilderRequestSchema }).parse(request.body);
    return service.toolForOwner(owner, body.conversationId, body.turnId, body.request);
  });
};
