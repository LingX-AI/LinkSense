import Fastify from "fastify";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applicationDevelopmentSchema } from "@linksense/shared";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { applicationDevelopmentRoutes, internalApplicationBuilderRoutes } from "../src/modules/applications/development-routes.js";
import { OWNER, TASK, actor, developmentFixture } from "./application-development.fixture.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(clean => clean())); });
async function setup() {
  const f = await developmentFixture(); const app = Fastify();
  cleanups.push(async () => { await app.close(); await rm(f.root, { recursive: true, force: true }); });
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  app.decorate("authenticate", async request => {
    if (request.headers.authorization !== "Bearer owner") throw new AppError("AUTH_REQUIRED");
    Object.assign(request, { authUser: { ...actor, preferredLocale: "en-US" } });
  });
  await app.register(applicationDevelopmentRoutes, { prefix: "/api/v1/application-developments", service: f.service });
  await app.register(internalApplicationBuilderRoutes, { prefix: "/internal/application-builder", service: f.service, sharedSecret: "test-internal-shared-secret" });
  return { ...f, app };
}
describe("application development API", () => {
  it.each([undefined, "", "测试"])("publishes and updates reviewed source with release-only parameters and usage instructions %s", async usageInstructions => {
    const { app, service, installed } = await setup();
    const headers = { authorization: "Bearer owner" };
    const base = "/api/v1/application-developments";
    const created = await app.inject({ method: "POST", url: base, headers, payload: { name: "Publish through HTTP" } });
    const project = applicationDevelopmentSchema.parse(created.json().data);
    const install = vi.spyOn(service, "install");
    let applicationId: string | null = null;
    for (const version of ["1.1.0", "1.1.1"]) {
      const response = await app.inject({ method: "POST", url: `${base}/${project.id}/install`, headers, payload: {
        source_hash: project.source_hash,
        version_number: version,
        ...(usageInstructions === undefined ? {} : { usage_instructions: usageInstructions }),
      } });
      expect(response.statusCode).toBe(200);
      expect(install).toHaveBeenLastCalledWith(expect.objectContaining({ id: OWNER }), project.id, project.source_hash, {
        version_number: version, usage_instructions: usageInstructions ?? "",
      });
      const published = applicationDevelopmentSchema.parse(response.json().data);
      expect(published.installed_source_hash).toBe(project.source_hash);
      expect(published.application_id).not.toBeNull();
      if (applicationId) expect(published.application_id).toBe(applicationId);
      applicationId = published.application_id;
      expect(installed.size).toBe(1);
    }
  });

  it("rejects invalid publication fields before installing and still checks the reviewed source hash", async () => {
    const { app, service, installed } = await setup();
    const base = "/api/v1/application-developments";
    const headers = { authorization: "Bearer owner" };
    const created = await app.inject({ method: "POST", url: base, headers, payload: { name: "Publication validation" } });
    const project = applicationDevelopmentSchema.parse(created.json().data);
    const install = vi.spyOn(service, "install");
    const payload = { source_hash: project.source_hash, version_number: "1.1.1", usage_instructions: "测试" };
    for (const invalid of [{ ...payload, version_number: "1.1" }, { ...payload, usage_instructions: "x".repeat(20_001) }, { ...payload, owner_id: OWNER }]) {
      expect((await app.inject({ method: "POST", url: `${base}/${project.id}/install`, headers, payload: invalid })).statusCode).toBe(400);
    }
    expect(install).not.toHaveBeenCalled();
    const stale = await app.inject({ method: "POST", url: `${base}/${project.id}/install`, headers, payload: { ...payload, source_hash: "b".repeat(64) } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error_code).toBe("APPLICATION_DEVELOPMENT_SOURCE_CHANGED");
    expect(installed.size).toBe(0);
  });

  it("updates source metadata with authentication, ownership, validation and conflict checks", async () => {
    const { app } = await setup(); const base = "/api/v1/application-developments";
    const headers = { authorization: "Bearer owner" };
    const created = await app.inject({ method: "POST", url: base, headers, payload: { name: "Original" } });
    const project = created.json().data;
    const url = `${base}/${project.id}/metadata`;
    const payload = { source_hash: project.source_hash, name: "Renamed", description: "Description" };
    expect((await app.inject({ method: "PATCH", url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url: `${base}/${TASK}/metadata`, headers, payload })).statusCode).toBe(404);
    for (const invalid of [{ ...payload, name: "" }, { ...payload, description: "a".repeat(4001) }, { ...payload, owner_id: OWNER }, { name: "No hash" }]) {
      expect((await app.inject({ method: "PATCH", url, headers, payload: invalid })).statusCode).toBe(400);
    }
    const saved = await app.inject({ method: "PATCH", url, headers, payload });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ name: "Renamed", manifest: { description: "Description" } });
    expect((await app.inject({ method: "PATCH", url, headers, payload })).statusCode).toBe(409);
  });
  it("reads and replaces source capabilities through authenticated owner-scoped endpoints", async () => {
    const { app } = await setup(); const base = "/api/v1/application-developments";
    const headers = { authorization: "Bearer owner" };
    const created = await app.inject({ method: "POST", url: base, headers, payload: { name: "Configure capabilities" } });
    const project = created.json().data;
    const url = `${base}/${project.id}/capabilities`;
    const get = await app.inject({ method: "GET", url, headers });
    expect(get.statusCode).toBe(200);
    expect(get.headers["cache-control"]).toBe("private, no-store");
    expect(get.json().data.dependencies.items).toEqual([]);
    for (const method of ["GET", "PATCH"] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      expect((await app.inject({ method, url: `${base}/${TASK}/capabilities`, headers, ...(method === "PATCH" ? { payload: { source_hash: project.source_hash, dependencies: {} } } : {}) })).statusCode).toBe(404);
    }
    for (const payload of [{ dependencies: {} }, { source_hash: project.source_hash, dependencies: {}, owner_id: OWNER }, { source_hash: project.source_hash, dependencies: { skills: [{ id: "invalid", name: "Skill" }] } }]) {
      expect((await app.inject({ method: "PATCH", url, headers, payload })).statusCode).toBe(400);
    }
    const saved = await app.inject({ method: "PATCH", url, headers, payload: { source_hash: project.source_hash, dependencies: { plugins: [{ id: "30000000-0000-4000-8000-000000000001", name: "Fake name" }] } } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.manifest.dependencies.plugins).toEqual([{ id: "30000000-0000-4000-8000-000000000001", name: "Plugin" }]);
    expect((await app.inject({ method: "PATCH", url, headers, payload: { source_hash: project.source_hash, dependencies: {} } })).statusCode).toBe(409);
    const unavailable = await app.inject({ method: "PATCH", url, headers, payload: { source_hash: saved.json().data.source_hash, dependencies: { plugins: [{ id: OWNER, name: "Unavailable" }] } } });
    expect(unavailable.statusCode).toBe(409);
    expect(unavailable.json().error_code).toBe("APPLICATION_DEPENDENCY_UNAVAILABLE");
  });
  it("reopens a detached app and allows explicit deletion from the application list", async () => {
    const { app, row } = await setup(); const base = "/api/v1/application-developments";
    const headers = { authorization: "Bearer owner" };
    const created = await app.inject({ method: "POST", url: base, headers, payload: { name: "Retained application" } });
    const id = created.json().data.id;
    row().conversationId = null;
    const reopened = await app.inject({ method: "POST", url: `${base}/${id}/resume`, headers });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().data.conversation_id).not.toBeNull();
    expect(reopened.json().data.conversation_id).not.toBe(TASK);
    for (const method of ["POST", "DELETE"] as const) {
      const suffix = method === "POST" ? "/resume" : "";
      expect((await app.inject({ method, url: `${base}/invalid${suffix}`, headers })).statusCode).toBe(400);
      expect((await app.inject({ method, url: `${base}/${OWNER}${suffix}`, headers })).statusCode).toBe(404);
    }
    const deleted = await app.inject({ method: "DELETE", url: `${base}/${id}`, headers });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ data: { success: true } });
    expect((await app.inject({ method: "POST", url: `${base}/${id}/resume`, headers })).statusCode).toBe(404);
  });
  it("authenticates every operation and validates paths, installation hashes and bounded diagnostics", async () => {
    const { app } = await setup(); const base = "/api/v1/application-developments";
    for (const [method, suffix] of [["POST", ""], ["GET", `/by-conversation/${TASK}`], ["POST", `/by-application/${TASK}`], ["GET", `/${TASK}`], ["POST", `/${TASK}/resume`], ["DELETE", `/${TASK}`], ["POST", `/${TASK}/sync`], ["POST", `/${TASK}/install`], ["PUT", `/${TASK}/diagnostics`], ["GET", `/${TASK}/test-sessions`], ["POST", `/${TASK}/test-sessions/restart`], ["DELETE", `/${TASK}/test-sessions/${OWNER}`]] as const) {
      expect((await app.inject({ method, url: `${base}${suffix}` })).statusCode).toBe(401);
    }
    const headers = { authorization: "Bearer owner" };
    for (const payload of [{ name: "" }, { name: "App", directory: "../../other" }, { name: "App", owner_id: TASK }]) {
      expect((await app.inject({ method: "POST", url: base, headers, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "POST", url: `${base}/${TASK}/install`, headers, payload: { source_hash: "bad" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: `${base}/${TASK}/diagnostics`, headers, payload: { revision: 1, diagnostics: Array(21).fill({ message: "error" }) } })).statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: base, headers, payload: { name: "My app" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ data: { name: "My app", preview_current: true } });
    const project = created.json().data;
    expect((await app.inject({ method: "GET", url: `${base}/${project.id}/test-sessions?limit=101`, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `${base}/${project.id}/test-sessions?owner_id=${OWNER}`, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `${base}/${project.id}/test-sessions`, headers })).json()).toMatchObject({ data: { items: [], next_cursor: null } });
    expect((await app.inject({ method: "POST", url: `${base}/${project.id}/test-sessions/restart`, headers, payload: {} })).statusCode).toBe(400);
    const restarted = await app.inject({ method: "POST", url: `${base}/${project.id}/test-sessions/restart`, headers, payload: { preview_conversation_id: project.preview_conversation_id, revision: project.revision } });
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json().data.preview_conversation_id).toBe(project.preview_conversation_id);
    expect((await app.inject({ method: "DELETE", url: `${base}/${project.id}/test-sessions/${restarted.json().data.preview_conversation_id}`, headers })).statusCode).toBe(409);

  });
  it("checks internal authentication and the owner-scoped current turn without accepting arbitrary identities", async () => {
    const { app, store } = await setup(); const url = "/internal/application-builder";
    const payload = { conversationId: TASK, turnId: OWNER, request: { operation: "inspect" } };
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(401);
    const headers = { authorization: "Bearer test-internal-shared-secret", "x-linksense-owner-id": OWNER };
    expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(200);
    expect(store.assertActiveTurn).toHaveBeenCalledWith(OWNER, TASK, OWNER);
    store.assertActiveTurn.mockRejectedValue(new AppError("FORBIDDEN"));
    expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, turnId: "native-turn-text" } })).statusCode).toBe(400);
  });
});
