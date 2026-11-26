import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  desktopFileRootCreateSchema,
  desktopFileRootListSchema,
  desktopFileRootPatchSchema,
  desktopFileRootSchema,
} from "@linksense/shared";

import { ok } from "../../lib/http.js";
import type { DesktopFileRootService } from "./file-roots.js";

const rootParamsSchema = z.strictObject({ id: z.uuid() });

/** Folder grants are aliases and modes; absolute paths stay on the Mac. */
export const desktopFileRootRoutes: FastifyPluginAsync<{
  service: DesktopFileRootService;
}> = async (app, options) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async request => {
    const user = request.authUser!;
    return ok(desktopFileRootListSchema.parse({
      items: await options.service.list(user.id),
    }), request.id);
  });

  app.post("/", { bodyLimit: 2048 }, async request => {
    const user = request.authUser!;
    const input = desktopFileRootCreateSchema.parse(request.body);
    return ok(desktopFileRootSchema.parse(
      await options.service.create(user.id, input),
    ), request.id);
  });

  app.patch("/:id", { bodyLimit: 2048 }, async request => {
    const user = request.authUser!;
    const { id } = rootParamsSchema.parse(request.params);
    const patch = desktopFileRootPatchSchema.parse(request.body);
    return ok(desktopFileRootSchema.parse(
      await options.service.update(user.id, id, patch),
    ), request.id);
  });

  app.delete("/:id", async request => {
    const user = request.authUser!;
    const { id } = rootParamsSchema.parse(request.params);
    await options.service.revoke(user.id, id);
    return ok({ revoked: true }, request.id);
  });
};
