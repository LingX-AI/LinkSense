import { timingSafeEqual } from "node:crypto";

import { internalSkillManagementRequestSchema, skillManagementResultSchema } from "@linksense/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { ConversationSkillManagementService } from "./conversation-skill-management.js";

export interface InternalSkillManagementRoutesOptions {
  service: Pick<ConversationSkillManagementService, "execute">;
  sharedSecret: string;
}

export const internalSkillManagementRoutes: FastifyPluginAsync<InternalSkillManagementRoutesOptions> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    const expected = Buffer.from(options.sharedSecret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    }
  });

  app.post("/execute", async request => {
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const input = internalSkillManagementRequestSchema.parse(request.body);
    return skillManagementResultSchema.parse(await options.service.execute(ownerId, input));
  });
};
