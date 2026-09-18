import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaCredentialStore } from "../src/modules/credentials/repository.js";

describe("credential runtime snapshot", () => {
  it("uses four bounded queries in a fresh repeatable-read transaction, with owner and enabled filters", async () => {
    const database = {
      capability: { findMany: vi.fn().mockResolvedValue([{ id: "enabled" }, { id: "disabled" }]) },
      capabilityUserPreference: { findMany: vi.fn().mockResolvedValue([{ capabilityId: "disabled" }]) },
      credentialBinding: { findMany: vi.fn().mockResolvedValue([{ credentialId: "credential" }, { credentialId: "credential" }]) },
      credential: { findMany: vi.fn().mockResolvedValue([{ id: "credential" }]) },
    };
    const transaction = vi.fn(async (read: (client: typeof database) => Promise<unknown>) => read(database));
    const store = new PrismaCredentialStore({ $transaction: transaction } as unknown as PrismaClient);
    const result = await store.readRuntimeSnapshot("owner", ["enabled", "disabled"]);
    expect(result.capabilities.map(value => value.id)).toEqual(["enabled"]);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
    expect(database.capability.findMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: ["enabled", "disabled"] }, ownerId: "owner", type: "plugin", status: "active" } });
    expect(database.capabilityUserPreference.findMany).toHaveBeenCalledExactlyOnceWith({ where: { userId: "owner", capabilityId: { in: ["enabled", "disabled"] }, status: "disabled" }, select: { capabilityId: true } });
    expect(database.credentialBinding.findMany).toHaveBeenCalledExactlyOnceWith({ where: { userId: "owner", capabilityId: { in: ["enabled", "disabled"] }, status: "active" } });
    expect(database.credential.findMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: ["credential"] }, ownerId: "owner" } });
    await store.readRuntimeSnapshot("owner", ["enabled"]);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("performs no database work when there are no plugins", async () => {
    const transaction = vi.fn();
    const store = new PrismaCredentialStore({ $transaction: transaction } as unknown as PrismaClient);
    await expect(store.readRuntimeSnapshot("owner", [])).resolves.toEqual({ capabilities: [], bindings: [], credentials: [] });
    expect(transaction).not.toHaveBeenCalled();
  });
});
