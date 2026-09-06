import { botChannelCreateSchema } from "@linksense/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { BotChannelService } from "./service.js";
import type { BotChannelRuntime } from "./runtime.js";

const paramsSchema = z.strictObject({ id: z.uuid() });
export const botChannelRoutes: FastifyPluginAsync<{
  service: Pick<BotChannelService, "list" | "create" | "delete">;
  runtime: Pick<BotChannelRuntime, "handleTeams">;
}> = async (app, { service, runtime }) => {
  app.get("/", { preHandler: app.authenticate }, async (request, reply) =>
    reply.send(
      ok(
        await service.list((request as AuthenticatedRequest).authUser.id),
        request,
      ),
    ),
  );
  app.post(
    "/",
    { preHandler: app.authenticate, bodyLimit: 16_384 },
    async (request, reply) => {
      const input = botChannelCreateSchema.parse(request.body);
      const result = await service.create(
        (request as AuthenticatedRequest).authUser.id,
        input,
        {
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        },
      );
      return reply.code(201).send(ok(result, request));
    },
  );
  app.delete(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      await service.delete((request as AuthenticatedRequest).authUser.id, id, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
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
      // This endpoint uses Microsoft's service JWT authentication in the SDK.
      const result = await runtime.handleTeams(id, {
        body: request.body,
        headers,
      });
      return reply.code(result.status).send(result.body);
    },
  );
};
