import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { completionNotificationRoutes } from "../src/modules/completion-notifications/routes.js";
import type { CompletionNotificationService } from "../src/modules/completion-notifications/service.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const TURN_ID = "20000000-0000-4000-8000-000000000001";
const COMPLETED_AT = "2026-08-09T10:00:00.000Z";
const CURSOR = `v3|${COMPLETED_AT}|${TURN_ID}|${COMPLETED_AT}|${TURN_ID}|forward||||||`;
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("completion notification routes", () => {
  it("requires authentication", async () => {
    const { app, list } = await routeFixture();

    const response = await app.inject({
      method: "GET",
      url: "/completion-notifications",
    });

    expect(response.statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it("establishes a baseline when no cursor is provided", async () => {
    const { app, list } = await routeFixture();

    const response = await app.inject({
      method: "GET",
      url: "/completion-notifications",
      headers: { authorization: "Bearer member" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { items: [], next_cursor: CURSOR },
    });
    expect(list).toHaveBeenCalledWith(OWNER_ID, { limit: 100 });
  });

  it("parses a bounded cursor request for the authenticated user", async () => {
    const { app, list } = await routeFixture();

    const response = await app.inject({
      method: "GET",
      url: `/completion-notifications?cursor=${encodeURIComponent(CURSOR)}&limit=25`,
      headers: { authorization: "Bearer member" },
    });

    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(OWNER_ID, {
      cursor: {
        baseline: { terminalAt: new Date(COMPLETED_AT), turnId: TURN_ID },
        position: { terminalAt: new Date(COMPLETED_AT), turnId: TURN_ID },
        nextLane: "forward",
        replay: null,
      },
      limit: 25,
    });
  });

  it("rejects malformed or out-of-range query values", async () => {
    const { app, list } = await routeFixture();

    const invalidCursor = await app.inject({
      method: "GET",
      url: "/completion-notifications?cursor=invalid",
      headers: { authorization: "Bearer member" },
    });
    const invalidLimit = await app.inject({
      method: "GET",
      url: `/completion-notifications?cursor=${encodeURIComponent(CURSOR)}&limit=101`,
      headers: { authorization: "Bearer member" },
    });

    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidLimit.statusCode).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});

async function routeFixture() {
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
  const list = vi.fn(async () => ({ items: [], next_cursor: CURSOR }));
  await app.register(completionNotificationRoutes, {
    prefix: "/completion-notifications",
    service: { list } as unknown as CompletionNotificationService,
  });
  await app.ready();
  return { app, list };
}
