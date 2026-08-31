import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { inlineContentDisposition } from "../../lib/content-disposition.js";
import { AppError } from "../../lib/errors.js";
import type { KnowledgeTurnAssetReadService } from "./turn-asset-read.js";
import type { ResolveKnowledgeActor } from "./types.js";

const turnAssetParamsSchema = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
  assetId: z.uuid(),
});
const emptyQuerySchema = z.strictObject({});

export const knowledgeTurnAssetRoutes: FastifyPluginAsync<{
  service: KnowledgeTurnAssetReadService;
  resolveActor?: ResolveKnowledgeActor;
}> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver;

  app.get(
    "/:conversationId/turns/:turnId/knowledge-assets/:assetId",
    async (request, reply) => {
      const actor = await actorFor(request);
      const { conversationId, turnId, assetId } = turnAssetParamsSchema.parse(
        request.params,
      );
      emptyQuerySchema.parse(request.query);
      const asset = await options.service.getAsset(
        actor,
        conversationId,
        turnId,
        assetId,
      );
      reply.raw.once("close", () => asset.stream.destroy());
      return reply
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("content-length", asset.sizeBytes.toString())
        .header("content-disposition", inlineContentDisposition(asset.filename))
        .type(asset.mimeType)
        .send(asset.stream);
    },
  );
};

async function defaultActorResolver(request: FastifyRequest) {
  if (!request.authUser) throw new AppError("AUTH_REQUIRED");
  return {
    id: request.authUser.id,
    role: request.authUser.role,
    status: request.authUser.status,
    ipAddress: request.ip,
    ...(request.headers["user-agent"]
      ? { userAgent: request.headers["user-agent"] }
      : {}),
  };
}
