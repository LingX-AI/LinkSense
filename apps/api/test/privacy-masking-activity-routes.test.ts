import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAppError } from "../src/lib/http.js";
import { internalRunnerRoutes } from "../src/modules/events/routes.js";
import type { AppServices } from "../src/services.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const headers = {
  authorization: "Bearer runner-secret",
  "x-linksense-owner-id": OWNER_ID,
};
const capture = {
  request_id: "30000000-0000-4000-8000-000000000001",
  owner_id: OWNER_ID,
  conversation_id: "20000000-0000-4000-8000-000000000001",
  turn_id: "turn-1",
  model: "model-a",
  kinds: { API_KEY: 2 },
  masked_count: 2,
  observed_at: "2026-11-17T08:00:00.000Z",
};

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture() {
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error)
  );
  const record = vi.fn().mockResolvedValue(undefined);
  await app.register(internalRunnerRoutes, {
    services: {
      config: { runnerSharedSecret: "runner-secret" },
      privacyMaskingActivity: { record },
    } as unknown as AppServices,
  });
  return { app, record };
}

describe("internal privacy masking activity", () => {
  it("records a counts-only capture for the authenticated owner", async () => {
    const { app, record } = await fixture();
    const response = await app.inject({
      method: "POST",
      url: "/runner/privacy-masking",
      headers,
      payload: capture,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toEqual({ recorded: true });
    expect(record).toHaveBeenCalledExactlyOnceWith(capture);
  });

  it.each([{}, { authorization: "Bearer invalid" }])(
    "rejects unauthenticated workers",
    async (requestHeaders) => {
      const { app, record } = await fixture();
      const response = await app.inject({
        method: "POST",
        url: "/runner/privacy-masking",
        headers: requestHeaders,
        payload: capture,
      });
      expect(response.statusCode).toBe(401);
      expect(record).not.toHaveBeenCalled();
    }
  );

  it("rejects a capture for another owner", async () => {
    const { app, record } = await fixture();
    const response = await app.inject({
      method: "POST",
      url: "/runner/privacy-masking",
      headers,
      payload: {
        ...capture,
        owner_id: "10000000-0000-4000-8000-000000000002",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    { ...capture, kinds: { NOT_A_KIND: 1 } },
    { ...capture, masked_count: 0 },
    { ...capture, request_id: "not-a-uuid" },
  ])("rejects an invalid capture before invoking the service", async (payload) => {
    const { app, record } = await fixture();
    const response = await app.inject({
      method: "POST",
      url: "/runner/privacy-masking",
      headers,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });
});
