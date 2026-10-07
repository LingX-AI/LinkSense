import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  automationCreateInputSchema,
  automationRunNowInputSchema,
  automationUpdateInputSchema,
} from "@linksense/shared";

import { ok } from "../../lib/http.js";
import { resolveLocale } from "../../lib/locale.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { AppServices } from "../../services.js";

const automationParamsSchema = z.strictObject({ id: z.uuid() });

export const automationRoutes: FastifyPluginAsync<{
  services: AppServices;
}> = async (app, { services }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    return reply.send(ok(await services.automations.list(user.id), request.id));
  });

  app.get("/pinned-tasks", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    return reply.send(
      ok(
        await services.automations.listPinnedConversations(user.id),
        request.id,
      ),
    );
  });

  app.get("/completion-notifications", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    return reply.send(
      ok(
        await services.automations.completionNotifications(user.id),
        request.id,
      ),
    );
  });

  app.post("/", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const result = await services.automations.create(
      user.id,
      automationCreateInputSchema.parse(request.body),
      auditContext(request),
      resolveLocale(
        request,
        user.preferredLocale,
        services.system.defaultLocale,
      ),
    );
    return reply.code(201).send(ok(result, request.id));
  });

  app.get("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = automationParamsSchema.parse(request.params);
    return reply.send(
      ok(await services.automations.get(user.id, id), request.id),
    );
  });

  app.post("/:id/run", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = automationParamsSchema.parse(request.params);
    const input = automationRunNowInputSchema.parse(request.body);
    const result = await services.automations.runNow(
      user.id,
      id,
      input.request_id,
      auditContext(request),
    );
    return reply.code(202).send(ok(result, request.id));
  });

  app.patch("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = automationParamsSchema.parse(request.params);
    const result = await services.automations.update(
      user.id,
      id,
      automationUpdateInputSchema.parse(request.body),
      auditContext(request),
      resolveLocale(
        request,
        user.preferredLocale,
        services.system.defaultLocale,
      ),
    );
    return reply.send(ok(result, request.id));
  });

  app.delete("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = automationParamsSchema.parse(request.params);
    await services.automations.delete(user.id, id, auditContext(request));
    return reply.code(204).send();
  });
};

function auditContext(request: FastifyRequest) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}
