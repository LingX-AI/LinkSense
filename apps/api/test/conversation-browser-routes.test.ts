import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserPanelRequest, BrowserPanelState } from "@linksense/shared";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { conversationBrowserRoutes } from "../src/modules/conversations/browser-routes.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const token = "30000000-0000-4000-8000-000000000001";
const frame: BrowserPanelState = {
  mode: "agent",
  has_control: false,
  lease_expires_at: null,
  frame: {
    image: "AQID",
    url: "https://example.test/",
    title: "Test page",
    width: 1280,
    height: 720,
  },
};
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("conversation browser routes", () => {
  it.each(["frame", "claim", "release", "input"] as const)(
    "authenticates before a browser %s operation",
    async (action) => {
      const { app, browserPanel } = await fixture();
      const response = await app.inject({
        method: "POST",
        url: `/conversations/${conversationId}/browser`,
        payload: { action, token },
      });

      expect(response.statusCode).toBe(401);
      expect(browserPanel).not.toHaveBeenCalled();
    },
  );

  it.each<BrowserPanelRequest>([
    { action: "frame" },
    { action: "frame", token },
    { action: "claim", token },
    { action: "release", token },
    { action: "input", token, input: { type: "text", text: "Test input" } },
  ])(
    "binds $action to the authenticated owner and task and prevents frame caching",
    async (input) => {
      const { app, browserPanel } = await fixture();
      const response = await app.inject({
        method: "POST",
        url: `/conversations/${conversationId}/browser`,
        headers: {
          authorization: "Bearer member",
          "x-linksense-owner-id": conversationId,
        },
        payload: input,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.json()).toMatchObject({
        success: true,
        data: frame,
        request_id: expect.any(String),
      });
      expect(browserPanel).toHaveBeenCalledExactlyOnceWith(
        ownerId,
        conversationId,
        input,
      );
    },
  );

  it.each([
    { action: "frame", owner_id: conversationId },
    { action: "claim" },
    { action: "claim", token: "invalid" },
    { action: "input", token, input: { type: "click", x: 2, y: 0 } },
    { action: "input", token, input: { type: "key", key: "arbitrary-code" } },
    { action: "input", token, input: { type: "text", text: "x".repeat(4097) } },
  ])(
    "rejects malformed or unbounded browser input before delegation",
    async (payload) => {
      const { app, browserPanel } = await fixture();
      const response = await app.inject({
        method: "POST",
        url: `/conversations/${conversationId}/browser`,
        headers: { authorization: "Bearer member" },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
      expect(browserPanel).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid task IDs and oversized bodies", async () => {
    const { app, browserPanel } = await fixture();
    const invalidId = await app.inject({
      method: "POST",
      url: "/conversations/invalid/browser",
      headers: { authorization: "Bearer member" },
      payload: { action: "frame" },
    });
    const oversized = await app.inject({
      method: "POST",
      url: `/conversations/${conversationId}/browser`,
      headers: { authorization: "Bearer member" },
      payload: {
        action: "input",
        token,
        input: { type: "text", text: "x".repeat(24_000) },
      },
    });

    expect(invalidId.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(413);
    expect(browserPanel).not.toHaveBeenCalled();
  });

  it("preserves owner-authorization failures without returning a frame", async () => {
    const { app, browserPanel } = await fixture();
    browserPanel.mockRejectedValueOnce(new AppError("CONVERSATION_NOT_FOUND"));
    const response = await app.inject({
      method: "POST",
      url: `/conversations/${conversationId}/browser`,
      headers: { authorization: "Bearer member" },
      payload: { action: "frame" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error_code: "CONVERSATION_NOT_FOUND",
    });
    expect(response.json()).not.toHaveProperty("data");
  });
});

async function fixture() {
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (request.headers.authorization !== "Bearer member")
      throw new AppError("AUTH_REQUIRED");
    request.authUser = {
      id: ownerId,
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
  const browserPanel = vi.fn<
    (
      owner: string,
      conversation: string,
      input: BrowserPanelRequest,
    ) => Promise<BrowserPanelState>
  >(async () => frame);
  await app.register(conversationBrowserRoutes, {
    prefix: "/conversations",
    services: { conversations: { browserPanel } },
  });
  await app.ready();
  return { app, browserPanel };
}
