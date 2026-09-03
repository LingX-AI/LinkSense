import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAppError } from "../src/lib/http.js";
import { publicConversationShareRoutes } from "../src/modules/conversations/share-routes.js";

const SHARE_ID = "30000000-0000-4000-8000-000000000001";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("public conversation share route", () => {
  it("returns a share without authentication", async () => {
    const get = vi.fn(async () => ({ id: SHARE_ID, snapshot: {} }));
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(publicConversationShareRoutes, {
      prefix: "/shared-conversations",
      service: { get } as never,
    });

    const response = await app.inject({
      method: "GET",
      url: `/shared-conversations/${SHARE_ID}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(get).toHaveBeenCalledWith(SHARE_ID);
  });

  it("rejects malformed share identifiers before reading storage", async () => {
    const get = vi.fn();
    const app = Fastify();
    apps.push(app);
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(publicConversationShareRoutes, {
      prefix: "/shared-conversations",
      service: { get } as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/shared-conversations/not-a-token",
    });

    expect(response.statusCode).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });
});
