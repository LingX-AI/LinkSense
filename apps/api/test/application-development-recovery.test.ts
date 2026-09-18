import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { recoverDetachedDevelopmentTests } from "../src/modules/applications/development-recovery.js";

const { remove } = vi.hoisted(() => ({ remove: vi.fn(async () => {}) }));
vi.mock("../src/modules/conversations/deletion.js", () => ({ deleteConversationWithinTransaction: remove }));
beforeEach(() => vi.clearAllMocks());

function fixture() {
  const tx = {
    $queryRaw: vi.fn(async () => [] as { id: string }[])
      .mockResolvedValueOnce([{ id: "preview" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "session" }]),
    conversationTurn: { count: vi.fn(async () => 0) },
    conversationTurnStartIntent: { count: vi.fn(async () => 0) },
    pendingRequest: { count: vi.fn(async () => 0) },
    automation: { count: vi.fn(async () => 0) },
    application: { updateMany: vi.fn() },
  };
  const db = {
    $queryRaw: vi.fn(async () => [{ id: "preview", ownerId: "owner" }]),
    $transaction: vi.fn(async (action: (client: typeof tx) => Promise<void>) => action(tx)),
  };
  return { tx, run: () => recoverDetachedDevelopmentTests(db as unknown as PrismaClient) };
}

describe("detached development test recovery", () => {
  it("routes an idle orphan through durable deletion and retires only the owned preview", async () => {
    const { tx, run } = fixture();
    await run();
    expect(remove).toHaveBeenCalledWith(tx, "owner", "session", {});
    expect(tx.application.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "preview", ownerId: "owner", developmentOnly: true } }));
  });

  it.each(["locked", "parent"])("does not delete when the preview is %s", async condition => {
    const { tx, run } = fixture();
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce(condition === "locked" ? [] : [{ id: "preview" }])
      .mockResolvedValueOnce([{ id: "live-parent" }]);
    await run();
    expect(remove).not.toHaveBeenCalled();
    expect(tx.application.updateMany).not.toHaveBeenCalled();
  });

  it.each(["conversationTurn", "conversationTurnStartIntent", "pendingRequest", "automation"] as const)("rechecks %s after acquiring the conversation lock", async model => {
    const { tx, run } = fixture();
    tx[model].count.mockResolvedValueOnce(1);
    await run();
    expect(remove).not.toHaveBeenCalled();
  });

  it("propagates deletion failures so the maintenance job records and retries them", async () => {
    const { tx, run } = fixture();
    remove.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(run()).rejects.toThrow("cleanup failed");
    expect(tx.application.updateMany).not.toHaveBeenCalled();
  });
});
