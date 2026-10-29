import {
  botChannelAdminCreateSchema,
  botChannelEnabledSchema,
  botChannelPolicySchema,
} from "@linksense/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { BotChannelService } from "./service.js";
import type { BotChannelRuntime } from "./runtime.js";
const paramsSchema = z.strictObject({ id: z.uuid() });
const actor = (request: FastifyRequest) =>
  (request as AuthenticatedRequest).authUser.id;
const context = (request: FastifyRequest) => ({
  ipAddress: request.ip,
  userAgent: request.headers["user-agent"] ?? null,
});
export const botChannelRoutes: FastifyPluginAsync<{
  service: Pick<
    BotChannelService,
    | "list"
    | "deletePersonal"
    | "listOrganization"
    | "createOrganization"
    | "deleteOrganization"
    | "setOrganizationEnabled"
    | "issueLinking"
    | "unlink"
    | "beginRegistration"
    | "pollRegistration"
  >;
  runtime: Pick<BotChannelRuntime, "handleTeams">;
}> = async (app, { service, runtime }) => {
  app.get("/", { preHandler: app.authenticate }, async (request, reply) =>
    reply.send(ok(await service.list(actor(request)), request)),
  );
  app.post(
    "/dingtalk/registration-sessions",
    { preHandler: app.authenticate, bodyLimit: 1024 },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const input = botChannelPolicySchema.parse(request.body);
      return reply
        .code(201)
        .send(
          ok(
            await service.beginRegistration(
              actor(request),
              input.allow_group_messages,
            ),
            request,
          ),
        );
    },
  );
  app.get(
    "/dingtalk/registration-sessions/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return reply.send(
        ok(
          await service.pollRegistration(
            actor(request),
            paramsSchema.parse(request.params).id,
            context(request),
          ),
          request,
        ),
      );
    },
  );
  app.post(
    "/:id/linking-sessions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return reply
        .code(201)
        .send(
          ok(
            await service.issueLinking(
              actor(request),
              paramsSchema.parse(request.params).id,
            ),
            request,
          ),
        );
    },
  );
  app.delete(
    "/:id/identity",
    { preHandler: app.authenticate },
    async (request, reply) => {
      await service.unlink(
        actor(request),
        paramsSchema.parse(request.params).id,
      );
      return reply.code(204).send();
    },
  );
  app.delete(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      await service.deletePersonal(
        actor(request),
        paramsSchema.parse(request.params).id,
        context(request),
      );
      return reply.code(204).send();
    },
  );
  app.get(
    "/organization",
    { preHandler: app.requireAdmin },
    async (request, reply) =>
      reply.send(ok(await service.listOrganization(), request)),
  );
  app.post(
    "/organization",
    { preHandler: app.requireAdmin, bodyLimit: 16_384 },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          ok(
            await service.createOrganization(
              actor(request),
              botChannelAdminCreateSchema.parse(request.body),
              context(request),
            ),
            request,
          ),
        ),
  );
  app.patch(
    "/organization/:id",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      await service.setOrganizationEnabled(
        actor(request),
        paramsSchema.parse(request.params).id,
        botChannelEnabledSchema.parse(request.body).enabled,
        context(request),
      );
      return reply.code(204).send();
    },
  );
  app.delete(
    "/organization/:id",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      await service.deleteOrganization(
        actor(request),
        paramsSchema.parse(request.params).id,
        context(request),
      );
      return reply.code(204).send();
    },
  );
  app.post(
    "/teams/:id/messages",
    { bodyLimit: 200_000 },
    async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const headers: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(request.headers))
        if (value !== undefined) headers[key] = value;
      // The SDK verifies Microsoft's service JWT; this route does not use a LinkSense session.
      const result = await runtime.handleTeams(id, {
        body: request.body,
        headers,
      });
      return reply.code(result.status).send(result.body);
    },
  );
};
