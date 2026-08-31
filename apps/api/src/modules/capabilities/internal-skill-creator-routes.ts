import { timingSafeEqual } from "node:crypto";

import {
  skillCreatorConfirmRequestSchema,
  skillCreatorPreviewRequestSchema,
} from "@linksense/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import type { ConversationSkillCreatorService } from "./conversation-skill-creator.js";

const ownerIdHeaderSchema = z.uuid();
export interface InternalSkillCreatorRoutesOptions {
  service: ConversationSkillCreatorService;
  sharedSecret: string;
}

export const internalSkillCreatorRoutes: FastifyPluginAsync<
  InternalSkillCreatorRoutesOptions
> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "";
    if (!safeEqual(token, options.sharedSecret)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    }
  });

  app.post("/preview", async (request) => {
    const ownerId = parseRunnerOwnerId(request);
    return options.service.preview(
      ownerId,
      skillCreatorPreviewRequestSchema.parse(request.body),
    );
  });

  app.post("/confirm", async (request) => {
    const ownerId = parseRunnerOwnerId(request);
    return options.service.confirm(
      ownerId,
      skillCreatorConfirmRequestSchema.parse(request.body),
    );
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
