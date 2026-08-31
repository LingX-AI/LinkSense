import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { feishuRoutes } from "../src/modules/feishu/routes.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000001";
const REGISTRATION_ID = "30000000-0000-4000-8000-000000000001";
const NOW = "2026-08-27T08:00:00.000Z";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Feishu routes", () => {
  it("maps list, automatic registration, status, and disconnect operations", async () => {
    const { app, service } = await createApp();

    const list = await app.inject({
      method: "GET",
      url: "/feishu",
      headers: { authorization: "Bearer member" },
    });
    const started = await app.inject({
      method: "POST",
      url: "/feishu/registration-sessions",
      headers: { authorization: "Bearer member" },
      payload: {},
    });
    const status = await app.inject({
      method: "GET",
      url: `/feishu/registration-sessions/${REGISTRATION_ID}`,
      headers: { authorization: "Bearer member" },
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/feishu/${CONNECTION_ID}`,
      headers: {
        authorization: "Bearer member",
        "user-agent": "route-test",
      },
    });

    expect(list.statusCode).toBe(200);
    expect(started.statusCode).toBe(201);
    expect(status.statusCode).toBe(200);
    expect(deleted.statusCode).toBe(204);
    expect(service.startRegistration).toHaveBeenCalledWith(OWNER_ID, {
      allowExistingSelection: false,
      forceCreate: false,
    });
    expect(service.getRegistration).toHaveBeenCalledWith(
      OWNER_ID,
      REGISTRATION_ID,
    );
    expect(service.deleteConnection).toHaveBeenCalledWith(
      OWNER_ID,
      CONNECTION_ID,
      expect.objectContaining({ userAgent: "route-test" }),
    );
    expect(started.body).not.toMatch(/app_secret|client_secret/iu);
  });

  it("allows recovery by selecting a bot created by an earlier failed attempt", async () => {
    const { app, service } = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/feishu/registration-sessions",
      headers: { authorization: "Bearer member" },
      payload: { reuse_existing: true },
    });

    expect(response.statusCode).toBe(201);
    expect(service.startRegistration).toHaveBeenCalledWith(OWNER_ID, {
      allowExistingSelection: true,
      forceCreate: false,
    });
  });

  it("allows replacing an app that was deleted in Feishu", async () => {
    const { app, service } = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/feishu/registration-sessions",
      headers: { authorization: "Bearer member" },
      payload: { force_create: true },
    });

    expect(response.statusCode).toBe(201);
    expect(service.startRegistration).toHaveBeenCalledWith(OWNER_ID, {
      allowExistingSelection: false,
      forceCreate: true,
    });
  });

  it("rejects credentials and unknown fields before starting registration", async () => {
    const { app, service } = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/feishu/registration-sessions",
      headers: { authorization: "Bearer member" },
      payload: {
        app_id: "cli_0123456789abcdef",
        app_secret: "must-not-be-accepted",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(service.startRegistration).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const { app, service } = await createApp();

    const response = await app.inject({ method: "GET", url: "/feishu" });

    expect(response.statusCode).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
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
    bot_name: "LinkSense 个人助手",
    status: "active" as const,
    runtime_status: "online" as const,
    last_connected_at: NOW,
    last_inbound_at: null,
    last_error_code: null,
    created_at: NOW,
    updated_at: NOW,
  };
  const registration = {
    id: REGISTRATION_ID,
    operation: "create" as const,
    status: "waiting_scan" as const,
    qrcode_url: "https://open.feishu.cn/scan/create-bot",
    expires_at: NOW,
    connection: null,
  };
  const service = {
    list: vi.fn(async () => ({ items: [connection] })),
    startRegistration: vi.fn(async () => registration),
    getRegistration: vi.fn(async () => registration),
    deleteConnection: vi.fn(async () => undefined),
  };
  await app.register(feishuRoutes, {
    prefix: "/feishu",
    service: service as never,
  });
  await app.ready();
  return { app, service };
}
