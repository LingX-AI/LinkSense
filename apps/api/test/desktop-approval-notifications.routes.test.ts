import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { conversationRoutes } from "../src/modules/conversations/routes.js";
import type { AppServices } from "../src/services.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const EXPIRES_AT = "2026-11-20T00:03:00.000Z";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("desktop approval notification routes", () => {
  it("requires authentication before reading notifications", async () => {
    const { app, list } = await routeFixture();

    const response = await app.inject({
      method: "GET",
      url: "/desktop-approval-notifications",
    });

    expect(response.statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it("returns an empty snapshot without reading the database when the flag is off", async () => {
    const { app, list } = await routeFixture({
      desktopNativeApprovalsEnabled: false,
    });

    const response = await app.inject({
      method: "GET",
      url: "/desktop-approval-notifications",
      headers: { authorization: "Bearer member" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { items: [] },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(list).not.toHaveBeenCalled();
  });

  it("lists the authenticated owner's pending approvals without caching", async () => {
    const { app, list } = await routeFixture();

    const response = await app.inject({
      method: "GET",
      url: "/desktop-approval-notifications",
      headers: { authorization: "Bearer member" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        items: [
          {
            conversation_id: CONVERSATION_ID,
            request_id: REQUEST_ID,
            expires_at: EXPIRES_AT,
          },
        ],
      },
    });
    expect(list).toHaveBeenCalledWith(OWNER_ID, {});
  });

  it("checks the exact pair on click without an identity oracle", async () => {
    const { app, list } = await routeFixture({
      result: { items: [] },
    });

    const response = await app.inject({
      method: "GET",
      url:
        `/desktop-approval-notifications?conversation_id=${CONVERSATION_ID}` +
        `&request_id=${REQUEST_ID}`,
      headers: { authorization: "Bearer member" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { items: [] },
    });
    expect(list).toHaveBeenCalledWith(OWNER_ID, {
      conversationId: CONVERSATION_ID,
      requestId: REQUEST_ID,
    });
  });

  it.each([
    ["a lone conversation", `conversation_id=${CONVERSATION_ID}`],
    ["a lone request", `request_id=${REQUEST_ID}`],
    ["a non-uuid pair", "conversation_id=conversation&request_id=request"],
    ["an unknown extra parameter", "limit=10"],
    [
      "duplicate parameters",
      `conversation_id=${CONVERSATION_ID}&conversation_id=${CONVERSATION_ID}` +
        `&request_id=${REQUEST_ID}&request_id=${REQUEST_ID}`,
    ],
  ])("rejects %s with a strict validation error", async (_label, query) => {
    const { app, list } = await routeFixture();

    const response = await app.inject({
      method: "GET",
      url: `/desktop-approval-notifications?${query}`,
      headers: { authorization: "Bearer member" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      error_code: "VALIDATION_ERROR",
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("keeps the notification snapshot free of approval details", async () => {
    const { app } = await routeFixture();

    const response = await app.inject({
      method: "GET",
      url: "/desktop-approval-notifications",
      headers: { authorization: "Bearer member" },
    });

    const [item] = response.json().data.items as Array<
      Record<string, unknown>
    >;
    expect(Object.keys(item!).sort()).toEqual([
      "conversation_id",
      "expires_at",
      "request_id",
    ]);
  });
});

async function routeFixture(options: {
  desktopNativeApprovalsEnabled?: boolean;
  result?: { items: Array<Record<string, string>> };
} = {}) {
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
  const list = vi.fn(async () =>
    options.result ?? {
      items: [
        {
          conversation_id: CONVERSATION_ID,
          request_id: REQUEST_ID,
          expires_at: EXPIRES_AT,
        },
      ],
    },
  );
  const services = {
    config: {
      desktopNativeApprovalsEnabled:
        options.desktopNativeApprovalsEnabled ?? true,
    },
    conversations: { listDesktopApprovalNotifications: list },
  } as unknown as AppServices;
  await app.register(conversationRoutes, { services });
  await app.ready();
  return { app, list };
}
