import {
  internalWebSiteToolRequestSchema,
  supportedLocales,
  webSiteToolApprovalSchema,
} from "@linksense/shared";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { AppError, errorDetails, normalizeError } from "../src/lib/errors.js";
import { webSiteToolMessages } from "../src/lib/locales/web-site-tools.js";
import { internalWebSiteToolRoutes } from "../src/modules/web-sites/internal-routes.js";
import { WebSiteToolService } from "../src/modules/web-sites/tool-service.js";
import { fileId, now, ownerId, releaseId, siteFixture, siteId, taskId } from "./web-sites.fixture.js";

const turnId = "60000000-0000-4000-8000-000000000001";
const publicBaseUrl = "https://example.test:18173";
const scope = { conversationId: taskId, turnId };
const draft = { tool: "publish_site", site: { file_id: fileId, name: "Sample", description: "Web example" } };
const replace = { tool: "update_site", site_id: siteId, changes: { file_id: fileId } };
const remove = { tool: "delete_site", site_id: siteId };

function fixture(preferredLocale: string | null = "zh-CN") {
  const site = siteFixture();
  const prisma = {
    user: { findFirst: vi.fn(async (): Promise<{ preferredLocale: string | null } | null> => ({ preferredLocale })) },
    conversation: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: taskId })) },
    conversationTurn: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: turnId })) },
  };
  const tools = new WebSiteToolService(prisma as unknown as Pick<PrismaClient, "user" | "conversation" | "conversationTurn">, site.service, publicBaseUrl);
  const execute = (request: unknown, requiresDeleteApproval?: true) =>
    tools.execute(ownerId, internalWebSiteToolRequestSchema.parse({ ...scope, request, requiresDeleteApproval }));
  return { ...site, prisma, tools, execute };
}

describe("conversation site tools", () => {
  it.each(supportedLocales)("prepares a localized approval with exact draft details in %s before any write", async locale => {
    const f = fixture(locale);
    f.store.list.mockResolvedValue([]);
    const approval = webSiteToolApprovalSchema.parse(await f.execute(draft));
    if (approval.confirmation.tool !== "publish_site") throw new Error("expected publication");
    const draftSite = approval.confirmation.site;
    expect(draftSite).toMatchObject({ ...draft.site, conversation_id: taskId });
    expect(draftSite.slug).toMatch(/^[a-f0-9-]{36}$/u);
    const message = approval.message.replaceAll("\\", "");
    for (const value of ["Sample", "Web example", "Source", "index.html", publicBaseUrl + "/web/" + draftSite.slug]) {
      expect(message).toContain(value);
    }
    expect(approval.approveLabel).toBe(webSiteToolMessages[locale]["webSiteTool.approvePublish"]);
    expect(approval.rejectLabel).toBe(webSiteToolMessages[locale]["webSiteTool.reject"]);
    expect(approval.decisionLabel).toBe(webSiteToolMessages[locale]["webSiteTool.decision"]);
    expect(approval.message).not.toMatch(/\{\{\w+\}\}/u);
    expect(f.store.create).not.toHaveBeenCalled();

    f.store.create.mockImplementation(async (_owner, input, ids) => ({
      ...f.row,
      site: { ...f.row.site, name: input.name, description: input.description, slug: ids.slug },
    }));
    const result = await f.tools.confirm(ownerId, { ...scope, confirmation: approval.confirmation });
    expect(result).toMatchObject({
      tool: "publish_site", outcome: "published",
      site: { id: siteId, name: draftSite.name, description: draftSite.description, status: "published", url: publicBaseUrl + "/web/" + draftSite.slug },
    });
    expect(result).not.toHaveProperty("site.url_path");
    expect(f.store.create).toHaveBeenCalledExactlyOnceWith(ownerId, draftSite, expect.objectContaining({ slug: draftSite.slug }), "Source", expect.anything());
  });

  it("uses the fallback language and keeps site metadata as plain text in the approval", async () => {
    const f = fixture("unknown");
    f.store.list.mockResolvedValue([]);
    const approval = webSiteToolApprovalSchema.parse(await f.execute({
      ...draft, site: { ...draft.site, name: "[Example](https://invalid.test)\n# Another title" },
    }));
    expect(approval.approveLabel).toBe("确认发布");
    expect(approval.message).toContain("\\[Example\\]\\(");
    expect(approval.message).not.toContain("\n# Another title");
  });

  it("returns the site already created from this artifact even when it is unpublished", async () => {
    const f = fixture();
    f.row.site.status = "disabled";
    const result = await f.execute(draft);
    expect(result).toMatchObject({
      tool: "publish_site", outcome: "existing", site: { id: siteId, status: "disabled", url: publicBaseUrl + "/web/sample" },
    });
    expect(result).not.toHaveProperty("site.url_path");
    expect(f.store.list).toHaveBeenCalledExactlyOnceWith(ownerId, { originFileId: fileId, limit: 1 });
    expect(f.store.create).not.toHaveBeenCalled();
  });

  it("lists its owner's sites across tasks, and lists HTML artifacts scoped to the current task", async () => {
    const f = fixture();
    const cursor = now.toISOString() + "|" + siteId;
    await expect(f.execute({ tool: "list_sites", search: "sample", status: "published", limit: 10, cursor })).resolves.toMatchObject({
      tool: "list_sites", items: [{ id: siteId, url: publicBaseUrl + "/web/sample" }], next_cursor: null,
    });
    expect(f.store.list).toHaveBeenCalledExactlyOnceWith(ownerId, { search: "sample", status: "published", limit: 10, cursor: { id: siteId, updatedAt: now } });
    await expect(f.execute({ tool: "publish_site" })).resolves.toMatchObject({
      tool: "publish_site", outcome: "sources", sources: [{ id: fileId, filename: "index.html" }],
    });
    expect(f.store.taskSources).toHaveBeenCalledExactlyOnceWith(ownerId, taskId);
  });

  it.each(supportedLocales)("confirms a replacement against the approved site and source in %s", async locale => {
    const f = fixture(locale);
    const approval = webSiteToolApprovalSchema.parse(await f.execute(replace));
    expect(approval.confirmation).toEqual({
      tool: "update_site", site_id: siteId, file_id: fileId,
      expected: { slug: "sample", name: "Sample", status: "published", release_id: releaseId },
    });
    const message = approval.message.replaceAll("\\", "");
    for (const value of ["Sample", "Source", "index.html", publicBaseUrl + "/web/sample"]) {
      expect(message).toContain(value);
    }
    expect(approval.message).not.toMatch(/\{\{\w+\}\}/u);
    expect(approval.approveLabel).toBe(webSiteToolMessages[locale]["webSiteTool.approveUpdate"]);
    expect(f.store.publish).not.toHaveBeenCalled();
    const result = await f.tools.confirm(ownerId, { ...scope, confirmation: approval.confirmation });
    expect(result).toMatchObject({
      tool: "update_site", site: { id: siteId, url: publicBaseUrl + "/web/sample" },
    });
    expect(result).not.toHaveProperty("site.url_path");
    expect(f.store.publish).toHaveBeenCalledExactlyOnceWith(ownerId, siteId, taskId, fileId, expect.any(String), f.manifest, {
      name: "Sample", slug: "sample", status: "published", release_id: releaseId,
    });
  });

  it("updates an unpublished version while requiring the status to remain unpublished at the write", async () => {
    const f = fixture();
    f.row.site.status = "disabled";
    const result = await f.execute(replace);
    expect(result).toMatchObject({
      tool: "update_site", site: { id: siteId, status: "disabled", url: publicBaseUrl + "/web/sample" },
    });
    expect(result).not.toHaveProperty("site.url_path");
    expect(f.store.publish).toHaveBeenCalledExactlyOnceWith(ownerId, siteId, taskId, fileId, expect.any(String), f.manifest, {
      name: "Sample", slug: "sample", status: "disabled", release_id: releaseId,
    });
  });

  it("routes metadata changes and unpublishing to the existing owned-site operations", async () => {
    const f = fixture();
    const changes = { name: "Renamed", description: "", slug: "renamed" };
    f.store.update.mockResolvedValueOnce({
      ...f.row,
      site: { ...f.row.site, ...changes },
    });
    const result = await f.execute({ tool: "update_site", site_id: siteId, changes });
    expect(result).toMatchObject({
      tool: "update_site", site: { id: siteId, slug: changes.slug, url: publicBaseUrl + "/web/renamed" },
    });
    expect(result).not.toHaveProperty("site.url_path");
    await f.execute({ tool: "unpublish_site", site_id: siteId });
    expect(f.store.update.mock.calls).toEqual([[ownerId, siteId, changes], [ownerId, siteId, { status: "disabled" }]]);
    expect(f.store.publish).not.toHaveBeenCalled();
  });

  it.each(supportedLocales)("prepares a localized deletion approval before removing the owned site in %s", async locale => {
    const f = fixture(locale);
    const approval = webSiteToolApprovalSchema.parse(await f.execute(remove, true));
    const expected = { name: "Sample", slug: "sample", status: "published", release_id: releaseId };
    expect(approval.confirmation).toEqual({ ...remove, expected });
    expect(approval.message.replaceAll("\\", "")).toContain(publicBaseUrl + "/web/sample");
    expect(approval.message).toContain(expected.name);
    expect(approval.message).not.toMatch(/\{\{\w+\}\}/u);
    expect(approval.decisionLabel).toBe(webSiteToolMessages[locale]["webSiteTool.deleteDecision"]);
    expect(approval.approveLabel).toBe(webSiteToolMessages[locale]["webSiteTool.approveDelete"]);
    expect(approval.rejectLabel).toBe(webSiteToolMessages[locale]["webSiteTool.reject"]);
    expect(f.store.owned).toHaveBeenCalledExactlyOnceWith(ownerId, siteId);
    expect(f.store.delete).not.toHaveBeenCalled();

    await expect(f.tools.confirm(ownerId, { ...scope, confirmation: approval.confirmation })).resolves.toEqual(remove);
    expect(f.store.delete).toHaveBeenCalledExactlyOnceWith(ownerId, siteId, expected);
  });

  it("denies deleting an unavailable or foreign site before asking for confirmation", async () => {
    const f = fixture();
    f.store.owned.mockRejectedValue(new AppError("WEB_SITE_NOT_FOUND"));
    await expect(f.execute(remove, true)).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    expect(f.store.delete).not.toHaveBeenCalled();
  });

  it.each(["user", "conversation", "conversationTurn"] as const)("rejects preparation and confirmation when the %s scope is unavailable", async denied => {
    const f = fixture();
    f.prisma[denied].findFirst.mockResolvedValue(null);
    await expect(f.execute({ tool: "list_sites" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.tools.confirm(ownerId, {
      ...scope, confirmation: { tool: "publish_site", site: { ...draft.site, conversation_id: taskId, slug: "sample" } },
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.store.list).not.toHaveBeenCalled();
    expect(f.store.create).not.toHaveBeenCalled();
  });

  it("rejects model-supplied approval, identity or publication status and unguarded deletion at the internal route", async () => {
    const f = fixture();
    const app = Fastify();
    const secret = "site-test-secret".repeat(3);
    app.setErrorHandler((error, _request, reply) => {
      const { code } = normalizeError(error);
      void reply.code(errorDetails(code, "en-US").status).send({ error_code: code });
    });
    await app.register(internalWebSiteToolRoutes, { prefix: "/internal/web-sites", service: f.tools, sharedSecret: secret });
    try {
      const payload = { ...scope, confirmation: {
        ...remove, expected: { name: "Sample", slug: "sample", status: "published", release_id: releaseId },
      } };
      const headers = { "x-linksense-owner-id": ownerId };
      expect((await app.inject({ method: "POST", url: "/internal/web-sites/confirm", headers, payload })).statusCode).toBe(401);
      for (const invalid of [
        { request: { ...draft, confirmed: true } },
        { request: { ...draft, owner_id: ownerId } },
        { request: { ...replace, changes: { status: "published" } } },
        { request: { ...replace, changes: {} } },
        { request: remove },
        { request: { ...remove, confirmed: true }, requiresDeleteApproval: true },
      ]) {
        expect((await app.inject({
          method: "POST", url: "/internal/web-sites/execute",
          headers: { ...headers, authorization: "Bearer " + secret }, payload: { ...scope, ...invalid },
        })).statusCode).toBe(400);
      }
      expect(f.store.update).not.toHaveBeenCalled();
      expect(f.store.create).not.toHaveBeenCalled();
      expect(f.store.delete).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
