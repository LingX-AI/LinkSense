import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerClientBuildGuard } from "../src/plugins/client-build.js";
import { readRuntimeBuildId } from "../src/lib/build-info.js";
import { sendAppError } from "../src/lib/http.js";
import { AppError } from "../src/lib/errors.js";
import { verifyWebBuild } from "../src/commands/verify-web-build.js";

const current = "b".repeat(64);
const old = "a".repeat(64);
const applications: ReturnType<typeof Fastify>[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function createApp(buildId: string | null = current) {
  const app = Fastify();
  applications.push(app);
  registerClientBuildGuard(app, buildId);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  return app;
}

describe("first-party page build handshake", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)("rejects outdated %s before validation or business effects", async (method) => {
    const app = createApp();
    const handler = vi.fn(async () => ({ success: true }));
    app.route({ method, url: "/api/v1/applications", handler });
    const response = await app.inject({ method, url: "/api/v1/applications", headers: { "x-linksense-client-build": old } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error_code).toBe("CLIENT_UPDATE_REQUIRED");
    expect(response.headers["x-linksense-build"]).toBe(current);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "en-US", "fr-FR"])("localizes outdated-page errors for %s", async (locale) => {
    const app = createApp();
    app.get("/api/v1/applications", async () => ({}));
    const response = await app.inject({ url: "/api/v1/applications", headers: { "x-linksense-client-build": old, "accept-language": locale } });
    expect(response.json().message).toBe(locale === "en-US" ? "The system has been updated. Update this page to continue." : "系统已更新，请更新页面后继续。");
  });

  it("admits matching pages and unversioned external clients without bypassing authentication", async () => {
    const app = createApp();
    app.get("/api/v1/public", async () => ({ success: true }));
    app.get("/api/v1/private", { preHandler: async () => { throw new AppError("AUTH_REQUIRED"); } }, async () => ({}));
    for (const headers of [{}, { "x-linksense-client-build": current }]) {
      expect((await app.inject({ url: "/api/v1/public", headers })).statusCode).toBe(200);
      expect((await app.inject({ url: "/api/v1/private", headers })).statusCode).toBe(401);
    }
  });

  it("rejects malformed build headers without leaking their contents", async () => {
    const app = createApp();
    app.get("/api/v1/public", async () => ({}));
    const response = await app.inject({ url: "/api/v1/public", headers: { "x-linksense-client-build": "malformed-private-input" } });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("malformed-private-input");
  });

  it("leaves explicit resource caching and development requests intact", async () => {
    const app = createApp(null);
    app.get("/api/v1/logo", async (_request, reply) => reply.header("cache-control", "public, max-age=31536000, immutable").send("image"));
    const response = await app.inject({ url: "/api/v1/logo", headers: { "x-linksense-client-build": old } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("immutable");
    expect(response.headers["x-linksense-build"]).toBeUndefined();
  });

  it("includes the build identity on hijacked event streams", async () => {
    const app = createApp();
    app.get("/api/v1/events", async (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      reply.raw.end("data: test\n\n");
    });
    expect((await app.inject("/api/v1/events")).headers["x-linksense-build"]).toBe(current);
  });
});

describe("immutable application build metadata", () => {
  it("requires valid baked metadata in production and no metadata for hot reload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linksense-build-test-"));
    directories.push(directory);
    const url = pathToFileURL(join(directory, "build-info.json"));
    expect(readRuntimeBuildId("development", url)).toBeNull();
    expect(() => readRuntimeBuildId("production", url)).toThrow();
    await writeFile(url, JSON.stringify({ build_id: current }));
    expect(readRuntimeBuildId("production", url)).toBe(current);
    await writeFile(url, JSON.stringify({ build_id: "latest" }));
    expect(() => readRuntimeBuildId("production", url)).toThrow();
  });

  it("verifies the served web build and rejects incomplete or mixed deployments", async () => {
    const fetchManifest = vi.fn<typeof fetch>();
    fetchManifest.mockResolvedValueOnce(Response.json({ build_id: current }));
    await expect(verifyWebBuild(current, "https://web.example.test/build-info.json", fetchManifest)).resolves.toBeUndefined();
    expect(fetchManifest).toHaveBeenCalledWith(expect.any(String), { cache: "no-store", signal: expect.any(AbortSignal) });
    for (const response of [Response.json({ build_id: old }), Response.json({}), new Response("maintenance", { status: 503 })]) {
      fetchManifest.mockResolvedValueOnce(response);
      await expect(verifyWebBuild(current, "https://web.example.test/build-info.json", fetchManifest)).rejects.toThrow();
    }
  });
});
