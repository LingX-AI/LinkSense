import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../src/generated/prisma/client.js";
import { deleteApplicationDevelopment } from "../src/modules/applications/development-deletion.js";

const { remove } = vi.hoisted(() => ({ remove: vi.fn(async () => {}) }));
vi.mock("../src/modules/conversations/deletion.js", () => ({ deleteConversationWithinTransaction: remove }));
beforeEach(() => vi.clearAllMocks());
function fixture(applicationId: string | null = null) {
  const db = {
    $queryRaw: vi.fn().mockResolvedValueOnce([{ id: "draft", applicationId, previewApplicationId: "preview" }])
      .mockResolvedValueOnce([{ id: "preview" }]).mockResolvedValueOnce([{ id: "test-a" }, { id: "test-b" }]),
    applicationDevelopment: { delete: vi.fn() }, application: { updateMany: vi.fn() },
    conversationTurn: { count: vi.fn(async () => 0) }, conversationTurnStartIntent: { count: vi.fn(async () => 0) }, pendingRequest: { count: vi.fn(async () => 0) },
  };
  return { db, tx: db as unknown as Prisma.TransactionClient };
}
describe("explicit application deletion", () => {
  it.each([null, "installed"])("removes an application's draft and owned tests through durable deletion (installed: %s)", async applicationId => {
    const { db, tx } = fixture(applicationId);
    await deleteApplicationDevelopment(tx, "owner", applicationId ? { applicationId } : { developmentId: "draft" }, {});
    expect(remove.mock.calls).toEqual([[tx, "owner", "test-a", {}], [tx, "owner", "test-b", {}]]);
    expect(db.applicationDevelopment.delete).toHaveBeenCalledWith({ where: { id: "draft", ownerId: "owner" } });
    expect(db.application.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "preview", ownerId: "owner", developmentOnly: true }, data: expect.objectContaining({ status: "deleted" }) }));
    expect(remove.mock.invocationCallOrder[1]).toBeLessThan(db.applicationDevelopment.delete.mock.invocationCallOrder[0]!);
  });
  it.each(["conversationTurn", "conversationTurnStartIntent", "pendingRequest"] as const)("preserves everything when a test has active %s", async kind => {
    const { db, tx } = fixture(); db[kind].count.mockResolvedValue(1);
    await expect(deleteApplicationDevelopment(tx, "owner", { developmentId: "draft" }, {})).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_TEST_BUSY" });
    expect(remove).not.toHaveBeenCalled(); expect(db.applicationDevelopment.delete).not.toHaveBeenCalled(); expect(db.application.updateMany).not.toHaveBeenCalled();
  });
  it("rejects a draft deleted by another request and scopes lookups to its owner", async () => {
    const { db, tx } = fixture(); db.$queryRaw.mockReset().mockResolvedValue([]);
    await expect(deleteApplicationDevelopment(tx, "other-owner", { developmentId: "draft" }, {})).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_NOT_FOUND" });
    expect(db.$queryRaw.mock.calls[0]?.[0].values).toEqual(["other-owner", "draft"]);
    expect(remove).not.toHaveBeenCalled();
    await expect(deleteApplicationDevelopment(tx, "owner", { applicationId: "ordinary-app" }, {})).resolves.toBeUndefined();
  });
  it("deletes a linked draft and its tests while preserving the published app, including concurrent publication", async () => {
    const { db, tx } = fixture("installed");
    await deleteApplicationDevelopment(tx, "owner", { developmentId: "draft" }, {});
    expect(db.application.updateMany).toHaveBeenCalledTimes(1);
    expect(db.application.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "preview", ownerId: "owner", developmentOnly: true } }));
    expect(remove.mock.calls).toEqual([[tx, "owner", "test-a", {}], [tx, "owner", "test-b", {}]]);
    expect(db.applicationDevelopment.delete).toHaveBeenCalledWith({ where: { id: "draft", ownerId: "owner" } });
  });
  it("propagates cleanup failure so the surrounding transaction rolls back", async () => {
    const { db, tx } = fixture(); remove.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(deleteApplicationDevelopment(tx, "owner", { developmentId: "draft" }, {})).rejects.toThrow("cleanup failed");
    expect(db.applicationDevelopment.delete).not.toHaveBeenCalled();
  });
});
