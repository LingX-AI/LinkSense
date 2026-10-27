import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { internalAutomationRoutes } from "../src/modules/automations/internal-routes.js";
import { normalizeError } from "../src/lib/errors.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const secret = "automation-runner-secret-".repeat(3);
const body = {
  conversationId: ownerId,
  turnId: ownerId,
  request: { operation: "list" },
};

describe("automation internal routes", () => {
  it("forwards the validated request with the authenticated owner and audit context", async () => {
    const execute = vi.fn(async () => ({
      operation: "delete" as const,
      automation_id: ownerId,
    }));
    const app = Fastify();
    await app.register(internalAutomationRoutes, {
      prefix: "/internal/automations",
      sharedSecret: secret,
      service: { execute },
    });
    const response = await app.inject({
      method: "POST",
      url: "/internal/automations/execute",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      ownerId,
      body,
      expect.objectContaining({ userAgent: expect.any(String) }),
    );
    await app.close();
  });

  it.each([
    "missing_secret",
    "wrong_secret",
    "service_session",
    "forged_owner",
    "extra_identity",
  ])("rejects %s before invoking business operations", async (condition) => {
    const execute = vi.fn();
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) =>
      reply.code(400).send({ error_code: normalizeError(error).code }),
    );
    await app.register(internalAutomationRoutes, {
      prefix: "/internal/automations",
      sharedSecret: secret,
      service: { execute },
    });
    const headers: Record<string, string> = {
      authorization: `Bearer ${secret}`,
      "x-linksense-owner-id": ownerId,
    };
    if (condition === "missing_secret") delete headers.authorization;
    if (condition === "wrong_secret") headers.authorization = "Bearer wrong";
    if (condition === "service_session")
      headers["x-linksense-service-session"] = ownerId;
    if (condition === "forged_owner")
      headers["x-linksense-owner-id"] = "invalid";
    const response = await app.inject({
      method: "POST",
      url: "/internal/automations/execute",
      headers,
      payload:
        condition === "extra_identity"
          ? { ...body, request: { ...body.request, owner_id: ownerId } }
          : body,
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(execute).not.toHaveBeenCalled();
    await app.close();
  });
});
