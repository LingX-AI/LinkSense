import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectionRoutes,
  internalConnectionRoutes,
} from "../src/modules/connections/routes.js";
import { AppError } from "../src/lib/errors.js";
import type { ConnectionService } from "../src/modules/connections/service.js";
const owner = "00000000-0000-4000-8000-000000000001";
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture() {
  const app = Fastify();
  apps.push(app);
  await app.register(cookie);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (request.headers.authorization !== "Bearer user")
      throw new AppError("AUTH_REQUIRED");
    request.authUser = {
      id: owner,
      role: "user",
      status: "active",
      name: "Member",
      email: "member@example.test",
      authValidAfter: new Date(0),
      preferredLocale: null,
      avatarObjectKey: null,
    };
  });
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(
        error instanceof AppError && error.code === "AUTH_REQUIRED" ? 401 : 400,
      )
      .send({
        error_code: error instanceof AppError ? error.code : "VALIDATION_ERROR",
      }),
  );
  const service = {
    list: vi.fn<ConnectionService["list"]>().mockResolvedValue([]),
    start: vi
      .fn<ConnectionService["start"]>()
      .mockResolvedValue(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      ),
    complete: vi.fn<ConnectionService["complete"]>().mockResolvedValue(),
    disconnect: vi.fn<ConnectionService["disconnect"]>().mockResolvedValue(),
    execute: vi
      .fn<ConnectionService["execute"]>()
      .mockResolvedValue({ kind: "connections", items: [] }),
  };
  await app.register(connectionRoutes, {
    service,
    publicBaseUrl: "https://app.example.test",
  });
  await app.register(internalConnectionRoutes, {
    prefix: "/internal",
    service,
    sharedSecret: "runner-secret",
  });
  return { app, service };
}
describe("connection routes", () => {
  it("accepts an authenticated upload above the default JSON body limit", async () => {
    const { app, service } = await fixture();
    const input = {
      operation: "create_file",
      provider: "onedrive",
      drive_id: "drive-1",
      name: "report.txt",
      content_base64: Buffer.alloc(2 * 1024 * 1024, 65).toString("base64"),
    };
    const response = await app.inject({
      method: "POST",
      url: "/internal/connections/execute",
      headers: {
        authorization: "Bearer runner-secret",
        "x-linksense-owner-id": owner,
      },
      payload: { conversationId: owner, turnId: owner, input },
    });
    expect(response.statusCode).toBe(200);
    expect(service.execute).toHaveBeenCalledWith(
      owner,
      owner,
      owner,
      input,
      expect.any(AbortSignal),
    );
  });
  it("requires a session and binds authorization to that user with a secure browser cookie", async () => {
    const { app, service } = await fixture();
    expect((await app.inject({ url: "/api/v1/connections" })).statusCode).toBe(
      401,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/connections/onedrive/authorize",
      headers: { authorization: "Bearer user" },
    });
    expect(response.statusCode).toBe(200);
    expect(service.start).toHaveBeenCalledWith(
      owner,
      "onedrive",
      expect.any(String),
    );
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("never reflects OAuth secrets or return addresses in a callback failure", async () => {
    const { app, service } = await fixture();
    service.complete.mockRejectedValue(new Error("secret-provider-error"));
    const response = await app.inject({
      url: "/api/v1/connectors/sharepoint/callback?state=state&code=secret&return_to=https://evil.test",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      "https://app.example.test/capabilities?section=connector&scope=personal&connection_result=failed",
    );
    expect(response.body).not.toContain("secret");
  });
  it("returns a successful authorization to the connector tab", async () => {
    const { app } = await fixture();
    const response = await app.inject({
      url: "/api/v1/connectors/onedrive/callback?state=state&code=code",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      "https://app.example.test/capabilities?section=connector&scope=personal&connection_result=success",
    );
  });
  it("authorizes user-owned disconnect and removes the obsolete enable endpoint", async () => {
    const { app, service } = await fixture();
    const headers = { authorization: "Bearer user" };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/v1/connections/onedrive",
          headers,
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/v1/connections/onedrive",
          headers,
        })
      ).statusCode,
    ).toBe(204);
    expect(service.disconnect).toHaveBeenCalledWith(owner, "onedrive");
  });
  it("rejects unauthenticated runner calls and service sessions before touching personal connections", async () => {
    const { app, service } = await fixture();
    const request = {
      method: "POST" as const,
      url: "/internal/connections/execute",
      payload: {
        conversationId: owner,
        turnId: owner,
        input: { operation: "list_connections" },
      },
    };
    expect((await app.inject(request)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          ...request,
          headers: {
            authorization: "Bearer runner-secret",
            "x-linksense-owner-id": owner,
            "x-linksense-service-session": "external-session",
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(service.execute).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          ...request,
          headers: {
            authorization: "Bearer runner-secret",
            "x-linksense-owner-id": owner,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(service.execute).toHaveBeenCalledWith(
      owner,
      owner,
      owner,
      { operation: "list_connections" },
      expect.any(AbortSignal),
    );
  });
});

it.each(["google_docs", "gmail", "outlook"])(
  "routes %s authorization and callback with a separate secure cookie",
  async (provider) => {
    const { app, service } = await fixture();
    const auth = await app.inject({
      method: "POST",
      url: `/api/v1/connections/${provider}/authorize`,
      headers: { authorization: "Bearer user" },
    });
    expect(auth.statusCode).toBe(200);
    expect(auth.headers["set-cookie"]).toContain(
      `linksense_connection_${provider}=`,
    );
    expect(service.start).toHaveBeenCalledWith(
      owner,
      provider,
      expect.any(String),
    );
    const callback = await app.inject({
      url: `/api/v1/connectors/${provider}/callback?state=state&code=code`,
      headers: { cookie: `linksense_connection_${provider}=browser-proof` },
    });
    expect(callback.statusCode).toBe(302);
    expect(service.complete).toHaveBeenCalledWith(
      provider,
      { state: "state", code: "code" },
      "browser-proof",
    );
    expect(callback.headers.location).toContain("connection_result=success");
  },
);

it.each([
  {
    provider: "google_docs",
    operation: "create_document",
    title: "test",
    text: "hello",
  },
  { provider: "gmail", operation: "send_draft", draft_id: "draft" },
  { provider: "outlook", operation: "read_mail", message_id: "mail" },
])(
  "passes workspace requests and responses through the authenticated internal API",
  async (input) => {
    const { app, service } = await fixture();
    service.execute.mockResolvedValue({
      kind: "workspace_data",
      data: { id: "result" },
      next_cursor: null,
    });
    const result = await app.inject({
      method: "POST",
      url: "/internal/connections/execute",
      headers: {
        authorization: "Bearer runner-secret",
        "x-linksense-owner-id": owner,
      },
      payload: { conversationId: owner, turnId: owner, input },
    });
    expect(result.statusCode).toBe(200);
    expect(service.execute).toHaveBeenCalledWith(
      owner,
      owner,
      owner,
      input,
      expect.any(AbortSignal),
    );
    expect(result.json()).toMatchObject({
      kind: "workspace_data",
      data: { id: "result" },
    });
  },
);
