import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { ownerId, taskId, fileId, siteId, siteFixture } from "./web-sites.fixture.js";

const turnId = "60000000-0000-4000-8000-000000000001";
const publicBaseUrl = "https://linksense.example.test";

describe("public site agent tool service", () => {
  it("creates a site from the active conversation artifact and returns an absolute URL", async () => {
    const fixture = siteFixture();
    const result = await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "publish",
      name: "Water reminder",
      slug: "water-reminder",
      file_id: fileId,
    }, publicBaseUrl);

    expect(fixture.store.assertActor).toHaveBeenCalledWith(ownerId);
    expect(fixture.store.assertActiveTurn).toHaveBeenCalledWith(ownerId, taskId, turnId);
    expect(fixture.store.create).toHaveBeenCalledWith(ownerId, {
      conversation_id: taskId,
      file_id: fileId,
      name: "Water reminder",
      description: "",
      slug: "water-reminder",
    }, expect.any(Object), "Source", fixture.manifest);
    expect(result).toMatchObject({
      id: siteId,
      url_path: "/web/sample",
      url: `${publicBaseUrl}/web/sample`,
    });
  });

  it("publishes a new release for an existing owned site", async () => {
    const fixture = siteFixture();
    const result = await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "publish",
      file_id: fileId,
      site_id: siteId,
    }, publicBaseUrl);

    expect(fixture.store.owned).toHaveBeenCalledWith(ownerId, siteId);
    expect(fixture.store.publish).toHaveBeenCalledWith(ownerId, siteId, taskId, fileId, expect.any(String), fixture.manifest);
    expect(result).toMatchObject({ id: siteId, url: `${publicBaseUrl}/web/sample` });
  });

  it("lists owned sites and updates metadata without changing the release", async () => {
    const fixture = siteFixture();
    const page = await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "list",
      search: "sample",
      limit: 20,
    }, publicBaseUrl);
    expect(page).toEqual({
      items: [expect.objectContaining({ id: siteId, url: `${publicBaseUrl}/web/sample` })],
      next_cursor: null,
    });

    const updated = await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "update",
      site_id: siteId,
      status: "disabled",
    }, publicBaseUrl);
    expect(fixture.store.update).toHaveBeenCalledWith(ownerId, siteId, { status: "disabled" });
    expect(updated).toMatchObject({ id: siteId, url: `${publicBaseUrl}/web/sample` });
  });

  it("rejects an inactive turn and an empty metadata update", async () => {
    const fixture = siteFixture();
    fixture.store.assertActiveTurn.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    await expect(fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "list",
      limit: 20,
    }, publicBaseUrl)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "update",
      site_id: siteId,
    }, publicBaseUrl)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fixture.store.update).not.toHaveBeenCalled();
  });

  it("accepts the cursor returned by the previous page", async () => {
    const fixture = siteFixture();
    fixture.store.list.mockResolvedValueOnce([fixture.row, fixture.row]);
    const result = await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "list", limit: 1,
    }, publicBaseUrl);
    if (!("items" in result) || !result.next_cursor) throw new Error("Missing next page");
    await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "list", limit: 1, cursor: result.next_cursor,
    }, publicBaseUrl);
    expect(fixture.store.list).toHaveBeenLastCalledWith(ownerId, {
      limit: 1, cursor: { id: siteId, updatedAt: fixture.row.site.updatedAt },
    });
  });
});
