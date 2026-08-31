import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import {
  parseCompletionNotificationCursor,
  type CompletionNotificationService,
} from "./service.js";

export const completionNotificationRoutes: FastifyPluginAsync<{
  service: CompletionNotificationService;
}> = async (app, { service }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const query = z
      .strictObject({
        cursor: z
          .string()
          .trim()
          .min(1)
          .max(320)
          .refine(
            (value) => parseCompletionNotificationCursor(value) !== null,
            "invalid_cursor",
          )
          .optional(),
        limit: z.coerce.number().int().min(1).max(100).default(100),
      })
      .parse(request.query);
    const cursor = query.cursor
      ? parseCompletionNotificationCursor(query.cursor)
      : undefined;
    if (query.cursor && !cursor) throw new Error("validated cursor is invalid");

    return reply.send(
      ok(
        await service.list(user.id, {
          ...(cursor ? { cursor } : {}),
          limit: query.limit,
        }),
        request.id,
      ),
    );
  });
};
