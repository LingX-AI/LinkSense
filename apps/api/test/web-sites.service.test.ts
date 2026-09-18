import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { AppError } from "../src/lib/errors.js";
import { ownerId, taskId, fileId, siteId, releaseId, siteFixture } from "./web-sites.fixture.js";

describe("website publishing service", () => {
  it("publishes an existing self-contained HTML artifact with a generated UUID and a bounded manifest", async () => {
    const fixture = siteFixture();
    fixture.source.file.checksumSha256 = null;
    const site = await fixture.service.create(ownerId, { conversation_id: taskId, file_id: fileId, name: "Existing page", description: "" });
    expect(fixture.store.source).toHaveBeenCalledWith(ownerId, taskId, fileId);
    expect(fixture.store.create).toHaveBeenCalledWith(ownerId, expect.any(Object), expect.objectContaining({ slug: expect.stringMatching(/^[a-f0-9-]{36}$/u) }), "Source", fixture.manifest);
    expect(site.url_path).toBe("/web/sample");
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
    expect(result).toMatchObject({ id: siteId, url_path: "/web/sample", name: "Sample", description: "", status, conversation_id: newTaskId, source_task_title: "Redesigned page" });
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
