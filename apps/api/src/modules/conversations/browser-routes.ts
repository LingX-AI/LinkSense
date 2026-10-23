import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { browserPanelRequestSchema } from "@linksense/shared";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { AppServices } from "../../services.js";
import { ok } from "../../lib/http.js";

export const conversationBrowserRoutes: FastifyPluginAsync<{
  services: {
    conversations: Pick<AppServices["conversations"], "browserPanel">;
  };
}> = async (app, { services }) => {
  app.addHook("preHandler", app.authenticate);
  app.post("/:id/browser", { bodyLimit: 24_000 }, async (request, reply) => {
    const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
    const actor = (request as AuthenticatedRequest).authUser;
    const input = browserPanelRequestSchema.parse(request.body);
    return reply
      .header("cache-control", "private, no-store")
      .send(
        ok(
          await services.conversations.browserPanel(actor.id, id, input),
          request.id,
        ),
      );
  });
};
