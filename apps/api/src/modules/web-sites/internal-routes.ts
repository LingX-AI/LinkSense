import { timingSafeEqual } from "node:crypto";

import {
  internalWebSiteToolConfirmSchema,
  internalWebSiteToolRequestSchema,
  internalWebSiteToolResultSchema,
  WEB_SITE_TOOL_BODY_LIMIT,
  webSiteToolResultSchema,
} from "@linksense/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { WebSiteToolService } from "./tool-service.js";

export const internalWebSiteToolRoutes: FastifyPluginAsync<{
  service: Pick<WebSiteToolService, "execute" | "confirm">;
  sharedSecret: string;
}> = async (app, { service, sharedSecret }) => {
  const expected = Buffer.from(sharedSecret);
  app.addHook("onRequest", async (request, reply) => {
    const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    }
  });

  app.post("/execute", { bodyLimit: WEB_SITE_TOOL_BODY_LIMIT }, async request => {
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const input = internalWebSiteToolRequestSchema.parse(request.body);
    return internalWebSiteToolResultSchema.parse(await service.execute(ownerId, input));
  });

  app.post("/confirm", { bodyLimit: WEB_SITE_TOOL_BODY_LIMIT }, async request => {
    const ownerId = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const input = internalWebSiteToolConfirmSchema.parse(request.body);
    return webSiteToolResultSchema.parse(await service.confirm(ownerId, input));
  });
};
