import { timingSafeEqual } from "node:crypto";

import {
  AUTOMATION_TOOL_BODY_LIMIT,
  internalAutomationToolRequestSchema,
} from "@linksense/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { ConversationAutomationService } from "./conversation-service.js";

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
