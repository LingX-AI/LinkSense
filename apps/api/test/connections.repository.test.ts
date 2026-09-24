import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, UserConnection } from "../src/generated/prisma/client.js";
import {
  PrismaConnectionRepository,
  disconnectedConnection,
} from "../src/modules/connections/repository.js";

const owner = "00000000-0000-4000-8000-000000000001";
const conversation = "00000000-0000-4000-8000-000000000002";
const turn = "00000000-0000-4000-8000-000000000003";

function fixture() {
  const user = { status: "active", role: "user", authValidAfter: new Date(0) };
  const turnRow = { conversationId: conversation, submittedBy: owner, status: "running", collaborationMode: "default" };
  const current: UserConnection = {
    id: turn,
    ownerId: owner,
    provider: "onedrive",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...disconnectedConnection(1),
  };
  const db = {
    user: { findUnique: vi.fn(async (): Promise<typeof user | null> => user) },
    conversation: {
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: conversation })),
    },
    conversationTurn: { findUnique: vi.fn(async (): Promise<typeof turnRow | null> => turnRow) },
    conversationTurnStartIntent: {
      findFirst: vi.fn(async (): Promise<{ projectionTurnId: string; collaborationMode: string } | null> => null),
    },
    applicationExternalSession: {
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
    },
    userConnection: {
      findUnique: vi.fn(async (): Promise<UserConnection | null> => current),
      findMany: vi.fn(async () => [current]),
      upsert: vi.fn(async () => current),
    },
    $executeRaw: vi.fn(async () => 1),
  };
  const transaction = vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
  const repository = new PrismaConnectionRepository({
    ...db,
    $transaction: transaction,
  } as unknown as PrismaClient);
  return { repository, db, transaction, current, turnRow };
}

describe("connection persistence and task authorization", () => {
  it("allows Plan reads but refuses Plan writes both before and after turn projection", async () => {
    const f = fixture();
    f.turnRow.collaborationMode = "plan";
    await f.repository.assertTurn(owner, conversation, turn, false);
    await expect(f.repository.assertTurn(owner, conversation, turn, true)).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
    f.db.conversationTurn.findUnique.mockResolvedValue(null);
    f.db.conversationTurnStartIntent.findFirst.mockResolvedValue({ projectionTurnId: turn, collaborationMode: "plan" });
    await expect(f.repository.assertTurn(owner, conversation, turn, true)).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
    f.db.conversationTurnStartIntent.findFirst.mockResolvedValue({ projectionTurnId: turn, collaborationMode: "default" });
    await f.repository.assertTurn(owner, conversation, turn, true);
  });
  it("exposes connected providers with stored authorization regardless of the retired enable flag", async () => {
    const f = fixture();
    await expect(f.repository.listAvailableProviders(owner)).resolves.toEqual(["onedrive"]);
    expect(f.db.userConnection.findMany).toHaveBeenCalledWith({
      where: { ownerId: owner, status: "connected", encryptedPayload: { not: null } },
      select: { provider: true },
      orderBy: { provider: "asc" },
    });
  });

  it("scopes all account reads to their owner and serializes changes without rewriting identity or timestamps", async () => {
    const f = fixture();
    await f.repository.list(owner);
    await f.repository.get(owner, "onedrive");
    expect(f.db.userConnection.findMany).toHaveBeenCalledWith({
      where: { ownerId: owner },
      orderBy: { provider: "asc" },
    });
    expect(f.db.userConnection.findUnique).toHaveBeenCalledWith({
      where: { ownerId_provider: { ownerId: owner, provider: "onedrive" } },
    });
    await f.repository.mutate(owner, "onedrive", async () => ({ ...f.current, enabled: true }));
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 30_000,
      maxWait: 10_000,
    });
    expect(f.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.db.userConnection.upsert.mock.invocationCallOrder[0]!,
    );
    expect(f.db.userConnection.upsert).toHaveBeenCalledWith({
      where: { ownerId_provider: { ownerId: owner, provider: "onedrive" } },
      create: {
        id: expect.any(String),
        ownerId: owner,
        provider: "onedrive",
        ...disconnectedConnection(1),
        enabled: true,
      },
      update: { ...disconnectedConnection(1), enabled: true },
    });
  });

  it("permits the owner's active turn and an accepted turn awaiting its database projection", async () => {
    const f = fixture();
    await f.repository.assertTurn(owner, conversation, turn);
    expect(f.db.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: conversation, ownerId: owner, archiveStatus: "active" },
      select: { id: true },
    });
    f.db.conversationTurn.findUnique.mockResolvedValue(null);
    f.db.conversationTurnStartIntent.findFirst.mockResolvedValue({ projectionTurnId: turn, collaborationMode: "default" });
    await f.repository.assertTurn(owner, conversation, turn);
    expect(f.db.conversationTurnStartIntent.findFirst).toHaveBeenCalledWith({
      where: {
        projectionTurnId: turn,
        conversationId: conversation,
        ownerId: owner,
        runnerStatus: "runner_succeeded",
      },
      select: { projectionTurnId: true, collaborationMode: true },
    });
  });

  it.each(["completed", "failed", "interrupted"])(
    "rejects a %s turn even with a retained start intent",
    async (status) => {
      const f = fixture();
      f.db.conversationTurn.findUnique.mockResolvedValue({ ...f.turnRow, status });
      f.db.conversationTurnStartIntent.findFirst.mockResolvedValue({ projectionTurnId: turn, collaborationMode: "default" });
      await expect(f.repository.assertTurn(owner, conversation, turn)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    },
  );

  it("rejects another owner's turn, archived tasks, external visitors and disabled users", async () => {
    const f = fixture();
    f.db.conversationTurn.findUnique.mockResolvedValueOnce({
      ...f.turnRow,
      submittedBy: "someone-else",
    });
    await expect(f.repository.assertTurn(owner, conversation, turn)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    f.db.conversation.findFirst.mockResolvedValueOnce(null);
    await expect(f.repository.assertTurn(owner, conversation, turn)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    f.db.applicationExternalSession.findFirst.mockResolvedValueOnce({ id: turn });
    await expect(f.repository.assertTurn(owner, conversation, turn)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    f.db.user.findUnique.mockResolvedValueOnce({
      role: "user",
      status: "disabled",
      authValidAfter: new Date(0),
    });
    await expect(f.repository.assertTurn(owner, conversation, turn)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
