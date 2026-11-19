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
    }, expect.any(Object), "Source", fixture.manifest, undefined, undefined);
    expect(result).toMatchObject({
      id: siteId,
      url_path: `/app/s/${siteId}`,
      url: `${publicBaseUrl}/app/s/${siteId}`,
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
    expect(result).toMatchObject({ id: siteId, url: `${publicBaseUrl}/app/s/${siteId}` });
  });

  it("lists owned sites and updates metadata without changing the release", async () => {
    const fixture = siteFixture();
    const page = await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "list",
      search: "sample",
      limit: 20,
    }, publicBaseUrl);
    expect(page).toEqual({
      items: [expect.objectContaining({ id: siteId, url: `${publicBaseUrl}/app/s/${siteId}` })],
      next_cursor: null,
    });

    const updated = await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "update",
      site_id: siteId,
      status: "disabled",
    }, publicBaseUrl);
    expect(fixture.store.update).toHaveBeenCalledWith(ownerId, siteId, { status: "disabled" }, undefined, undefined, undefined);
    expect(updated).toMatchObject({ id: siteId, url: `${publicBaseUrl}/app/s/${siteId}` });
  });

  it("passes an analytics change through the agent update tool", async () => {
    const fixture = siteFixture();
    await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "update",
      site_id: siteId,
      analytics: false,
    }, publicBaseUrl);
    expect(fixture.store.update).toHaveBeenCalledWith(ownerId, siteId, { analytics: false }, undefined, undefined, { enabled: false });
  });

  it("passes a passcode change through the agent update tool", async () => {
    const fixture = siteFixture();
    await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "update",
      site_id: siteId,
      passcode: "open-sesame",
    }, publicBaseUrl);
    expect(fixture.store.update).toHaveBeenCalledWith(ownerId, siteId, { passcode: "open-sesame" }, undefined, expect.any(String), undefined);
  });

  it("removes the passcode through the agent update tool", async () => {
    const fixture = siteFixture();
    await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "update",
      site_id: siteId,
      passcode: null,
    }, publicBaseUrl);
    expect(fixture.store.update).toHaveBeenCalledWith(ownerId, siteId, { passcode: null }, undefined, null, undefined);
  });

  it("deletes an owned site through the agent tool", async () => {
    const fixture = siteFixture();
    const result = await fixture.service.toolForOwner(ownerId, taskId, turnId, {
      operation: "delete",
      site_id: siteId,
    }, publicBaseUrl);
    expect(fixture.store.delete).toHaveBeenCalledWith(ownerId, siteId);
    expect(result).toEqual({ deleted: true });
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
