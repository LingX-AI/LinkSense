import type { FastifyPluginAsync } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { requestMonitoringStop } from "./monitoring.js";

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
