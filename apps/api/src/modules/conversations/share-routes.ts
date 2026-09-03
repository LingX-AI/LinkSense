import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { ok } from "../../lib/http.js";
import type { ConversationShareService } from "./sharing.js";

const shareParamsSchema = z.strictObject({ shareId: z.string().uuid() });

export const publicConversationShareRoutes: FastifyPluginAsync<{
  service: ConversationShareService;
}> = async (app, { service }) => {
  app.get("/:shareId", async (request, reply) => {
    const { shareId } = shareParamsSchema.parse(request.params);
    return reply.send(ok(await service.get(shareId), request.id));
  });
};
