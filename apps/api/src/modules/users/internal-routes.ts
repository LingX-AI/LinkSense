import { timingSafeEqual } from "node:crypto";

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type { UserService } from "./service.js";

const ownerIdHeaderSchema = z.uuid();
const internalCurrentUserInfoInputSchema = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
});

export const internalCurrentUserRoutes: FastifyPluginAsync<{
  service: UserService;
  sharedSecret: string;
}> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "";
    if (!safeEqual(token, options.sharedSecret)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    }
  });

  app.post("/current-user/info", async (request) => {
    const ownerId = parseRunnerOwnerId(request);
    internalCurrentUserInfoInputSchema.parse(request.body);
    try {
      return await options.service.getCurrentUserInfo(ownerId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("INTERNAL_ERROR");
    }
  });
};

function parseRunnerOwnerId(request: FastifyRequest): string {
  return ownerIdHeaderSchema.parse(request.headers["x-linksense-owner-id"]);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
