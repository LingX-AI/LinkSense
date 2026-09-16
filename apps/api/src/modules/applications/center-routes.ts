import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { applicationCenterReviewInputSchema, applicationCenterStatusInputSchema, applicationCenterSubmissionInputSchema } from "@linksense/shared";
import { ok } from "../../lib/http.js";
import type { ResolveRequestActor } from "../capabilities/types.js";
import type { ApplicationCenterService } from "./center-service.js";
import { defaultActorResolver } from "./routes.js";

interface Options { service: ApplicationCenterService; resolveActor?: ResolveRequestActor }
const appParams = z.strictObject({ applicationId: z.uuid() });
const releaseParams = z.strictObject({ releaseId: z.uuid() });
const context = (request: FastifyRequest) => ({ ipAddress: request.ip, ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}) });

export const applicationCenterRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const actor = options.resolveActor ?? defaultActorResolver;
  app.get("/", async (request, reply) => {
    const { search } = z.strictObject({ search: z.string().trim().max(240).optional() }).parse(request.query);
    return reply.send(ok({ items: await options.service.catalog(await actor(request), search), next_cursor: null }, request));
  });
  app.get("/mine/:applicationId", async (request, reply) => {
    const { applicationId } = appParams.parse(request.params);
    return reply.send(ok({ items: await options.service.ownReleases(await actor(request), applicationId), next_cursor: null }, request));
  });
  app.get("/mine", async (request, reply) => {
    z.strictObject({}).parse(request.query);
    return reply.send(ok({ items: await options.service.ownPublications(await actor(request)), next_cursor: null }, request));
  });
  app.post("/:applicationId/submissions", async (request, reply) => {
    const { applicationId } = appParams.parse(request.params);
    return reply.code(202).send(ok(await options.service.submit(await actor(request), applicationId, applicationCenterSubmissionInputSchema.parse(request.body), context(request)), request));
  });
  app.delete("/releases/:releaseId", async (request, reply) => {
    await options.service.withdraw(await actor(request), releaseParams.parse(request.params).releaseId, context(request));
    return reply.code(204).send();
  });
  app.patch("/:applicationId/status", async (request, reply) => {
    await options.service.setStatus(await actor(request), appParams.parse(request.params).applicationId, applicationCenterStatusInputSchema.parse(request.body), context(request));
    return reply.code(204).send();
  });
};

export const adminApplicationCenterRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const actor = options.resolveActor ?? defaultActorResolver;
  app.get("/", async (request, reply) => reply.send(ok({ items: await options.service.adminReleases(await actor(request)), next_cursor: null }, request)));
  app.get("/:releaseId", async (request, reply) => reply.send(ok(await options.service.detail(await actor(request), releaseParams.parse(request.params).releaseId), request)));
  app.post("/:releaseId/review", async (request, reply) => {
    await options.service.review(await actor(request), releaseParams.parse(request.params).releaseId, applicationCenterReviewInputSchema.parse(request.body), context(request));
    return reply.code(204).send();
  });
  app.patch("/applications/:applicationId/status", async (request, reply) => {
    await options.service.setStatus(await actor(request), appParams.parse(request.params).applicationId, applicationCenterStatusInputSchema.parse(request.body), context(request));
    return reply.code(204).send();
  });
};
