import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { weixinRoutes } from "../src/modules/weixin/routes.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000001";
const LOGIN_ID = "30000000-0000-4000-8000-000000000001";
const APPLICATION_ID = "40000000-0000-4000-8000-000000000001";
const NOW = "2026-08-13T08:00:00.000Z";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Weixin routes", () => {
  it("maps login, verification, binding, and disconnect operations", async () => {
    const { app, service } = await createApp();

    const started = await app.inject({
      method: "POST",
      url: "/weixin/login-sessions",
      headers: { authorization: "Bearer member" },
      payload: { application_id: APPLICATION_ID },
    });
    expect(started.statusCode).toBe(201);
    expect(service.startLogin).toHaveBeenCalledWith(OWNER_ID, {
      application_id: APPLICATION_ID,
    });
    expect(started.body).not.toContain("bot-token");
    expect(started.body).not.toContain("opaque-qr-id");

    const verified = await app.inject({
      method: "POST",
      url: `/weixin/login-sessions/${LOGIN_ID}/verification`,
      headers: { authorization: "Bearer member" },
      payload: { verify_code: " 123456 " },
    });
    expect(verified.statusCode).toBe(200);
    expect(service.submitVerification).toHaveBeenCalledWith(
      OWNER_ID,
      LOGIN_ID,
      "123456",
    );

    const updated = await app.inject({
      method: "PATCH",
      url: `/weixin/${CONNECTION_ID}`,
      headers: {
        authorization: "Bearer member",
        "user-agent": "route-test",
      },
      payload: { application_id: null },
    });
    expect(updated.statusCode).toBe(200);
    expect(service.updateConnection).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
      { application_id: null },
      expect.objectContaining({ userAgent: "route-test" }),
    );

    const deleted = await app.inject({
      method: "DELETE",
      url: `/weixin/${CONNECTION_ID}`,
      headers: { authorization: "Bearer member" },
    });
    expect(deleted.statusCode).toBe(204);
    expect(service.deleteConnection).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
      expect.any(Object),
    );
  });

  it("rejects malformed verification and unknown fields before service calls", async () => {
    const { app, service } = await createApp();

    const invalidCode = await app.inject({
      method: "POST",
      url: `/weixin/login-sessions/${LOGIN_ID}/verification`,
      headers: { authorization: "Bearer member" },
      payload: { verify_code: "12ab" },
    });
    const unknownField = await app.inject({
      method: "POST",
      url: "/weixin/login-sessions",
      headers: { authorization: "Bearer member" },
      payload: { application_id: null, bot_token: "must-not-be-accepted" },
    });

    expect(invalidCode.statusCode).toBe(400);
    expect(unknownField.statusCode).toBe(400);
    expect(service.submitVerification).not.toHaveBeenCalled();
    expect(service.startLogin).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const { app, service } = await createApp();

    const response = await app.inject({ method: "GET", url: "/weixin" });

    expect(response.statusCode).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
  });

  it("rejects oversized control-plane JSON before authentication", async () => {
    const { app, service } = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/weixin/login-sessions",
      payload: { padding: "x".repeat(17 * 1_024) },
    });

    expect(response.statusCode).toBe(413);
    expect(service.startLogin).not.toHaveBeenCalled();
  });
});

async function createApp() {
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (request.headers.authorization !== "Bearer member") {
      throw new AppError("AUTH_REQUIRED");
    }
    request.authUser = {
      id: OWNER_ID,
      email: "member@example.test",
      name: "Member",
      role: "user",
      status: "active",
      preferredLocale: "zh-CN",
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    };
  });
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  const connection = {
    id: CONNECTION_ID,
    account_hint: "****1234",
    application: null,
    status: "active" as const,
    runtime_status: "online" as const,
    last_poll_at: NOW,
    last_inbound_at: null,
    last_error_code: null,
    created_at: NOW,
    updated_at: NOW,
  };
  const login = {
    id: LOGIN_ID,
    status: "waiting_scan" as const,
    qrcode_url: "https://weixin.qq.com/x/scan-me",
    expires_at: NOW,
    connection: null,
  };
  const service = {
    list: vi.fn(async () => ({ items: [connection] })),
    startLogin: vi.fn(async () => login),
    getLogin: vi.fn(async () => login),
    submitVerification: vi.fn(async () => ({ ...login, status: "scanned" as const })),
    updateConnection: vi.fn(async () => connection),
    deleteConnection: vi.fn(async () => undefined),
  };
  await app.register(weixinRoutes, {
    prefix: "/weixin",
    service: service as never,
  });
  await app.ready();
  return { app, service };
}
