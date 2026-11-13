import Fastify from "fastify";
import { runtimeServiceSessionHeader } from "@linksense/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { internalWebSiteRoutes } from "../src/modules/web-sites/routes.js";
import type { WebSiteService } from "../src/modules/web-sites/service.js";

const sharedSecret = "internal-web-site-shared-secret";
const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const turnId = "60000000-0000-4000-8000-000000000001";
const publicBaseUrl = "https://linksense.example.test";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

async function setup() {
  const toolForOwner = vi.fn<WebSiteService["toolForOwner"]>().mockResolvedValue({ items: [], next_cursor: null });
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(internalWebSiteRoutes, {
    prefix: "/internal/web-sites",
    service: { toolForOwner } as unknown as WebSiteService,
    sharedSecret,
    publicBaseUrl,
  });
  return { app, toolForOwner };
}

describe("internal web site tool route", () => {
  it("authenticates the runner secret and forwards the owner, turn and validated request", async () => {
    const fixture = await setup();
    const response = await fixture.app.inject({
      method: "POST",
      url: "/internal/web-sites",
      headers: {
        authorization: `Bearer ${sharedSecret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        conversationId,
        turnId,
        request: { operation: "list", limit: 20 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fixture.toolForOwner).toHaveBeenCalledWith(
      ownerId,
      conversationId,
      turnId,
      { operation: "list", limit: 20 },
      publicBaseUrl,
    );
  });

  it("rejects a missing or incorrect runner secret", async () => {
    const fixture = await setup();
    for (const authorization of [undefined, "Bearer wrong"]) {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/internal/web-sites",
        headers: {
          ...(authorization ? { authorization } : {}),
          "x-linksense-owner-id": ownerId,
        },
        payload: { conversationId, turnId, request: { operation: "list" } },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error_code: "AUTH_REQUIRED" });
    }
    expect(fixture.toolForOwner).not.toHaveBeenCalled();
  });

  it("rejects a published service session before looking up or publishing sites", async () => {
    const fixture = await setup();
    const response = await fixture.app.inject({
      method: "POST",
      url: "/internal/web-sites",
      headers: {
        authorization: `Bearer ${sharedSecret}`,
        "x-linksense-owner-id": ownerId,
        [runtimeServiceSessionHeader]: conversationId,
      },
      payload: { conversationId, turnId, request: { operation: "list" } },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error_code: "FORBIDDEN" });
    expect(fixture.toolForOwner).not.toHaveBeenCalled();
  });

  it("rejects invalid owner, conversation, turn or request bodies before calling the service", async () => {
    const fixture = await setup();
    for (const payload of [
      { conversationId, turnId, request: { operation: "list", extra: true } },
      { conversationId: "not-a-uuid", turnId, request: { operation: "list" } },
      { conversationId, turnId: "not-a-uuid", request: { operation: "list" } },
      { conversationId, turnId, request: { operation: "publish", name: "Site" } },
    ]) {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/internal/web-sites",
        headers: {
          authorization: `Bearer ${sharedSecret}`,
          "x-linksense-owner-id": ownerId,
        },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(fixture.toolForOwner).not.toHaveBeenCalled();
  });

  it("keeps authorization failures structured", async () => {
    const fixture = await setup();
    fixture.toolForOwner.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    const response = await fixture.app.inject({
      method: "POST",
      url: "/internal/web-sites",
      headers: {
        authorization: `Bearer ${sharedSecret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: { conversationId, turnId, request: { operation: "list" } },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error_code: "FORBIDDEN" });
  });
});
