import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runtimeServiceSessionHeader } from "@linksense/shared";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { runtimePlacementForWorkspace } from "../../lib/user-runtime-paths.js";

/** The controller authenticates a worker, then forwards its immutable environment scope. */
export function registerRunnerRuntimeScope(
  app: FastifyInstance,
  prisma: Pick<PrismaClient, "conversation">,
  sharedSecret: string,
): void {
  app.addHook("preHandler", async request => {
    if (!request.url.startsWith("/internal/")) return;
    const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    const expected = Buffer.from(sharedSecret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AppError("AUTH_REQUIRED");
    const serviceSessionId = z.uuid().optional().parse(request.headers[runtimeServiceSessionHeader]);
    if (serviceSessionId && request.url.startsWith("/internal/skill-creator/")) throw new AppError("FORBIDDEN");
    const body = z.object({ conversationId: z.uuid().optional(), conversation_id: z.uuid().optional() }).passthrough().safeParse(request.body);
    if (!body.success) return;
    const conversationId = body.data.conversationId ?? body.data.conversation_id;
    if (!conversationId) return; // Each route validates its complete input.
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ownerId }, select: { workspaceRelPath: true },
    });
    if (!conversation || runtimePlacementForWorkspace(ownerId, conversation.workspaceRelPath).serviceSessionId !== serviceSessionId) {
      throw new AppError("CONVERSATION_NOT_FOUND");
    }
  });
}
