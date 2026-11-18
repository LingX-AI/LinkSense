import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { AppError } from "../src/lib/errors.js";
import type { WebSiteAnalytics } from "../src/modules/web-sites/analytics.js";
import { sha256 } from "../src/modules/web-sites/resources.js";
import { publishedResourcePolicy } from "../src/modules/web-sites/routes.js";
import { WebSiteService, withUrl } from "../src/modules/web-sites/service.js";
import { ownerId, taskId, fileId, siteId, releaseId, siteFixture } from "./web-sites.fixture.js";

describe("website publishing service", () => {
  it("keeps a historical independent origin while resolving its slug alias on the public platform", async () => {
    const fixture = siteFixture();
    const page = await fixture.service.list(ownerId, { limit: 30 });
    const site = page.items[0]!;
    const origin = "https://legacy-app.apps.example.test";
    expect(withUrl({ ...site, backend_id: taskId, url: origin }, "https://public.example.test")).toMatchObject({
      url: origin,
      alias_url: "https://public.example.test/app/s/sample",
      url_path: `/app/s/${siteId}`,
    });
    // Auto-generated UUID slugs are not addressable as slugs, so no custom link is advertised.
    expect(withUrl({ ...site, slug: "60000000-0000-4000-8000-000000000001" }, "https://public.example.test"))
      .not.toHaveProperty("alias_url");
  });
  it("hashes site passcodes and exposes only the protection state", async () => {
    const fixture = siteFixture();
    fixture.store.update.mockImplementation(async (_owner, _id, _input, _lease, passcodeHash) => ({
      site: { ...fixture.row.site, passcodeHash: passcodeHash ?? null },
      release: fixture.row.release,
    }));
    const protectedSite = await fixture.service.update(ownerId, siteId, { passcode: "sunrise" });
    expect(fixture.store.update).toHaveBeenCalledWith(ownerId, siteId, { passcode: "sunrise" }, undefined, expect.stringMatching(/^\$argon2id\$/u), undefined);
    expect(protectedSite.passcode_protected).toBe(true);
    expect(JSON.stringify(protectedSite)).not.toContain("$argon2");
    const openSite = await fixture.service.update(ownerId, siteId, { passcode: null });
    expect(fixture.store.update).toHaveBeenLastCalledWith(ownerId, siteId, { passcode: null }, undefined, null, undefined);
    expect(openSite.passcode_protected).toBe(false);
  });
  it("enables analytics for a published site and exposes its dashboard", async () => {
    const ensureSite = vi.fn(async () => ({ id: 7, domain: `${siteId}.linksense.invalid` }));
    const fixture = siteFixture();
    const service = new WebSiteService(fixture.store, fixture.storage, undefined, {
      ensureSite, dashboardUrl: (remoteId: number) => `http://stats.example.test/sites/${remoteId}`,
    } as unknown as WebSiteAnalytics);
    fixture.store.update.mockImplementation(async (_owner, _id, _input, _lease, _passcode, analytics) => ({
      site: { ...fixture.row.site, analyticsEnabled: analytics?.enabled ?? false,
        analyticsSiteId: analytics?.siteId ?? null, analyticsDomain: analytics?.domain ?? null },
      release: fixture.row.release,
    }));
    const result = await service.update(ownerId, siteId, { analytics: true });
    expect(ensureSite).toHaveBeenCalledWith({ name: "Sample", domain: `${siteId}.linksense.invalid` });
    expect(fixture.store.update).toHaveBeenCalledWith(ownerId, siteId, { analytics: true }, undefined, undefined,
      { enabled: true, siteId: 7, domain: `${siteId}.linksense.invalid` });
    expect(result).toMatchObject({ analytics_enabled: true, analytics_url: "http://stats.example.test/sites/7" });
  });
  it("stops analytics without creating a remote site and keeps history", async () => {
    const ensureSite = vi.fn(async () => ({ id: 7, domain: `${siteId}.linksense.invalid` }));
    const fixture = siteFixture();
    const service = new WebSiteService(fixture.store, fixture.storage, undefined,
      { ensureSite, dashboardUrl: () => "http://stats.example.test/sites/7" } as unknown as WebSiteAnalytics);
    await service.update(ownerId, siteId, { analytics: false });
    expect(ensureSite).not.toHaveBeenCalled();
    expect(fixture.store.update).toHaveBeenCalledWith(ownerId, siteId, { analytics: false }, undefined, undefined,
      { enabled: false });
  });
  it("refuses to enable analytics for an unpublished or unconfigured site", async () => {
    const ensureSite = vi.fn(async () => ({ id: 7, domain: `${siteId}.linksense.invalid` }));
    const fixture = siteFixture();
    fixture.row.site.status = "disabled";
    const service = new WebSiteService(fixture.store, fixture.storage, undefined,
      { ensureSite, dashboardUrl: () => "http://stats.example.test/sites/7" } as unknown as WebSiteAnalytics);
    await expect(service.update(ownerId, siteId, { analytics: true }))
      .rejects.toMatchObject({ code: "WEB_SITE_ANALYTICS_UNPUBLISHED" });
    expect(ensureSite).not.toHaveBeenCalled();
    await expect(siteFixture().service.update(ownerId, siteId, { analytics: true }))
      .rejects.toMatchObject({ code: "WEB_SITE_ANALYTICS_NOT_CONFIGURED" });
  });
  it("injects the analytics tracker into published HTML but never duplicates it", async () => {
    const fixture = siteFixture();
    fixture.row.site.analyticsEnabled = true;
    fixture.row.site.analyticsDomain = `${siteId}.linksense.invalid`;
    const service = new WebSiteService(fixture.store, fixture.storage, undefined,
      { ensureSite: vi.fn(), dashboardUrl: () => "http://stats.example.test/sites/7",
        scriptTag: () => '<script data-linksense-analytics="1"></script>' } as unknown as WebSiteAnalytics);
    const injected = await service.resource("sample", releaseId, "index.html");
    expect(injected.data.toString()).toContain("data-linksense-analytics");
    expect(injected.mimeType).toBe("text/html");
    const html = Buffer.from(`<html><head>${injected.data.toString()}</head></html>`);
    fixture.objects.set("original/index.html", html);
    const file = fixture.manifest.files[0]!;
    fixture.manifest.files[0] = { ...file, size_bytes: html.length, checksum_sha256: sha256(html) };
    fixture.row.release.manifestJson = fixture.manifest;
    const again = await service.resource("sample", releaseId, "index.html");
    expect(again.data.toString().match(/data-linksense-analytics/gu)).toHaveLength(1);
  });
  it("allows the configured analytics origin in the published resource policy", () => {
    const policy = publishedResourcePolicy("https://public.example.test", undefined, "http://stats.example.test:8091");
    expect(policy).toContain("script-src 'unsafe-inline' 'unsafe-eval' https:");
    expect(policy).toContain("http://stats.example.test:8091");
    expect(policy).toMatch(/connect-src [^;]*http:\/\/stats\.example\.test:8091/u);
  });
  it("publishes an existing self-contained HTML artifact with a generated UUID and a bounded manifest", async () => {
    const fixture = siteFixture();
    fixture.source.file.checksumSha256 = null;
    const site = await fixture.service.create(ownerId, { conversation_id: taskId, file_id: fileId, name: "Existing page", description: "" });
    expect(fixture.store.source).toHaveBeenCalledWith(ownerId, taskId, fileId);
    expect(fixture.store.create).toHaveBeenCalledWith(ownerId, expect.any(Object), expect.objectContaining({ slug: expect.stringMatching(/^[a-f0-9-]{36}$/u) }), "Source", fixture.manifest, undefined, undefined);
    expect(site.url_path).toBe(`/app/s/${siteId}`);
    expect(JSON.stringify(site)).not.toContain("object_key");
    expect(fixture.storage.putObject).not.toHaveBeenCalled();
  });
  it("refuses to publish a legacy HTML artifact whose local resources were not registered", async () => {
    const fixture = siteFixture();
    const data = Buffer.from('<script src="main.js"></script>');
    fixture.objects.set("original/index.html", data);
    fixture.source.file.sizeBytes = BigInt(data.length);
    fixture.source.file.checksumSha256 = null;
    await expect(fixture.service.create(ownerId, { conversation_id: taskId, file_id: fileId, name: "Incomplete", description: "" })).rejects.toMatchObject({ code: "WEB_SITE_RESOURCES_MISSING" });
    expect(fixture.store.create).not.toHaveBeenCalled();
  });
  it("keeps the current publication when source validation fails and rejects an unavailable source task", async () => {
    const fixture = siteFixture();
    fixture.source.bundle = { fileId, ownerId, conversationId: taskId, createdAt: fixture.row.site.createdAt, manifestJson: fixture.manifest };
    fixture.storage.getObjectSize.mockResolvedValue(0);
    await expect(fixture.service.publish(ownerId, siteId, fileId)).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
    expect(fixture.store.publish).not.toHaveBeenCalled();
    fixture.store.source.mockRejectedValue(new AppError("WEB_SITE_SOURCE_UNAVAILABLE"));
    await expect(fixture.service.publish(ownerId, siteId, fileId)).rejects.toMatchObject({ code: "WEB_SITE_SOURCE_UNAVAILABLE" });
  });
  it.each(["published", "disabled"] as const)("updates an existing %s site from another owned task while preserving its address and publication state", async status => {
    const fixture = siteFixture();
    const newTaskId = "20000000-0000-4000-8000-000000000002";
    fixture.row.site.status = status;
    fixture.source.conversation = { id: newTaskId, title: "Redesigned page" };
    fixture.source.file.conversationId = newTaskId;
    fixture.store.publish.mockImplementation(async (_owner, _id, conversationId, sourceFileId, nextReleaseId, manifest) => ({
      site: { ...fixture.row.site, conversationId, sourceFileId, sourceTaskTitle: "Redesigned page", currentReleaseId: nextReleaseId },
      release: { ...fixture.row.release, id: nextReleaseId, sourceFileId, manifestJson: manifest },
    }));
    const result = await fixture.service.publish(ownerId, siteId, fileId);
    expect(fixture.store.owned).toHaveBeenCalledWith(ownerId, siteId);
    expect(fixture.store.source).toHaveBeenCalledWith(ownerId, null, fileId);
    expect(fixture.store.publish).toHaveBeenCalledWith(ownerId, siteId, newTaskId, fileId, expect.any(String), fixture.manifest);
    expect(result).toMatchObject({ id: siteId, url_path: `/app/s/${siteId}`, name: "Sample", description: "", status, conversation_id: newTaskId, source_task_title: "Redesigned page" });
    expect(result.release_id).not.toBe(releaseId);
  });
  it("can update a retained site after its original task was deleted", async () => {
    const fixture = siteFixture();
    fixture.row.site.conversationId = null;
    fixture.row.site.status = "disabled";
    await expect(fixture.service.publish(ownerId, siteId, fileId)).resolves.toMatchObject({ id: siteId, status: "disabled" });
    expect(fixture.store.publish).toHaveBeenCalledWith(ownerId, siteId, taskId, fileId, expect.any(String), fixture.manifest);
  });
  it("does not read source content or publish when the target site belongs to someone else", async () => {
    const fixture = siteFixture();
    fixture.store.owned.mockRejectedValue(new AppError("WEB_SITE_NOT_FOUND"));
    await expect(fixture.service.publish(ownerId, siteId, fileId)).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    expect(fixture.store.source).not.toHaveBeenCalled();
    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
    expect(fixture.store.publish).not.toHaveBeenCalled();
  });
  it("does not read source content or change the current release when source ownership is denied", async () => {
    const fixture = siteFixture();
    fixture.store.source.mockRejectedValue(new AppError("WEB_SITE_SOURCE_UNAVAILABLE"));
    await expect(fixture.service.publish(ownerId, siteId, fileId)).rejects.toMatchObject({ code: "WEB_SITE_SOURCE_UNAVAILABLE" });
    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
    expect(fixture.store.publish).not.toHaveBeenCalled();
    expect(fixture.row.site.currentReleaseId).toBe(releaseId);
  });
  it("checks access on every resource request, including known old release URLs", async () => {
    const fixture = siteFixture();
    await expect(fixture.service.resource("sample", releaseId, "index.html")).resolves.toMatchObject({ mimeType: "text/html" });
    expect(fixture.store.publicSite).toHaveBeenCalledWith("sample", releaseId);
    fixture.store.publicSite.mockRejectedValue(new AppError("WEB_SITE_NOT_FOUND"));
    await expect(fixture.service.resource("sample", releaseId, "index.html")).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    expect(fixture.storage.getObjectStream).toHaveBeenCalledTimes(1);
  });
  it("rejects unlisted paths and corrupt stored content", async () => {
    const fixture = siteFixture();
    await expect(fixture.service.resource("sample", releaseId, "../../index.html")).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    fixture.objects.set("original/index.html", Buffer.alloc(fixture.html.length));
    await expect(fixture.service.resource("sample", releaseId, "index.html")).rejects.toMatchObject({ code: "WEB_SITE_BUNDLE_INVALID" });
  });
  it("downloads all files and allows owner download for a disabled site with deleted source task", async () => {
    const fixture = siteFixture();
    fixture.row.site.status = "disabled";
    fixture.row.site.conversationId = null;
    const archive = await fixture.service.download(ownerId, siteId);
    expect(archive.filename).toBe("sample.zip");
    expect(await (await JSZip.loadAsync(archive.data)).file("index.html")?.async("string")).toContain('onclick="this.textContent=42"');
    expect(fixture.store.owned).toHaveBeenCalledWith(ownerId, siteId);
    await fixture.service.delete(ownerId, siteId);
    expect(fixture.storage.removeObject).not.toHaveBeenCalled();
  });
  it("returns an opaque stable list cursor without leaking the extra row", async () => {
    const fixture = siteFixture();
    fixture.store.list.mockResolvedValue([fixture.row, fixture.row]);
    const page = await fixture.service.list(ownerId, { limit: 1, status: "disabled", search: "sample" });
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).toBe(`${fixture.row.site.updatedAt.toISOString()}|${siteId}`);
    expect(fixture.store.list).toHaveBeenCalledWith(ownerId, { limit: 1, status: "disabled", search: "sample" });
  });
});
