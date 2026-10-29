import type { FastifyPluginAsync } from "fastify";
import { connectionProviderSchema, updateConnectionSettingsSchema } from "@linksense/shared";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import { assertCookieRequestOrigin } from "../auth/routes.js";
import type { ConnectionSettingsService } from "./settings.js";

export const connectionSettingsRoutes: FastifyPluginAsync<{
  settings: Pick<ConnectionSettingsService, "getAdminSettings" | "update">;
}> = async (app, options) => {
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });
  app.get("/api/v1/admin/connection-settings", { preHandler: app.requireAdmin }, async (request) =>
    ok(await options.settings.getAdminSettings(), request),
  );
  app.put("/api/v1/admin/connection-settings/:provider", { preHandler: app.requireAdmin }, async (request) => {
    assertCookieRequestOrigin(request);
    if (!request.authUser) throw new AppError("AUTH_REQUIRED");
    const { provider } = z.strictObject({ provider: connectionProviderSchema }).parse(request.params);
    return ok(await options.settings.update(
      provider, updateConnectionSettingsSchema.parse(request.body), request.authUser.id,
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? null },
    ), request);
  });
};
