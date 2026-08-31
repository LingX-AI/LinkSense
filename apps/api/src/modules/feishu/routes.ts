import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { feishuRegistrationStartInputSchema } from "@linksense/shared";

import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { FeishuService } from "./service.js";

const paramsSchema = z.strictObject({ id: z.uuid() });
const FEISHU_CONTROL_BODY_LIMIT = 4 * 1_024;

export const feishuRoutes: FastifyPluginAsync<{
  service: Pick<
    FeishuService,
    "deleteConnection" | "getRegistration" | "list" | "startRegistration"
  >;
}> = async (app, { service }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    return reply.send(ok(await service.list(user.id), request));
  });

  app.post(
    "/registration-sessions",
    { bodyLimit: FEISHU_CONTROL_BODY_LIMIT },
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const input = feishuRegistrationStartInputSchema.parse(request.body);
      const registration = await service.startRegistration(user.id, {
        allowExistingSelection: input.reuse_existing,
        forceCreate: input.force_create,
      });
      return reply.code(201).send(ok(registration, request));
    },
  );

  app.get("/registration-sessions/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = paramsSchema.parse(request.params);
    return reply.send(
      ok(await service.getRegistration(user.id, id), request),
    );
  });

  app.delete("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = paramsSchema.parse(request.params);
    await service.deleteConnection(user.id, id, auditContext(request));
    return reply.code(204).send();
  });
};

function auditContext(request: FastifyRequest) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}
