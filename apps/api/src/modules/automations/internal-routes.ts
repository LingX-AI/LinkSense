import type { FastifyPluginAsync } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AUTOMATION_TOOL_BODY_LIMIT, internalAutomationToolRequestSchema } from "@linksense/shared";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { requestMonitoringStop } from "./monitoring.js";
import type { ConversationAutomationService } from "./conversation-service.js";

export const internalAutomationMonitoringRoutes: FastifyPluginAsync<{
  prisma: PrismaClient;
  sharedSecret: string;
}> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const actual = Buffer.from(
      request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "",
    );
    const expected = Buffer.from(options.sharedSecret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
  });
  app.post("/automations/request-stop", async (request) => {
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const actor = await options.prisma.user.findFirst({
      where: { id: ownerId, status: "active" },
      select: { id: true },
    });
    if (!actor) throw new AppError("FORBIDDEN");
    const body = z
      .strictObject({ conversationId: z.uuid(), turnId: z.uuid() })
      .parse(request.body);
    return requestMonitoringStop(
      options.prisma,
      ownerId,
      body.conversationId,
      body.turnId,
    );
  });
};

export const internalAutomationRoutes: FastifyPluginAsync<{
  service: Pick<ConversationAutomationService, "execute">;
  sharedSecret: string;
}> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const token = Buffer.from(
      request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "",
    );
    const expected = Buffer.from(options.sharedSecret);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    }
    if (request.headers["x-linksense-service-session"])
      return reply.code(403).send({ error_code: "FORBIDDEN" });
  });

  app.post(
    "/execute",
    { bodyLimit: AUTOMATION_TOOL_BODY_LIMIT },
    async (request) =>
      options.service.execute(
        z.uuid().parse(request.headers["x-linksense-owner-id"]),
        internalAutomationToolRequestSchema.parse(request.body),
        {
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        },
      ),
  );
};
