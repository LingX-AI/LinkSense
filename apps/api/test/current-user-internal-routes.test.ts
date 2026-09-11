import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { internalCurrentUserRoutes } from "../src/modules/users/internal-routes.js";
import type { UserService } from "../src/modules/users/service.js";

const SHARED_SECRET = "shared-secret-material-that-is-at-least-32-bytes";
const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const TURN_ID = "30000000-0000-4000-8000-000000000001";

describe("internalCurrentUserRoutes", () => {
  it("authenticates the runner and resolves info for the owner header", async () => {
    const getCurrentUserInfo = vi.fn(async () => ({
      success: true,
      user: {
        name: "Ada",
        email: "ada@example.com",
        user_groups: [
          {
            id: "00000000-0000-4000-8000-000000000021",
            name: "Research",
          },
        ],
      },
      credit_quota: { total: null, weekly: null, monthly: null },
    }));
    const app = await createApp(getCurrentUserInfo);

    const response = await app.inject({
      method: "POST",
      url: "/internal/current-user/info",
      headers: {
        authorization: `Bearer ${SHARED_SECRET}`,
        "x-linksense-owner-id": OWNER_ID,
      },
      payload: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      user: {
        name: "Ada",
        email: "ada@example.com",
        user_groups: [
          {
            id: "00000000-0000-4000-8000-000000000021",
            name: "Research",
          },
        ],
      },
      credit_quota: { total: null, weekly: null, monthly: null },
    });
    expect(getCurrentUserInfo).toHaveBeenCalledWith(OWNER_ID);
    await app.close();
  });

  it("rejects requests without the runner secret before invoking the service", async () => {
    const getCurrentUserInfo = vi.fn();
    const app = await createApp(getCurrentUserInfo);

    const response = await app.inject({
      method: "POST",
      url: "/internal/current-user/info",
      headers: { "x-linksense-owner-id": OWNER_ID },
      payload: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(getCurrentUserInfo).not.toHaveBeenCalled();
    await app.close();
  });
});

async function createApp(getCurrentUserInfo: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  await app.register(internalCurrentUserRoutes, {
    prefix: "/internal",
    service: { getCurrentUserInfo } as unknown as UserService,
    sharedSecret: SHARED_SECRET,
  });
  return app;
}
