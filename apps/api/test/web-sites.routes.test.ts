import Fastify from "fastify";
import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { createApiCorsOptions } from "../src/lib/cors.js";
import { publicWebSiteRoutes, webSiteRoutes } from "../src/modules/web-sites/routes.js";
import { ownerId, taskId, fileId, siteId, releaseId, siteFixture } from "./web-sites.fixture.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function setup() {
  const fixture = siteFixture();
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(cors, createApiCorsOptions("https://linksense.example.test"));
  app.decorate("authenticate", async (request) => {
    if (request.headers.authorization !== "Bearer test-owner") throw new AppError("AUTH_REQUIRED");
    Object.assign(request, { authUser: { id: ownerId } });
  });
  await app.register(webSiteRoutes, { prefix: "/api/v1/web-sites", service: fixture.service });
  await app.register(publicWebSiteRoutes, { prefix: "/web", service: fixture.service, publicBaseUrl: "https://linksense.example.test" });
  return { ...fixture, app };
}
describe("website HTTP boundary", () => {
  it("serves an anonymous sandboxed shell and directly sandboxed assets with anonymous CORS", async () => {
    const fixture = await setup();
    fixture.row.site.name = '<img src=x onerror="alert(1)">';
    const shell = await fixture.app.inject("/web/sample");
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain('sandbox="allow-scripts allow-modals allow-downloads allow-forms"');
    expect(shell.body).not.toContain("allow-same-origin");
    expect(shell.body).not.toContain("<img");
    expect(shell.body).toContain(`src="/web/sample/_releases/${releaseId}/index.html"`);
    for (const origin of ["null", "https://linksense.example.test"]) {
      const file = await fixture.app.inject({ url: `/web/sample/_releases/${releaseId}/index.html`, headers: { origin } });
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(file.headers["access-control-allow-origin"]).toBe("*");
      expect(file.headers["access-control-allow-credentials"]).toBeUndefined();
      expect(file.headers["content-security-policy"]).toContain("sandbox allow-scripts");
      expect(file.headers["content-security-policy"]).not.toContain("allow-same-origin");
      expect(file.headers["content-security-policy"]).toContain("worker-src 'none'");
      expect(file.headers["cache-control"]).toBe("no-store");
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
    }
  });
  it("returns localized errors for retired sites and never reads their assets", async () => {
    const fixture = await setup();
    fixture.store.publicSite.mockRejectedValue(new AppError("WEB_SITE_NOT_FOUND"));
    const zh = await fixture.app.inject(`/web/sample/_releases/${releaseId}/index.html`);
    const en = await fixture.app.inject({ url: "/web/sample", headers: { "accept-language": "en-US" } });
    expect(zh.statusCode).toBe(404);
    expect(en.statusCode).toBe(404);
    expect(zh.body).toContain('lang="zh-CN"');
    expect(en.body).toContain('lang="en-US"');
    expect(zh.body).not.toContain("object_key");
    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
  });
  it.each([
    ["zh-CN", "zh-CN", "站点未找到"],
    ["en-US", "en-US", "Site not found"],
    ["es-ES", "es-ES", "Sitio no encontrado"],
    ["pt-BR", "pt-BR", "Site não encontrado"],
    ["fr-FR", "fr-FR", "Site introuvable"],
    ["ja-JP", "ja-JP", "サイトが見つかりません"],
    ["de-DE, pt-PT;q=0.8, en;q=0.5", "pt-BR", "Site não encontrado"],
    ["de-DE", "zh-CN", "站点未找到"],
  ])("renders a standalone accessible 404 page without navigation controls for %s", async (language, locale, title) => {
    const fixture = await setup();
    fixture.store.publicSite.mockRejectedValue(new AppError("WEB_SITE_NOT_FOUND"));
    const response = await fixture.app.inject({ url: "/web/missing", headers: { "accept-language": language } });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain(`lang="${locale}"`);
    expect(response.body).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(response.body).toContain('<main aria-labelledby="page-title">');
    expect(response.body).toContain('aria-hidden="true">404</p>');
    expect(response.body).toContain(`<h1 id="page-title">${title}</h1>`);
    expect(response.body).not.toMatch(/<a\b|<button\b/iu);
    expect(response.headers["content-security-policy"]).not.toContain("allow-top-navigation");
    expect(response.body).not.toMatch(/<script|<iframe|<link/iu);
    expect(response.body).not.toContain("missing");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["content-security-policy"]).toContain("style-src 'sha256-");
    const stylesheet = response.body.match(/<style>([\s\S]*?)<\/style>/u)?.[1];
    expect(stylesheet).toBeDefined();
    expect(response.headers["content-security-policy"]).toContain(`'sha256-${createHash("sha256").update(stylesheet!).digest("base64")}'`);
    expect(response.headers["content-security-policy"]).not.toMatch(/allow-scripts|allow-same-origin/u);
  });
  it("preserves non-404 error status without exposing internal details", async () => {
    const fixture = await setup();
    fixture.store.publicSite.mockRejectedValue(new Error("private database connection"));
    const response = await fixture.app.inject("/web/sample");
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("private database connection");
    expect(response.body).not.toContain('aria-hidden="true">404</p>');
  });
  it("requires authentication for all management operations and checks resource ownership", async () => {
    const fixture = await setup();
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const result = await fixture.app.inject({ method, url: method === "GET" ? "/api/v1/web-sites" : `/api/v1/web-sites/${siteId}` });
      expect(result.statusCode).toBe(401);
    }
    fixture.store.owned.mockRejectedValue(new AppError("WEB_SITE_NOT_FOUND"));
    const response = await fixture.app.inject({ url: `/api/v1/web-sites/${siteId}/download`, headers: { authorization: "Bearer test-owner" } });
    expect(response.statusCode).toBe(404);
    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
  });
  it("validates creation, update and cursor inputs and forwards the authenticated owner", async () => {
    const fixture = await setup();
    const headers = { authorization: "Bearer test-owner" };
    expect((await fixture.app.inject({ method: "POST", url: "/api/v1/web-sites", headers, payload: { conversation_id: taskId, file_id: fileId, name: "Page", slug: "My-Page" } })).statusCode).toBe(201);
    expect(fixture.store.create).toHaveBeenCalledWith(ownerId, expect.objectContaining({ slug: "my-page" }), expect.any(Object), "Source", expect.any(Object));
    expect((await fixture.app.inject({ method: "PATCH", url: `/api/v1/web-sites/${siteId}`, headers, payload: { owner_id: taskId } })).statusCode).toBe(400);
    expect((await fixture.app.inject({ url: "/api/v1/web-sites?cursor=garbage", headers })).statusCode).toBe(400);
    expect(fixture.store.update).not.toHaveBeenCalled();
    expect((await fixture.app.inject({ method: "DELETE", url: `/api/v1/web-sites/${siteId}`, headers })).statusCode).toBe(204);
    expect(fixture.store.delete).toHaveBeenCalledWith(ownerId, siteId);
  });
});
