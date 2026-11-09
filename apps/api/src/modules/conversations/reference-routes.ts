import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { readConversationReferenceInputSchema } from "@linksense/shared";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { readTaskReference } from "./task-references.js";

const bodySchema = z.strictObject({ conversationId: z.uuid(), turnId: z.uuid(), input: readConversationReferenceInputSchema });
export const internalConversationReferenceRoutes: FastifyPluginAsync<{ prisma: PrismaClient; sharedSecret: string }> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const token = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    const expected = Buffer.from(options.sharedSecret);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
  });
  app.post("/conversation-references/read", async request => {
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const actor = await options.prisma.user.findFirst({ where: { id: ownerId, status: "active" }, select: { id: true } });
    if (!actor) throw new AppError("FORBIDDEN");
    const body = bodySchema.parse(request.body);
    return readTaskReference(options.prisma, ownerId, body.conversationId, body.turnId, body.input);
  });
};
