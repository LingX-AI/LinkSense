import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { runtimeServiceSessionHeader } from "@linksense/shared";
import { internalRunnerRoutes } from "../src/modules/events/routes.js";
import { sendAppError } from "../src/lib/http.js";
import { AppError } from "../src/lib/errors.js";
import type { AppServices } from "../src/services.js";

const applicationId = "00000000-0000-4000-8000-000000000001",
  conversationId = "00000000-0000-4000-8000-000000000002",
  turnId = "00000000-0000-4000-8000-000000000003",
  deliveryId = "00000000-0000-4000-8000-000000000004";
const native = {
  method: "turn/started",
  visibility: "user_visible",
  params: {
    threadId: conversationId,
    turn: { id: turnId, status: "inProgress" },
  },
};
const payload = {
  conversationId,
  events: [
    {
      deliveryId,
      event: {
        method: "linksense/publicKnowledge/progress",
        visibility: "user_visible",
        params: { threadId: conversationId, turnId, notification: native },
      },
    },
  ],
};
async function fixture() {
  const ingestRunnerEvents = vi.fn(async (owner: string) => {
    if (owner !== applicationId) throw new AppError("FORBIDDEN");
  });
  const assertOwner = vi.fn(async () => undefined),
    ingest = vi.fn(async () => ({ accepted: true }));
  const app = Fastify();
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  await app.register(internalRunnerRoutes, {
    services: {
      config: { runnerSharedSecret: "fixture-secret" },
      publicKnowledge: { ingestRunnerEvents },
      conversations: { assertOwner },
      events: { ingest },
    } as unknown as AppServices,
  });
  return { app, ingestRunnerEvents, assertOwner, ingest };
}
describe("public progress runner delivery", () => {
  it("routes public deliveries separately and acknowledges the exact durable prefix", async () => {
    const f = await fixture();
    try {
      const response = await f.app.inject({
        method: "POST",
        url: "/runner/events",
        headers: {
          authorization: "Bearer fixture-secret",
          "x-linksense-owner-id": applicationId,
          [runtimeServiceSessionHeader]: applicationId,
        },
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.accepted_delivery_ids).toEqual([deliveryId]);
      expect(f.ingestRunnerEvents).toHaveBeenCalledOnce();
      expect(f.assertOwner).not.toHaveBeenCalled();
      expect(f.ingest).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it("rejects unauthenticated, foreign-worker, mismatched-session and mixed-domain deliveries", async () => {
    const f = await fixture();
    try {
      for (const [headers, status] of [
        [{}, 401],
        [
          {
            authorization: "Bearer forged",
            "x-linksense-owner-id": applicationId,
          },
          401,
        ],
        [
          {
            authorization: "Bearer fixture-secret",
            "x-linksense-owner-id": turnId,
          },
          403,
        ],
        [
          {
            authorization: "Bearer fixture-secret",
            "x-linksense-owner-id": applicationId,
            [runtimeServiceSessionHeader]: turnId,
          },
          403,
        ],
      ] as const) {
        expect(
          (
            await f.app.inject({
              method: "POST",
              url: "/runner/events",
              headers,
              payload,
            })
          ).statusCode,
        ).toBe(status);
      }
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/runner/events",
            headers: {
              authorization: "Bearer fixture-secret",
              "x-linksense-owner-id": applicationId,
            },
            payload: {
              ...payload,
              events: [
                ...payload.events,
                { deliveryId: turnId, event: native },
              ],
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(f.assertOwner).not.toHaveBeenCalled();
      expect(f.ingest).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it("keeps ordinary runner delivery on its existing authorization and ingestion path", async () => {
    const f = await fixture();
    try {
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/runner/events",
            headers: {
              authorization: "Bearer fixture-secret",
              "x-linksense-owner-id": applicationId,
            },
            payload: {
              conversationId,
              events: [{ deliveryId, event: native }],
            },
          })
        ).statusCode,
      ).toBe(200);
      expect(f.assertOwner).toHaveBeenCalledWith(applicationId, conversationId);
      expect(f.ingest).toHaveBeenCalledOnce();
      expect(f.ingestRunnerEvents).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
});
