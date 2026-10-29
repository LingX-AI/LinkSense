import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { errorDetails, normalizeError } from "../src/lib/errors.js";
import { internalSkillManagementRoutes } from "../src/modules/capabilities/internal-skill-management-routes.js";

const secret = "test-runner-secret-".repeat(3);
const ownerId = randomUUID(), conversationId = randomUUID(), turnId = randomUUID(), skillId = randomUUID();
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function fixture() {
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error);
    return reply.code(errorDetails(normalized.code, "zh-CN").status).send({ error_code: normalized.code });
  });
  const execute = vi.fn().mockResolvedValue({ success: true, operation: "list", items: [] });
  await app.register(internalSkillManagementRoutes, { prefix: "/internal/skills", service: { execute }, sharedSecret: secret });
  const headers = { authorization: `Bearer ${secret}`, "x-linksense-owner-id": ownerId };
  const payload = { conversationId, turnId, request: { operation: "list" } };
  return { app, execute, headers, payload };
}

describe("internal Skill management routes", () => {
  it("authenticates and forwards both operations using the immutable owner header", async () => {
    const f = await fixture();
    expect((await f.app.inject({ method: "POST", url: "/internal/skills/execute", headers: f.headers, payload: f.payload })).statusCode).toBe(200);
    expect(f.execute).toHaveBeenCalledWith(ownerId, f.payload);
    f.execute.mockResolvedValue({ success: true, operation: "uninstall", skill_id: skillId, name: "notes" });
    const payload = { ...f.payload, request: { operation: "uninstall", skill_id: skillId } };
    const response = await f.app.inject({ method: "POST", url: "/internal/skills/execute", headers: f.headers, payload });
    expect(response.statusCode).toBe(200);
    expect(f.execute).toHaveBeenLastCalledWith(ownerId, payload);
  });

  it.each([undefined, "wrong-secret"])("rejects secret %s before invoking the service", async token => {
    const f = await fixture();
    const response = await f.app.inject({ method: "POST", url: "/internal/skills/execute", headers: { "x-linksense-owner-id": ownerId, ...(token ? { authorization: `Bearer ${token}` } : {}) }, payload: f.payload });
    expect(response.statusCode).toBe(401);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each([{}, { "x-linksense-owner-id": "invalid" }])("rejects an invalid owner header %j", async ownerHeader => {
    const f = await fixture();
    const response = await f.app.inject({ method: "POST", url: "/internal/skills/execute", headers: { authorization: f.headers.authorization, ...ownerHeader }, payload: f.payload });
    expect(response.statusCode).toBe(400);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each([
    { ownerId },
    { request: { operation: "list", user_id: ownerId } },
    { request: { operation: "uninstall", skill_id: "../../other" } },
    { turnId: "native-turn" },
  ])("rejects invalid or owner-overriding input %j", async override => {
    const f = await fixture();
    const response = await f.app.inject({ method: "POST", url: "/internal/skills/execute", headers: f.headers, payload: { ...f.payload, ...override } });
    expect(response.statusCode).toBe(400);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("does not expose unexpected response fields or private error details", async () => {
    const f = await fixture();
    f.execute.mockResolvedValueOnce({ success: true, operation: "list", items: [], token: "private-value" }).mockRejectedValueOnce(new Error("private backend stack"));
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.app.inject({ method: "POST", url: "/internal/skills/execute", headers: f.headers, payload: f.payload });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain("private");
    }
  });
});
