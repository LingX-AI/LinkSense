import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeServiceSessionHeader } from "@linksense/shared";
import { registerRunnerRuntimeScope } from "../src/modules/events/runtime-scope.js";
import { serviceWorkspaceRelativePath, projectWorkspaceRelativePath } from "../src/lib/user-runtime-paths.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";

const owner = randomUUID(), service = randomUUID(), task = randomUUID();
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function fixture(workspace = serviceWorkspaceRelativePath(owner, service)) {
  const app = Fastify(); apps.push(app);
  const findFirst = vi.fn(async ({ where }: { where: { id: string; ownerId: string } }) =>
    where.id === task && where.ownerId === owner ? { workspaceRelPath: workspace } : null);
  registerRunnerRuntimeScope(app, { conversation: { findFirst } } as unknown as Pick<PrismaClient, "conversation">, "test-controller-secret");
  app.setErrorHandler((error, _request, reply) => reply.code(403).send({ error: error instanceof Error ? error.message : "error" }));
  app.post("/internal/runner/events", () => ({ accepted: true }));
  app.post("/internal/skill-creator/confirm", () => ({ accepted: true }));
  const send = (scope: string | undefined, conversationId = task, token = "test-controller-secret", url = "/internal/runner/events") => app.inject({
    method: "POST", url, headers: { authorization: `Bearer ${token}`, "x-linksense-owner-id": owner, ...(scope ? { [runtimeServiceSessionHeader]: scope } : {}) }, payload: { conversationId },
  });
  return { send, findFirst };
}

describe("runner callback environment authorization", () => {
  it("accepts a task or branch in its persisted service environment", async () => {
    const f = fixture(); expect((await f.send(service)).statusCode).toBe(200);
  });
  it("rejects another service, an unknown task, and missing scope", async () => {
    const f = fixture();
    for (const scope of [randomUUID(), undefined]) expect((await f.send(scope)).statusCode).toBe(403);
    expect((await f.send(service, randomUUID())).statusCode).toBe(403);
  });
  it("does not allow a service callback to enter personal tasks or install personal skills", async () => {
    const f = fixture(projectWorkspaceRelativePath(owner, null));
    expect((await f.send(service)).statusCode).toBe(403);
    expect((await f.send(undefined)).statusCode).toBe(200);
    expect((await f.send(service, task, "test-controller-secret", "/internal/skill-creator/confirm")).statusCode).toBe(403);
  });
  it("rejects an unauthenticated callback before reading task data", async () => {
    const f = fixture(); expect((await f.send(service, task, "wrong")).statusCode).toBe(403);
    expect(f.findFirst).not.toHaveBeenCalled();
  });
});
