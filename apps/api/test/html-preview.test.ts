import { describe, expect, it, vi } from "vitest";
import { HtmlPreviewService, type HtmlPreviewSessionStore } from "../src/modules/html-preview/service.js";
import { WebArtifactResources } from "../src/modules/web-sites/artifact-resources.js";
import { WebSiteService } from "../src/modules/web-sites/service.js";
import { sha256 } from "../src/modules/web-sites/resources.js";
import { AppError } from "../src/lib/errors.js";
import { ownerId, taskId, fileId, releaseId, siteFixture } from "./web-sites.fixture.js";

function fixture() {
  const site = siteFixture();
  const sessions = new Map<string, Parameters<HtmlPreviewSessionStore["save"]>[1]>();
  const store = { save: vi.fn<HtmlPreviewSessionStore["save"]>(async (id, value) => { sessions.set(id, value); }), get: vi.fn<HtmlPreviewSessionStore["get"]>(async id => sessions.get(id) ?? null) };
  const active = vi.fn(async () => true);
  const resources = new WebArtifactResources(site.store, site.storage);
  const service = new HtmlPreviewService(resources, store, active);
  function bundle(files: Record<string, string>) {
    site.manifest.files = Object.entries(files).map(([path, text]) => {
      const data = Buffer.from(text); site.objects.set(path, data);
      return { path, object_key: path, mime_type: path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : "application/javascript", size_bytes: data.length, checksum_sha256: sha256(data) };
    });
    site.source.bundle = { fileId, ownerId, conversationId: taskId, createdAt: site.row.site.createdAt, manifestJson: site.manifest };
  }
  return { ...site, service, sessionStore: store, sessions, active, bundle };
}

describe("private HTML resource sessions", () => {
  it("opens an existing directory snapshot without publishing and serves its CSS and scripts", async () => {
    const f = fixture();
    f.bundle({ "index.html": '<link rel="stylesheet" href="./assets/style.css"><script src="./assets/main.js"></script>', "assets/style.css": "body{color:red}", "assets/main.js": "window.loaded=true" });
    const preview = await f.service.open(ownerId, taskId, fileId);
    expect(preview.entry_url).toBe(`/html-preview/${preview.session_id}/index.html`);
    expect(preview.html).toContain('./assets/style.css');
    expect(preview.missing_resources).toEqual([]);
    expect((await f.service.resource(preview.session_id, "assets/style.css")).data.toString()).toBe("body{color:red}");
    expect((await f.service.resource(preview.session_id, "assets/main.js")).data.toString()).toBe("window.loaded=true");
    expect(f.sessionStore.save).toHaveBeenCalledWith(preview.session_id, expect.objectContaining({ ownerId, conversationId: taskId, fileId }), 900);
    expect(f.store.create).not.toHaveBeenCalled();
    expect(f.row.site.currentReleaseId).toBe(releaseId);
  });
  it("renews the same scoped session without changing the document URL or accepting another owner's session", async () => {
    const f = fixture();
    const preview = await f.service.open(ownerId, taskId, fileId);
    expect((await f.service.open(ownerId, taskId, fileId, preview.session_id)).entry_url).toBe(preview.entry_url);
    await expect(f.service.open("10000000-0000-4000-8000-000000000002", taskId, fileId, preview.session_id)).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
  });
  it("denies expired sessions, unlisted paths, revoked ownership, and disabled accounts", async () => {
    const f = fixture();
    const preview = await f.service.open(ownerId, taskId, fileId);
    await expect(f.service.resource(preview.session_id, "../private.txt")).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    f.active.mockResolvedValue(false);
    await expect(f.service.resource(preview.session_id, "index.html")).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    f.active.mockResolvedValue(true);
    f.store.source.mockRejectedValueOnce(new AppError("WEB_SITE_SOURCE_UNAVAILABLE"));
    await expect(f.service.resource(preview.session_id, "index.html")).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    f.sessions.clear();
    await expect(f.service.resource(preview.session_id, "index.html")).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
  });
  it("shows an existing incomplete HTML with explicit missing-resource details without silently publishing it", async () => {
    const f = fixture();
    const data = Buffer.from('<link rel="stylesheet" href="assets/missing.css"><h1>Visible</h1>');
    f.objects.set("original/index.html", data); f.source.file.sizeBytes = BigInt(data.length); f.source.file.checksumSha256 = sha256(data);
    const result = await f.service.open(ownerId, taskId, fileId);
    expect(result.html).toContain("Visible");
    expect(result.missing_resources).toEqual(["assets/missing.css"]);
  });
  it("rejects elapsed sessions and a changed immutable snapshot before serving another resource", async () => {
    const f = fixture();
    const preview = await f.service.open(ownerId, taskId, fileId);
    const session = f.sessions.get(preview.session_id)!;
    f.sessions.set(preview.session_id, { ...session, expiresAt: 1 });
    await expect(f.service.resource(preview.session_id, "index.html")).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    await expect(f.service.open(ownerId, taskId, fileId, preview.session_id)).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    f.sessions.set(preview.session_id, session);
    f.bundle({ "index.html": "<h1>Changed</h1>" });
    await expect(f.service.resource(preview.session_id, "index.html")).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
  });
});

describe("SVG sprites in private and published HTML", () => {
  it("inlines existing local sprites with isolated IDs, gradients, nested use and CSS selectors", async () => {
    const f = fixture();
    f.bundle({ "index.html": '<svg><use href="./icons.svg#star"></use><use href="./icons.svg#star"></use></svg>', "icons.svg": '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient></defs><symbol id="star" viewBox="0 0 10 10"><path id="shape" fill="url(#paint)" d="M0 0h10v10z"/><use href="#shape"/></symbol></svg>' });
    const preview = await f.service.open(ownerId, taskId, fileId);
    const published = await new WebSiteService(f.store, f.storage).resource("sample", releaseId, "index.html");
    expect(preview.html).not.toContain('href="./icons.svg#');
    expect(preview.html).toMatch(/href="#ls-svg-[^"]+-star"/u);
    expect(preview.html).toMatch(/url\(#ls-svg-[^)]+-paint\)/u);
    expect(preview.html.match(/<symbol /gu)).toHaveLength(1);
    expect(published.data.toString()).toBe(preview.html);
  });
  it("does not promote executable SVG content into HTML or fetch external sprites", async () => {
    const f = fixture();
    f.bundle({ "index.html": '<svg><use href="icons.svg#star"></use></svg>', "icons.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><symbol id="star"><path onload="alert(1)"/></symbol></svg>' });
    await expect(f.service.open(ownerId, taskId, fileId)).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
  });
  it("namespaces SVG styles without changing unrelated document IDs or external requests", async () => {
    const f = fixture();
    f.bundle({ "index.html": '<svg id="original"><use href="icons.svg#star"/><use href="https://example.test/external.svg#icon"/></svg>', "icons.svg": '<svg xmlns="http://www.w3.org/2000/svg"><style>#star,.shape,path{fill:url(#paint)}</style><linearGradient id="paint"/><symbol id="star"><path class="shape" d="M0 0h1v1z"/></symbol></svg>' });
    const preview = await f.service.open(ownerId, taskId, fileId);
    expect(preview.html).toContain('id="original"');
    expect(preview.html).toContain('href="https://example.test/external.svg#icon"');
    expect(preview.html).toMatch(/\[data-linksense-sprite[^\]]+\] path/u);
    expect(preview.html).toMatch(/\.ls-svg-[\w-]+shape/u);
    expect(f.storage.getObjectStream).toHaveBeenCalledTimes(2);
  });
});
