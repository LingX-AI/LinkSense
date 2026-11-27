import Fastify from "fastify";
import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { registerResponseSecurityHeaders } from "../src/app.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { createApiCorsOptions } from "../src/lib/cors.js";
import { publicWebSiteRoutes, webSiteRoutes } from "../src/modules/web-sites/routes.js";
import type { SiteUnlockLimiter } from "../src/modules/web-sites/access.js";
import { WebSiteAnalytics } from "../src/modules/web-sites/analytics.js";
import { WebSiteService } from "../src/modules/web-sites/service.js";
import { ownerId, taskId, fileId, siteId, releaseId, siteFixture } from "./web-sites.fixture.js";
import { sha256 } from "../src/modules/web-sites/resources.js";
import { hashPassword } from "../src/lib/password.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function setup(publicBaseUrl = "https://linksense.example.test", analyticsBaseUrl?: string) {
  const fixture = siteFixture();
  const service = analyticsBaseUrl
    ? new WebSiteService(fixture.store, fixture.storage, undefined, new WebSiteAnalytics({ baseUrl: analyticsBaseUrl, apiKey: "test-key" }))
    : fixture.service;
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(cors, createApiCorsOptions("https://linksense.example.test"));
  registerResponseSecurityHeaders(app);
  app.decorate("authenticate", async (request) => {
    if (request.headers.authorization !== "Bearer test-owner") throw new AppError("AUTH_REQUIRED");
    Object.assign(request, { authUser: { id: ownerId } });
  });
  await app.register(webSiteRoutes, { prefix: "/api/v1/web-sites", service: fixture.service, publicBaseUrl });
  const takeUnlockAttempt = vi.fn<SiteUnlockLimiter>().mockResolvedValue(true);
  await app.register(publicWebSiteRoutes, { prefix: "/web", service, publicBaseUrl, accessSecret: "test-access-secret", takeUnlockAttempt, ...(analyticsBaseUrl ? { analyticsBaseUrl } : {}) });
  return { ...fixture, app, takeUnlockAttempt };
}
describe("website HTTP boundary", () => {
  it("returns a configured public slug link separately from the stable URL on list and rename", async () => {
    const fixture = await setup();
    const headers = { authorization: "Bearer test-owner" };
    const listed = await fixture.app.inject({ url: "/api/v1/web-sites", headers });
    expect(listed.json().data.items[0]).toMatchObject({
      slug: "sample", alias_url: "https://linksense.example.test/app/s/sample",
      url: `https://linksense.example.test/app/s/${siteId}`,
    });
    fixture.store.update.mockImplementation(async (_ownerId, _id, input) => {
      fixture.row.site.slug = input.slug ?? fixture.row.site.slug;
      return fixture.row;
    });
    const renamed = await fixture.app.inject({
      method: "PATCH", url: `/api/v1/web-sites/${siteId}`, headers, payload: { slug: "drink-water" },
    });
    expect(renamed.json().data).toMatchObject({
      slug: "drink-water", alias_url: "https://linksense.example.test/app/s/drink-water",
      url: `https://linksense.example.test/app/s/${siteId}`,
    });
  });

  it("returns only owner-scoped site delivery metadata with the site's current status", async () => {
    const fixture = await setup();
    const turnId = "60000000-0000-4000-8000-000000000001";
    fixture.store.conversationDeliveries.mockResolvedValue([{ id: siteId, turn_id: turnId, source_file_id: fileId, name: "Sample", slug: "sample", status: "disabled", internal: "private" }]);
    const url = `/api/v1/web-sites/by-conversation/${taskId}`;
    expect((await fixture.app.inject(url)).statusCode).toBe(401);
    const response = await fixture.app.inject({ url, headers: { authorization: "Bearer test-owner" } });
    expect(response.statusCode).toBe(200);
    expect(fixture.store.conversationDeliveries).toHaveBeenCalledExactlyOnceWith(ownerId, taskId);
    expect(response.json().data).toEqual([{ id: siteId, turn_id: turnId, source_file_id: fileId, name: "Sample", slug: "sample", status: "disabled", url: `https://linksense.example.test/app/s/${siteId}` }]);
  });
  it("serves an anonymous sandboxed shell and directly sandboxed assets with anonymous CORS", async () => {
    const fixture = await setup();
    fixture.row.site.name = '<img src=x onerror="alert(1)">';
    for (const url of ["/web/sample", "/web/sample/"]) {
      const shell = await fixture.app.inject(url);
      expect(shell.statusCode).toBe(200);
      expect(shell.body).toContain('sandbox="allow-scripts allow-modals allow-downloads allow-forms"');
      expect(shell.body).not.toContain("allow-same-origin");
      expect(shell.body).not.toContain("<img");
      expect(shell.body).toContain(`src="/web/sample/_releases/${releaseId}/index.html"`);
      expect(shell.headers["x-frame-options"]).toBeUndefined();
      expect(shell.headers["content-security-policy"]).not.toContain("frame-ancestors");
    }
    for (const origin of ["null", "https://linksense.example.test", "https://host.example.test"]) {
      const file = await fixture.app.inject({ url: `/web/sample/_releases/${releaseId}/index.html`, headers: { origin } });
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(file.headers["access-control-allow-origin"]).toBe("*");
      expect(file.headers["access-control-allow-credentials"]).toBeUndefined();
      expect(file.headers["content-security-policy"]).toContain("sandbox allow-scripts");
      expect(file.headers["content-security-policy"]).not.toContain("allow-same-origin");
      expect(file.headers["content-security-policy"]).toContain("worker-src 'none'");
      expect(file.headers["x-frame-options"]).toBeUndefined();
      expect(file.headers["content-security-policy"]).not.toContain("frame-ancestors");
      expect(file.body).toContain('onclick="this.textContent=42"');
      expect(file.headers["cache-control"]).toBe("no-store");
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
    }
    expect(fixture.store.create).not.toHaveBeenCalled();
    expect(fixture.store.publish).not.toHaveBeenCalled();
  });
  it("allows release assets from the request origin as well as the configured public origin", async () => {
    const fixture = await setup();
    const response = await fixture.app.inject({
      url: `/web/sample/_releases/${releaseId}/index.html`,
      headers: { host: "127.0.0.1:5273" },
    });
    const policy = response.headers["content-security-policy"];
    expect(response.statusCode).toBe(200);
    expect(policy).toContain("http://127.0.0.1:5273/web/");
    expect(policy).toContain("https://linksense.example.test/web/");
  });
  it("serves current and retired UUID slugs without treating them as site IDs", async () => {
    const fixture = await setup();
    const defaultSlug = "40000000-0000-4000-8000-000000000002";
    fixture.row.site.slug = defaultSlug;
    fixture.store.publicSiteById.mockImplementation(async id => {
      if (id !== siteId) throw new AppError("WEB_SITE_NOT_FOUND");
      return fixture.row;
    });
    const release = `/web/${defaultSlug}/_releases/${releaseId}/index.html`;
    const shell = await fixture.app.inject(`/web/${defaultSlug}`);
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain(`src="${release}"`);
    expect((await fixture.app.inject(release)).statusCode).toBe(200);

    fixture.row.site.slug = "renamed-site";
    const retired = await fixture.app.inject(`/web/${defaultSlug}`);
    expect(retired.statusCode).toBe(200);
    expect(retired.body).toContain(`src="/web/renamed-site/_releases/${releaseId}/index.html"`);
    expect((await fixture.app.inject(release)).statusCode).toBe(200);
  });
  it.each(["/web/sample", "/web/sample/", `/web/sample/_releases/${releaseId}/index.html`])("keeps existing site HEAD responses embeddable at %s", async (url) => {
    const fixture = await setup();
    const response = await fixture.app.inject({ method: "HEAD", url });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-frame-options"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).not.toContain("frame-ancestors");
    expect(response.body).toBe("");
    expect(fixture.store.publish).not.toHaveBeenCalled();
  });
  it("returns localized errors for retired sites and never reads their assets", async () => {
    const fixture = await setup();
    fixture.store.publicSite.mockRejectedValue(new AppError("WEB_SITE_NOT_FOUND"));
    const zh = await fixture.app.inject(`/web/sample/_releases/${releaseId}/index.html`);
    const en = await fixture.app.inject({ url: "/web/sample", headers: { "accept-language": "en-US" } });
    expect(zh.statusCode).toBe(404);
    expect(en.statusCode).toBe(404);
    for (const response of [zh, en]) {
      expect(response.headers["x-frame-options"]).toBeUndefined();
      expect(response.headers["content-security-policy"]).not.toContain("frame-ancestors");
    }
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
    expect(response.headers["x-frame-options"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).not.toContain("frame-ancestors");
    expect(response.body).not.toContain("private database connection");
    expect(response.body).not.toContain('aria-hidden="true">404</p>');
  });
  it("gates a passcode-protected site behind an unlock cookie for pages and release assets", async () => {
    const fixture = await setup();
    fixture.row.site.passcodeHash = await hashPassword("sunrise");
    const locked = await fixture.app.inject({ url: "/web/sample", headers: { "accept-language": "en-US", accept: "text/html" } });
    expect(locked.statusCode).toBe(401);
    expect(locked.headers["content-security-policy"]).toContain("form-action 'self'");
    expect(locked.body).toContain("This site is protected");
    expect(locked.body).toContain('action="/web/sample/unlock"');
    const asset = await fixture.app.inject({ url: `/web/sample/_releases/${releaseId}/index.html`, headers: { "accept-language": "en-US" } });
    expect(asset.statusCode).toBe(401);
    expect(asset.body).toContain("This site is protected");

    const form = { "content-type": "application/x-www-form-urlencoded", "accept-language": "en-US" };
    const wrong = await fixture.app.inject({ method: "POST", url: "/web/sample/unlock", payload: "passcode=wrong", headers: form });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toContain("That passcode is not correct");
    const unlock = await fixture.app.inject({ method: "POST", url: "/web/sample/unlock", payload: "passcode=sunrise&next=%2Fweb%2Fsample", headers: form });
    expect(unlock.statusCode).toBe(303);
    expect(unlock.headers.location).toBe("/web/sample");
    const cookie = String(unlock.headers["set-cookie"]).split(";")[0]!;
    expect(cookie).toMatch(/^linksense_site_access_[a-f0-9]{32}=/u);
    expect(String(unlock.headers["set-cookie"])).toContain("SameSite=None; Secure");
    const open = await fixture.app.inject({ url: "/web/sample", headers: { cookie } });
    expect(open.statusCode).toBe(200);
    expect(open.body).toContain("iframe");
    const gatedAsset = await fixture.app.inject({ url: `/web/sample/_releases/${releaseId}/index.html`, headers: { "accept-language": "en-US" } });
    expect(gatedAsset.statusCode).toBe(401);
    const openAsset = await fixture.app.inject({ url: `/web/sample/_releases/${releaseId}/index.html`, headers: { cookie } });
    expect(openAsset.statusCode).toBe(200);

    // Changing the passcode revokes the existing unlock.
    fixture.row.site.passcodeHash = await hashPassword("sunset");
    expect((await fixture.app.inject({ url: "/web/sample", headers: { cookie } })).statusCode).toBe(401);
    // Removing it makes the site public again.
    fixture.row.site.passcodeHash = null;
    expect((await fixture.app.inject("/web/sample")).statusCode).toBe(200);
  });
  it("keeps the unlock cookie on plain-HTTP deployments, where browsers reject SameSite=None; Secure", async () => {
    const fixture = await setup("http://192.168.2.210:19090");
    fixture.row.site.passcodeHash = await hashPassword("sunrise");
    const unlock = await fixture.app.inject({
      method: "POST", url: "/web/sample/unlock", payload: "passcode=sunrise",
      headers: { "content-type": "application/x-www-form-urlencoded", "accept-language": "en-US" },
    });
    expect(unlock.statusCode).toBe(303);
    const setCookie = String(unlock.headers["set-cookie"]);
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");
    const cookie = setCookie.split(";")[0]!;
    expect((await fixture.app.inject({ url: "/web/sample", headers: { cookie } })).statusCode).toBe(200);
  });

  it("returns to the original address and query after retrying the passcode form", async () => {
    const fixture = await setup();
    fixture.row.site.passcodeHash = await hashPassword("sunrise");
    const destination = "/web/sample?from=share&view=full";
    const nextField = (html: string): string => {
      const pending: DefaultTreeAdapterMap["node"][] = [parse(html)];
      while (pending.length) {
        const node = pending.pop();
        if (node && "attrs" in node && node.tagName === "input" &&
            node.attrs.some(attr => attr.name === "name" && attr.value === "next")) {
          return node.attrs.find(attr => attr.name === "value")?.value ?? "";
        }
        if (node && "childNodes" in node) pending.push(...node.childNodes);
      }
      return "";
    };
    const submit = (passcode: string, next: string) => fixture.app.inject({
      method: "POST", url: "/web/sample/unlock",
      payload: new URLSearchParams({ passcode, next }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", "accept-language": "en-US" },
    });
    const gate = await fixture.app.inject(destination);
    expect(gate.statusCode).toBe(401);
    const wrong = await submit("wrong", nextField(gate.body));
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toContain("That passcode is not correct");
    const retry = await submit("sunrise", nextField(wrong.body));
    expect(retry.statusCode).toBe(303);
    expect(retry.headers.location).toBe(destination);
  });

  it("rejects unlocks before password verification when admission fails", async () => {
    const fixture = await setup();
    fixture.row.site.passcodeHash = "not-a-verifiable-hash";
    const request = {
      method: "POST", url: "/web/sample/unlock", payload: "passcode=sunrise",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    } as const;
    fixture.takeUnlockAttempt.mockResolvedValueOnce(false);
    expect((await fixture.app.inject(request)).statusCode).toBe(429);
    expect(fixture.takeUnlockAttempt).toHaveBeenCalledWith(siteId, "127.0.0.1");
    fixture.takeUnlockAttempt.mockRejectedValueOnce(new Error("redis unavailable"));
    const unavailable = await fixture.app.inject(request);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.headers["set-cookie"]).toBeUndefined();
  });

  it.each(["http", "https"])("loads protected release assets without iframe cookies on %s", async protocol => {
    const fixture = await setup(`${protocol}://linksense.example.test`);
    fixture.row.site.passcodeHash = await hashPassword("sunrise");
    const document = Buffer.from('<!doctype html><script type="module" src="./assets/main.js"></script>');
    const module = Buffer.from('export const ready = true;');
    fixture.objects.set("original/index.html", document);
    fixture.objects.set("original/assets/main.js", module);
    fixture.manifest.files = [
      { path: "index.html", object_key: "original/index.html", mime_type: "text/html", size_bytes: document.length, checksum_sha256: sha256(document) },
      { path: "assets/main.js", object_key: "original/assets/main.js", mime_type: "application/javascript", size_bytes: module.length, checksum_sha256: sha256(module) },
    ];
    const unlocked = await fixture.app.inject({
      method: "POST", url: "/web/sample/unlock", payload: "passcode=sunrise",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const cookie = String(unlocked.headers["set-cookie"]).split(";")[0]!;
    const shell = await fixture.app.inject({ url: "/web/sample", headers: { cookie } });
    const entry = /<iframe[^>]+src="([^"]+)"/u.exec(shell.body)?.[1];
    expect(entry).toBeDefined();
    if (!entry) throw new Error("Missing release iframe");
    const moduleUrl = new URL("./assets/main.js", new URL(entry, `${protocol}://linksense.example.test`)).pathname;
    const documentResponse = await fixture.app.inject(entry);
    const moduleResponse = await fixture.app.inject({ url: moduleUrl, headers: { origin: "null" } });
    expect(documentResponse.statusCode).toBe(200);
    expect(documentResponse.headers["content-security-policy"]).not.toContain("allow-same-origin");
    expect(moduleResponse.statusCode).toBe(200);
    expect(moduleResponse.body).toBe(module.toString());
    expect(moduleResponse.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(moduleResponse.headers["cache-control"]).toBe("no-store");
    expect((await fixture.app.inject(`/web/sample/_releases/${releaseId}/assets/main.js`)).statusCode).toBe(401);
    fixture.store.publicSiteById.mockImplementation(async (id, publishedRelease) => ({
      site: { ...fixture.row.site, id },
      release: { ...fixture.row.release, id: publishedRelease ?? releaseId, siteId: id },
    }));
    const differentSite = moduleUrl.replace(siteId, "40000000-0000-4000-8000-000000000002");
    const differentRelease = moduleUrl.replace(releaseId, "50000000-0000-4000-8000-000000000002");
    expect((await fixture.app.inject(differentSite)).statusCode).toBe(404);
    expect((await fixture.app.inject(differentRelease)).statusCode).toBe(404);

    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(Date.now() + 15 * 60_000);
      expect((await fixture.app.inject(moduleUrl)).statusCode).toBe(404);
    } finally {
      clock.mockRestore();
    }

    // Even a valid release credential must stop working when access changes.
    fixture.row.site.passcodeHash = await hashPassword("sunset");
    expect((await fixture.app.inject(moduleUrl)).statusCode).not.toBe(200);
    fixture.row.site.passcodeHash = null;
    expect((await fixture.app.inject(moduleUrl)).statusCode).not.toBe(200);
  });

  it("reports a protected pageview without its release credential or query string", async () => {
    const origin = "https://linksense.example.test";
    const stats = "https://stats.example.test";
    const fixture = await setup(origin, stats);
    fixture.row.site.passcodeHash = await hashPassword("sunrise");
    fixture.row.site.analyticsEnabled = true;
    fixture.row.site.analyticsDomain = `${siteId}.linksense.invalid`;
    const unlock = await fixture.app.inject({
      method: "POST", url: "/web/sample/unlock", payload: "passcode=sunrise",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const cookie = String(unlock.headers["set-cookie"]).split(";")[0]!;
    const shell = await fixture.app.inject({ url: "/web/sample", headers: { cookie } });
    const source = /<iframe[^>]+src="([^"]+)"/u.exec(shell.body)?.[1];
    if (!source) throw new Error("Missing release iframe");
    const page = await fixture.app.inject(`${source}?private=fixture`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(JSON.stringify({
      endpoint: `${stats}/api/event`,
      body: { name: "pageview", url: `${origin}/web/sample/_releases/${releaseId}/index.html`, domain: `${siteId}.linksense.invalid` },
    }));
    expect(page.body).not.toContain("/web/_protected/");
    expect(page.body).not.toContain("private=fixture");
    expect(page.body).toContain('credentials: "omit"');
    expect(page.body).toContain('referrerPolicy: "no-referrer"');
  });

  it("requires authentication for all management operations and checks resource ownership", async () => {
    const fixture = await setup();
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const result = await fixture.app.inject({ method, url: method === "GET" ? "/api/v1/web-sites" : `/api/v1/web-sites/${siteId}` });
      expect(result.statusCode).toBe(401);
      expect(result.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(result.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
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
    expect(fixture.store.create).toHaveBeenCalledWith(ownerId, expect.objectContaining({ slug: "my-page" }), expect.any(Object), "Source", expect.any(Object), undefined, undefined);
    expect((await fixture.app.inject({ method: "PATCH", url: `/api/v1/web-sites/${siteId}`, headers, payload: { owner_id: taskId } })).statusCode).toBe(400);
    expect((await fixture.app.inject({ url: "/api/v1/web-sites?cursor=garbage", headers })).statusCode).toBe(400);
    expect(fixture.store.update).not.toHaveBeenCalled();
    expect((await fixture.app.inject({ method: "DELETE", url: `/api/v1/web-sites/${siteId}`, headers })).statusCode).toBe(204);
    expect(fixture.store.delete).toHaveBeenCalledWith(ownerId, siteId);
  });
  it("finds the owner's site for an original HTML file and rejects an invalid file ID", async () => {
    const fixture = await setup();
    const headers = { authorization: "Bearer test-owner" };
    const response = await fixture.app.inject({ url: `/api/v1/web-sites?origin_file_id=${fileId}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual([expect.objectContaining({ id: siteId, url_path: `/app/s/${siteId}` })]);
    expect(fixture.store.list).toHaveBeenCalledWith(ownerId, { originFileId: fileId, limit: 30 });
    expect((await fixture.app.inject({ url: "/api/v1/web-sites?origin_file_id=invalid", headers })).statusCode).toBe(400);
  });
});
