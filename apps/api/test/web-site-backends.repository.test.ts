import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.js";
import { WebSiteBackendRepository } from "../src/modules/web-site-backends/repository.js";
import { backendId } from "./web-site-backends.fixture.js";

function fixture(locked = true, addressOwner = backendId) {
  const tx = {
    $queryRaw: vi.fn<(query: Prisma.Sql) => Promise<Array<{ id: string }>>>()
      .mockResolvedValue(locked ? [{ id: backendId }] : []),
    webSiteBackendAddress: { upsert: vi.fn(async () => ({ label: "appointments", backendId: addressOwner })) },
    webSiteBackend: { update: vi.fn(async () => ({})) },
  };
  const repository = new WebSiteBackendRepository({
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as PrismaClient);
  return { repository, tx };
}

describe("dynamic application address ownership", () => {
  it("reserves an address before switching the current label and never deletes previous reservations", async () => {
    const { repository, tx } = fixture();
    const lease = new Date(Date.now() + 60_000);
    await repository.setHostLabel(backendId, lease, "appointments");
    expect(tx.webSiteBackendAddress.upsert).toHaveBeenCalledExactlyOnceWith({
      where: { label: "appointments" }, create: { label: "appointments", backendId }, update: {},
    });
    expect(tx.webSiteBackend.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: backendId }, data: { hostLabel: "appointments", hostResolved: true },
    });
    expect(tx.webSiteBackendAddress.upsert.mock.invocationCallOrder[0])
      .toBeLessThan(tx.webSiteBackend.update.mock.invocationCallOrder[0]!);
    expect(tx.$queryRaw.mock.calls[0]?.[0].values).toEqual([backendId, lease, expect.any(Date)]);
    expect(tx.$queryRaw.mock.calls[0]?.[0].sql).toMatch(/lease_until > .* FOR UPDATE/u);
  });

  it("rejects an address retained by another backend without updating the current address", async () => {
    const { repository, tx } = fixture(true, "70000000-0000-4000-8000-000000000001");
    await expect(repository.setHostLabel(backendId, new Date(Date.now() + 60_000), "appointments"))
      .rejects.toMatchObject({ code: "WEB_SITE_BACKEND_ADDRESS_TAKEN" });
    expect(tx.webSiteBackend.update).not.toHaveBeenCalled();
  });

  it("rejects a lost or expired lease before reserving or rolling back an address", async () => {
    const { repository, tx } = fixture(false);
    await expect(repository.setHostLabel(backendId, new Date(Date.now() - 1), "appointments"))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repository.setHostLabel(backendId, new Date(Date.now() - 1), null))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.webSiteBackendAddress.upsert).not.toHaveBeenCalled();
    expect(tx.webSiteBackend.update).not.toHaveBeenCalled();
  });

  it("can restore a historical UUID address without releasing attempted addresses", async () => {
    const { repository, tx } = fixture();
    await repository.setHostLabel(backendId, new Date(Date.now() + 60_000), null);
    expect(tx.webSiteBackendAddress.upsert).not.toHaveBeenCalled();
    expect(tx.webSiteBackend.update).toHaveBeenCalledExactlyOnceWith({ where: { id: backendId }, data: { hostLabel: null, hostResolved: true } });
  });

  it("persists uncertain upstream results for native verification on the next read", async () => {
    const { repository, tx } = fixture();
    await repository.setHostLabel(backendId, new Date(Date.now() + 60_000), "appointments", false);
    expect(tx.webSiteBackend.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: backendId }, data: { hostLabel: "appointments", hostResolved: false },
    });
  });
});
