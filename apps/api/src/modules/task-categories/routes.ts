import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { taskCategoryInputSchema, taskCategoryOrderSchema } from "@linksense/shared";

import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { TaskCategoryService } from "./service.js";

const paramsSchema = z.strictObject({ id: z.string().uuid() });

export const taskCategoryRoutes: FastifyPluginAsync<{
  service: Pick<TaskCategoryService, "list" | "create" | "rename" | "delete" | "reorder">;
}> = async (app, { service }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    return reply.send(ok(await service.list(user.id), request.id));
  });
  app.put("/order", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const input = taskCategoryOrderSchema.parse(request.body);
    return reply.send(ok(await service.reorder(user.id, input), request.id));
  });
  app.post("/", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const input = taskCategoryInputSchema.parse(request.body);
    return reply.code(201).send(ok(await service.create(user.id, input), request.id));
  });
  app.patch("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = paramsSchema.parse(request.params);
    const input = taskCategoryInputSchema.parse(request.body);
    return reply.send(ok(await service.rename(user.id, id, input), request.id));
  });
  app.delete("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = paramsSchema.parse(request.params);
    await service.delete(user.id, id);
    return reply.code(204).send();
  });
};
