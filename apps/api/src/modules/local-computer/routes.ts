import {
  localComputerPermissionInputSchema,
  localComputerSessionInputSchema,
  localComputerStatusSchema,
} from "@linksense/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ok } from "../../lib/http.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { LocalComputerService } from "./service.js";

const params = z.strictObject({ id: z.uuid() });

export const localComputerRoutes: FastifyPluginAsync<{ service: LocalComputerService }> = async (app, { service }) => {
  app.addHook("preHandler", app.authenticate);
  app.get("/:id/local-computer", async request => {
    const actor = (request as AuthenticatedRequest).authUser;
    const { id } = params.parse(request.params);
    return ok(localComputerStatusSchema.parse(await service.status(actor, id)), request.id);
  });
  app.post("/:id/local-computer", { bodyLimit: 1024 }, async request => {
    const actor = (request as AuthenticatedRequest).authUser;
    const { id } = params.parse(request.params);
    const { session_id } = localComputerSessionInputSchema.parse(request.body);
    return ok(localComputerStatusSchema.parse(await service.start(actor, id, session_id)), request.id);
  });
  app.delete("/:id/local-computer", async request => {
    const actor = (request as AuthenticatedRequest).authUser;
    const { id } = params.parse(request.params);
    const { session_id } = localComputerSessionInputSchema.parse(request.query);
    return ok(localComputerStatusSchema.parse(await service.stop(actor, id, session_id)), request.id);
  });
  app.post("/:id/computer-permissions", { bodyLimit: 1024 }, async request => {
    const actor = (request as AuthenticatedRequest).authUser;
    const { id } = params.parse(request.params);
    const input = localComputerPermissionInputSchema.parse(request.body);
    return ok(localComputerStatusSchema.parse(await service.changePermission(actor, id, input)), request.id);
  });
};
