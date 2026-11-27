import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { WebSiteRepository } from "../src/modules/web-sites/repository.js";
import { fileId, ownerId, releaseId, siteFixture, siteId, taskId } from "./web-sites.fixture.js";

function fixture(owned = true) {
  const tx = {
    $queryRaw: vi.fn<(query: Prisma.Sql) => Promise<Array<{ id: string }>>>().mockResolvedValue(owned ? [{ id: siteId }] : []),
    webSite: { delete: vi.fn().mockResolvedValue({ id: siteId }) },
    webSiteAddress: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    webSiteRelease: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const transaction = vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
  const repository = new WebSiteRepository({ $transaction: transaction } as unknown as PrismaClient);
  return { repository, tx, transaction };
}

describe("website permanent deletion", () => {
  it("deletes all releases, current and retired address reservations, and the owned site in one transaction", async () => {
    const { repository, tx, transaction } = fixture();
    await repository.delete(ownerId, siteId);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.webSiteRelease.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { siteId } });
    expect(tx.webSiteAddress.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { siteId } });
    expect(tx.webSite.delete).toHaveBeenCalledExactlyOnceWith({ where: { id: siteId } });
    expect(tx.webSiteRelease.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(tx.webSite.delete.mock.invocationCallOrder[0]!);
    expect(tx.webSiteAddress.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(tx.webSite.delete.mock.invocationCallOrder[0]!);
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: ownerId, targetId: siteId, action: "web_site_deleted" }) });
    const lock = tx.$queryRaw.mock.calls[0]![0];
    expect(lock.sql).toMatch(/owner_id = .*FOR UPDATE/u);
    expect(lock.values).toEqual([siteId, ownerId]);
  });

  it("does not delete anything when the site is absent or belongs to another user", async () => {
    const { repository, tx } = fixture(false);
    await expect(repository.delete(ownerId, siteId)).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    expect(tx.webSiteRelease.deleteMany).not.toHaveBeenCalled();
    expect(tx.webSiteAddress.deleteMany).not.toHaveBeenCalled();
    expect(tx.webSite.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    { name: "New name" },
    { slug: "new-slug" },
    { status: "disabled" },
    { currentReleaseId: "50000000-0000-4000-8000-000000000002" },
  ])("rejects approval for a changed site before removing its rows (%o)", async change => {
    const { repository, tx } = fixture();
    const site = siteFixture().row.site;
    tx.$queryRaw.mockResolvedValueOnce([{ ...site, ...change }]);
    await expect(repository.delete(ownerId, siteId, {
      name: site.name, slug: site.slug, status: "published", release_id: releaseId,
    })).rejects.toMatchObject({ code: "WEB_SITE_CHANGED" });
    expect(tx.webSiteRelease.deleteMany).not.toHaveBeenCalled();
    expect(tx.webSiteAddress.deleteMany).not.toHaveBeenCalled();
    expect(tx.webSite.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("propagates cleanup failure and stops before deleting the site", async () => {
    const { repository, tx } = fixture();
    const failure = new Error("database unavailable");
    tx.webSiteAddress.deleteMany.mockRejectedValue(failure);
    await expect(repository.delete(ownerId, siteId)).rejects.toBe(failure);
    expect(tx.webSite.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("website lookup by original HTML file", () => {
  it("keeps the owner filter when looking up a previously published file", async () => {
    const row = siteFixture().row;
    const findSites = vi.fn().mockResolvedValue([row.site]);
    const findReleases = vi.fn().mockResolvedValue([row.release]);
    const repository = new WebSiteRepository({
      webSite: { findMany: findSites },
      webSiteRelease: { findMany: findReleases },
    } as unknown as PrismaClient);
    await expect(repository.list(ownerId, { originFileId: fileId, limit: 30 })).resolves.toEqual([row]);
    expect(findSites).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId, originFileId: fileId }),
    }));
  });
});

describe("dynamic publication fencing", () => {
  function enhancementFixture(currentBackend: string | null = null, mode: string | null = "sandbox", bound = 0) {
    const row = siteFixture().row;
    const tx = {
      $queryRaw: vi.fn(async (query: Prisma.Sql) => query.sql.includes("FROM conversations")
        ? [{ id: taskId, title: "Updated" }] : query.sql.includes("FROM web_sites")
          ? [{ id: siteId, backendId: currentBackend }] : [{ id: backendId }]),
      conversationFile: { count: vi.fn().mockResolvedValue(1) },
      webSiteBackend: { findUnique: vi.fn().mockResolvedValue({ runtimeMode: mode }) },
      webSite: { count: vi.fn().mockResolvedValue(bound), update: vi.fn().mockResolvedValue(row.site) },
      webSiteRelease: { create: vi.fn().mockResolvedValue(row.release) },
      auditLog: { create: vi.fn() },
    };
    const repository = new WebSiteRepository({
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as PrismaClient);
    return { repository, tx, row };
  }
  const backendId = "60000000-0000-4000-8000-000000000001";

  it("atomically associates a ready unused sandbox backend with the new release while retaining application metadata", async () => {
    const f = enhancementFixture();
    await f.repository.publish(ownerId, siteId, taskId, fileId, releaseId, siteFixture().manifest, undefined, backendId);
    expect(f.tx.webSite.update).toHaveBeenCalledWith({ where: { id: siteId }, data: {
      backendId, currentReleaseId: releaseId, sourceFileId: fileId, conversationId: taskId, sourceTaskTitle: "Updated",
    } });
    const lock = f.tx.$queryRaw.mock.calls.at(-1)![0];
    expect(lock.values).toContain(ownerId);
    expect(lock.sql).toContain("status='ready'");
    expect(f.tx.webSite.count).toHaveBeenCalledWith({ where: { backendId } });
  });

  it.each([
    ["another backend", "70000000-0000-4000-8000-000000000001", "sandbox", 0],
    ["legacy origin mode", null, null, 0],
    ["a backend already bound elsewhere", null, "sandbox", 1],
  ] as const)("rejects %s before writing a release or changing the static app", async (_label, current, mode, bound) => {
    const f = enhancementFixture(current, mode, bound);
    await expect(f.repository.publish(ownerId, siteId, taskId, fileId, releaseId,
      siteFixture().manifest, undefined, backendId)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.tx.webSiteRelease.create).not.toHaveBeenCalled();
    expect(f.tx.webSite.update).not.toHaveBeenCalled();
  });

  it("preserves the previous page when building the enhanced release fails", async () => {
    const f = enhancementFixture();
    f.tx.webSiteRelease.create.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(f.repository.publish(ownerId, siteId, taskId, fileId, releaseId,
      siteFixture().manifest, undefined, backendId)).rejects.toThrow("storage unavailable");
    expect(f.tx.webSite.update).not.toHaveBeenCalled();
  });
  it.each(["publish", "restore"] as const)(
    "rejects %s before writing when the backend publication lease is lost",
    async (operation) => {
      const { manifest } = siteFixture();
      const backendId = "60000000-0000-4000-8000-000000000001";
      const lease = new Date(Date.now() + 60_000);
      const query = vi.fn<(query: Prisma.Sql) => Promise<unknown[]>>();
      if (operation === "publish") query.mockResolvedValueOnce([{ id: taskId, title: "Source" }]);
      query.mockResolvedValueOnce([{ id: siteId, backendId }]).mockResolvedValueOnce([]);
      const tx = {
        $queryRaw: query,
        conversationFile: { count: vi.fn().mockResolvedValue(1) },
        webSite: { update: vi.fn() },
        webSiteRelease: { create: vi.fn() },
        auditLog: { create: vi.fn() },
      };
      const repository = new WebSiteRepository({
        $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
      } as unknown as PrismaClient);

      await expect(operation === "publish"
        ? repository.publish(ownerId, siteId, taskId, fileId, releaseId, manifest, lease)
        : repository.update(ownerId, siteId, { status: "published" }, lease)
      ).rejects.toMatchObject({ code: "WEB_SITE_BACKEND_PENDING" });
      expect(query.mock.calls.at(-1)?.[0].values).toContain(lease);
      expect(tx.webSite.update).not.toHaveBeenCalled();
      expect(tx.webSiteRelease.create).not.toHaveBeenCalled();
    },
  );
});

describe("public application addresses", () => {
  it("resolves a retired slug through its reserved application identity", async () => {
    const row = siteFixture().row;
    const db = {
      webSite: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row.site) },
      webSiteAddress: { findUnique: vi.fn().mockResolvedValue({ slug: "previous", siteId }) },
      webSiteRelease: { findFirst: vi.fn().mockResolvedValue(row.release) },
      user: { count: vi.fn().mockResolvedValue(1) },
    };
    const repo = new WebSiteRepository(db as unknown as PrismaClient);
    await expect(repo.publicSite("previous")).resolves.toEqual(row);
    expect(db.webSite.findFirst).toHaveBeenLastCalledWith({ where: { id: siteId, status: "published" } });
  });

  it.each([0, 1])("rejects an inactive owner or unavailable application for active-owner count %s", async active => {
    const db = {
      webSite: { findFirst: vi.fn().mockResolvedValue(active ? null : siteFixture().row.site) },
      user: { count: vi.fn().mockResolvedValue(active) },
      webSiteRelease: { findFirst: vi.fn() },
    };
    await expect(new WebSiteRepository(db as unknown as PrismaClient).publicSiteById(siteId))
      .rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    expect(db.webSiteRelease.findFirst).not.toHaveBeenCalled();
  });
});
