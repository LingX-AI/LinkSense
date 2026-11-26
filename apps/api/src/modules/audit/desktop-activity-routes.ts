import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { listDesktopActivity } from "./desktop-activity.js";

const querySchema = z.strictObject({});

/**
 * The signed-in user's own recent desktop activity. There are deliberately no
 * query filters or owner/action parameters: the actor is taken only from the
 * authenticated session and the response is a bounded, projected list.
 */
export const desktopActivityRoutes: FastifyPluginAsync<{
  prisma: Pick<PrismaClient, "auditLog">;
}> = async (app, { prisma }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/activity", async (request, reply) => {
    reply.header("cache-control", "no-store");
    querySchema.parse(request.query);
    const actor = (request as AuthenticatedRequest).authUser;
    const result = await listDesktopActivity(prisma, actor.id);
    return reply.send(ok(result, request.id));
  });
};
