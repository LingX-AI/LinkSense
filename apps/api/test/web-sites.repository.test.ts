import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { WebSiteRepository } from "../src/modules/web-sites/repository.js";
import { ownerId, siteId } from "./web-sites.fixture.js";

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

  it("propagates cleanup failure and stops before deleting the site", async () => {
    const { repository, tx } = fixture();
    const failure = new Error("database unavailable");
    tx.webSiteAddress.deleteMany.mockRejectedValue(failure);
    await expect(repository.delete(ownerId, siteId)).rejects.toBe(failure);
    expect(tx.webSite.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
