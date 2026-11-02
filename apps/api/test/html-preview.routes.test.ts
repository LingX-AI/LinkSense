import Fastify from "fastify";
import cors from "@fastify/cors";
import { afterEach, describe, expect, it } from "vitest";
import { registerResponseSecurityHeaders } from "../src/app.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { createApiCorsOptions } from "../src/lib/cors.js";
import { htmlPreviewRoutes, htmlPreviewResourceRoutes } from "../src/modules/html-preview/routes.js";
import { HtmlPreviewService, type HtmlPreviewSessionStore } from "../src/modules/html-preview/service.js";
import { WebArtifactResources } from "../src/modules/web-sites/artifact-resources.js";
import { sha256 } from "../src/modules/web-sites/resources.js";
import { ownerId, taskId, fileId, siteFixture } from "./web-sites.fixture.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function setup() {
  const f = siteFixture();
  const sessions = new Map<string, Parameters<HtmlPreviewSessionStore["save"]>[1]>();
  const service = new HtmlPreviewService(new WebArtifactResources(f.store, f.storage), { get: async id => sessions.get(id) ?? null, save: async (id, value) => { sessions.set(id, value); } }, async () => true);
  const app = Fastify(); apps.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(cors, createApiCorsOptions("https://linksense.example.test"));
  registerResponseSecurityHeaders(app);
  app.decorate("authenticate", async request => {
    if (request.headers.authorization !== "Bearer test-owner") throw new AppError("AUTH_REQUIRED");
    Object.assign(request, { authUser: { id: ownerId } });
  });
  await app.register(htmlPreviewRoutes, { prefix: "/api/v1/conversations", service });
  await app.register(htmlPreviewResourceRoutes, { prefix: "/html-preview", service });
  return { ...f, app, sessions };
}

describe("private HTML preview HTTP boundary", () => {
  it("requires authentication to issue sessions and exposes neither storage keys nor account tokens", async () => {
    const f = await setup();
    const url = `/api/v1/conversations/${taskId}/files/${fileId}/html-preview`;
    expect((await f.app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(401);
    const response = await f.app.inject({ method: "POST", url, payload: {}, headers: { authorization: "Bearer test-owner" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(response.body).not.toMatch(/object_key|original\/index|test-owner/u);
    const preview = response.json().data;
    for (const origin of ["null", "https://linksense.example.test", "https://host.example.test"]) {
      const page = await f.app.inject({ url: preview.entry_url, headers: { origin } });
      expect(page.statusCode).toBe(200);
      expect(page.headers["access-control-allow-origin"]).toBe("*");
      expect(page.headers["access-control-allow-credentials"]).toBeUndefined();
      expect(page.headers["content-security-policy"]).toMatch(/sandbox [^;]*allow-scripts/u);
      expect(page.headers["content-security-policy"]).not.toContain("allow-same-origin");
      expect(page.headers["x-frame-options"]).toBeUndefined();
      expect(page.headers["content-security-policy"]).not.toContain("frame-ancestors");
      expect(page.headers["referrer-policy"]).toBe("no-referrer");
      expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    }
    const shell = await f.app.inject(`${preview.entry_url}?previewId=test`);
    expect(shell.headers["x-frame-options"]).toBeUndefined();
    expect(shell.headers["content-security-policy"]).not.toContain("frame-ancestors");
    expect(shell.body).toContain("linksense:assistant-html-preview:shell-ready");
    expect(shell.body).toContain("event.origin !== window.location.origin");
    f.sessions.clear();
    const expired = await f.app.inject(preview.entry_url);
    expect(expired.statusCode).toBe(404);
    expect(expired.headers["x-frame-options"]).toBeUndefined();
    expect(expired.headers["content-security-policy"]).not.toContain("frame-ancestors");
  });
  it("keeps existing sessions and legacy standalone HTML embeddable for GET and HEAD requests", async () => {
    const f = await setup();
    const session = "a".repeat(64);
    f.sessions.set(session, {
      ownerId, conversationId: taskId, fileId,
      manifestDigest: sha256(Buffer.from(JSON.stringify(f.manifest))),
      expiresAt: Date.now() + 60_000,
    });
    for (const method of ["GET", "HEAD"] as const) {
      for (const query of ["", "?previewId=existing"]) {
        const response = await f.app.inject({ method, url: `/html-preview/${session}/index.html${query}` });
        expect(response.statusCode).toBe(200);
        expect(response.headers["x-frame-options"]).toBeUndefined();
        expect(response.headers["content-security-policy"]).not.toContain("frame-ancestors");
        expect(response.headers["content-security-policy"]).toContain("sandbox");
        if (method === "GET" && !query) expect(response.body).toContain('onclick="this.textContent=42"');
      }
    }
    expect(f.source.bundle).toBeNull();
    expect(f.store.create).not.toHaveBeenCalled();
  });
  it("rejects malformed sessions and unauthorized files before reading storage", async () => {
    const f = await setup();
    expect((await f.app.inject("/html-preview/invalid/index.html")).statusCode).toBe(404);
    f.store.source.mockRejectedValue(new AppError("WEB_SITE_SOURCE_UNAVAILABLE"));
    const response = await f.app.inject({ method: "POST", url: `/api/v1/conversations/${taskId}/files/${fileId}/html-preview`, payload: {}, headers: { authorization: "Bearer test-owner" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error_code).toBe("WEB_SITE_SOURCE_UNAVAILABLE");
    expect(f.storage.getObjectStream).not.toHaveBeenCalled();
  });
});
