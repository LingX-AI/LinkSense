import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionProviderSchema, errorCatalog } from "@linksense/shared";
import { AppError } from "../src/lib/errors.js";
import { connectionSettingsRoutes } from "../src/modules/connections/settings-routes.js";
import type { ConnectionSettingsService } from "../src/modules/connections/settings.js";

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function fixture() {
  const app = Fastify();
  apps.push(app);
  await app.register(cookie);
  app.decorate("requireAdmin", async (request: FastifyRequest) => {
    const token = request.headers.authorization;
    if (!token) throw new AppError("AUTH_REQUIRED");
    if (token !== "Bearer admin") throw new AppError("FORBIDDEN");
    request.authUser = {
      id: "00000000-0000-4000-8000-000000000002", role: "admin", status: "active",
      name: "Admin", email: "admin@example.test", authValidAfter: new Date(0),
      preferredLocale: null, avatarObjectKey: null,
    };
  });
  app.setErrorHandler((error, _request, reply) => {
    const code = error instanceof AppError ? error.code : "VALIDATION_ERROR";
    return reply.code(errorCatalog[code].http_status).send({ error_code: code });
  });
  const items = connectionProviderSchema.options.map((provider) => ({
    provider, revision: 1, client_id: `${provider}-app`, secret_configured: true,
    redirect_uri: `https://app.example.test/api/v1/connectors/${provider}/callback`,
    required_scopes: ["openid"], connected_account_count: 0,
  }));
  const settings = {
    getAdminSettings: vi.fn<ConnectionSettingsService["getAdminSettings"]>().mockResolvedValue(items),
    update: vi.fn<ConnectionSettingsService["update"]>().mockResolvedValue(items),
  };
  await app.register(connectionSettingsRoutes, { settings });
  return { app, settings };
}

describe("connector administration routes", () => {
  it.each(["GET", "PUT"] as const)("requires an administrator for %s before reading or changing settings", async (method) => {
    const f = await fixture();
    const request = {
      method, url: `/api/v1/admin/connection-settings${method === "PUT" ? "/onedrive" : ""}`,
      ...(method === "PUT" ? { payload: { expected_revision: 0, client_id: "app", client_secret: "private" } } : {}),
    };
    expect((await f.app.inject(request)).statusCode).toBe(401);
    expect((await f.app.inject({ ...request, headers: { authorization: "Bearer user" } })).statusCode).toBe(403);
    expect(f.settings.getAdminSettings).not.toHaveBeenCalled();
    expect(f.settings.update).not.toHaveBeenCalled();
  });

  it("lists safe connector metadata without caching it", async () => {
    const f = await fixture();
    const response = await f.app.inject({ url: "/api/v1/admin/connection-settings", headers: { authorization: "Bearer admin" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toHaveLength(5);
    expect(response.body).not.toContain("client_secret");
  });

  it("rejects cross-origin configuration writes even for an administrator", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "PUT", url: "/api/v1/admin/connection-settings/onedrive",
      headers: { authorization: "Bearer admin", origin: "https://untrusted.example.test", "sec-fetch-site": "cross-site" },
      payload: { expected_revision: 1, client_id: "app", client_secret: "private" },
    });
    expect(response.statusCode).toBe(403);
    expect(f.settings.update).not.toHaveBeenCalled();
  });

  it.each(connectionProviderSchema.options)("saves %s using the authenticated actor and the connector contract", async (provider) => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "PUT", url: `/api/v1/admin/connection-settings/${provider}`,
      headers: { authorization: "Bearer admin" },
      payload: { expected_revision: 1, client_id: "app", client_secret: "private" },
    });
    expect(response.statusCode).toBe(200);
    expect(f.settings.update).toHaveBeenCalledWith(provider,
      { expected_revision: 1, client_id: "app", client_secret: "private", acknowledge_reauthorization: false },
      "00000000-0000-4000-8000-000000000002", expect.objectContaining({ ipAddress: expect.any(String) }),
    );
    expect(response.body).not.toContain("private");
  });

  it.each([
    { provider: "unknown", body: { expected_revision: 1, client_id: "app" } },
    { provider: "onedrive", body: { expected_revision: 1, client_id: " " } },
    { provider: "onedrive", body: { expected_revision: 1, client_id: "app", enabled: true } },
    { provider: "onedrive", body: { expected_revision: 1, client_id: "app", actor_id: "other" } },
  ])("rejects invalid or injected configuration before mutation", async ({ provider, body }) => {
    const f = await fixture();
    const response = await f.app.inject({ method: "PUT", url: `/api/v1/admin/connection-settings/${provider}`, headers: { authorization: "Bearer admin" }, payload: body });
    expect(response.statusCode).toBe(400);
    expect(f.settings.update).not.toHaveBeenCalled();
  });
});
