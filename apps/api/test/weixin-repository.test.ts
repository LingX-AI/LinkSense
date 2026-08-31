import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaWeixinRepository } from "../src/modules/weixin/repository.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000001";
const PEER_ID = "30000000-0000-4000-8000-000000000001";
const TURN_ID = "50000000-0000-4000-8000-000000000001";
const FINAL_MESSAGE_ID = "70000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-13T08:00:00.000Z");

const connection = {
  id: CONNECTION_ID,
  ownerId: OWNER_ID,
  applicationId: null,
  applicationName: null,
  ilinkBotId: "bot-id",
  ilinkUserId: "user-id",
  apiBaseUrl: "https://ilinkai.weixin.qq.com",
  encryptedState: "encrypted",
  encryptionKeyId: "key-id",
  status: "active",
  lastPollAt: null,
  lastInboundAt: null,
  lastErrorCode: null,
  lastErrorAt: null,
  nextIngestOrder: 0n,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("PrismaWeixinRepository", () => {
  it("excludes inactive owners from polling and durable work", async () => {
    const inbound = {
      id: "40000000-0000-4000-8000-000000000001",
      connectionId: CONNECTION_ID,
    };
    const prisma = {
      $queryRaw: vi.fn(async () => [{ id: CONNECTION_ID }]),
      weixinConnection: {
        findMany: vi.fn(async () => [connection]),
      },
      weixinInboundMessage: {
        findMany: vi.fn(async () => [inbound]),
      },
      user: {
        findMany: vi.fn(async () => []),
      },
    };
    const repository = new PrismaWeixinRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(repository.listActiveConnections()).resolves.toEqual([]);
    await expect(repository.listPendingInbound(NOW, 20)).resolves.toEqual([]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [OWNER_ID] }, status: "active" },
      select: { id: true },
    });
  });

  it("checks pending delivery state by the unbounded peer session relation", async () => {
    const prisma = {
      weixinPeerSession: {
        findUnique: vi.fn(async () => ({ id: PEER_ID })),
      },
      weixinOutboundDelivery: {
        count: vi.fn(async () => 1),
      },
    };
    const repository = new PrismaWeixinRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(
      repository.hasUnsentDeliveryForPeer(CONNECTION_ID, "wx-user"),
    ).resolves.toBe(true);
    expect(prisma.weixinOutboundDelivery.count).toHaveBeenCalledWith({
      where: {
        connectionId: CONNECTION_ID,
        peerSessionId: PEER_ID,
        status: { in: ["pending", "processing"] },
      },
    });
  });

  it("rejects a stale poll before it can overwrite the cursor or insert messages", async () => {
    const tx = {
      weixinConnection: {
        findUnique: vi.fn(async () => ({
          status: "active",
          encryptedState: "old-state",
          nextIngestOrder: 4n,
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      weixinInboundMessage: {
        createMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (action) => action(tx)),
    };
    const repository = new PrismaWeixinRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(
      repository.persistPoll({
        connectionId: CONNECTION_ID,
        expectedEncryptedState: "old-state",
        encryptedState: "new-state",
        encryptionKeyId: "key-id",
        polledAt: NOW,
        messages: [
          {
            id: "40000000-0000-4000-8000-000000000001",
            peerUserId: "user-id",
            messageKey: "message-key",
            contentText: "hello",
            encryptedContext: "encrypted-context",
            encryptionKeyId: "key-id",
            sourceSequence: 9n,
            receivedAt: NOW,
          },
        ],
      }),
    ).resolves.toBe(false);
    expect(tx.weixinConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ encryptedState: "old-state" }),
      }),
    );
    expect(tx.weixinInboundMessage.createMany).not.toHaveBeenCalled();
  });

  it("only advances delivery progress for the current claim and never regresses", async () => {
    const prisma = {
      weixinOutboundDelivery: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const repository = new PrismaWeixinRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(
      repository.markDeliveryChunkSent(
        "50000000-0000-4000-8000-000000000001",
        "60000000-0000-4000-8000-000000000001",
        3,
      ),
    ).resolves.toBe(true);
    expect(prisma.weixinOutboundDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: "50000000-0000-4000-8000-000000000001",
        status: "processing",
        processingToken: "60000000-0000-4000-8000-000000000001",
        sentChunkCount: { lt: 3 },
      },
      data: { sentChunkCount: 3, lastErrorCode: null },
    });
  });

  it("treats a not-yet-projected accepted turn as still running", async () => {
    const prisma = {
      conversationTurn: {
        findUnique: vi.fn(async () => null),
      },
    };
    const repository = new PrismaWeixinRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(
      repository.getTurnOutcome("50000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({ status: "running" });
  });

  it("waits for the native final answer event after the turn is terminal", async () => {
    const prisma = {
      conversationTurn: {
        findUnique: vi.fn(async () => ({
          status: "completed",
          errorCode: null,
          collaborationMode: "default",
        })),
      },
      conversationEvent: {
        findFirst: vi.fn(async () => null),
      },
      conversationMessage: {
        findFirst: vi.fn(),
      },
    };
    const repository = new PrismaWeixinRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(repository.getTurnOutcome(TURN_ID)).resolves.toEqual({
      status: "running",
    });
    expect(prisma.conversationEvent.findFirst).toHaveBeenCalledWith({
      where: {
        turnId: TURN_ID,
        eventType: "item/completed",
        payloadJson: {
          path: ["params", "item", "phase"],
          equals: "final_answer",
        },
      },
      orderBy: [{ sequenceNo: "desc" }, { id: "desc" }],
      select: { payloadJson: true },
    });
    expect(prisma.conversationMessage.findFirst).not.toHaveBeenCalled();
  });

  it("returns only the native final answer message for Weixin delivery", async () => {
    const prisma = {
      conversationTurn: {
        findUnique: vi.fn(async () => ({
          status: "completed",
          errorCode: null,
          collaborationMode: "default",
        })),
      },
      conversationEvent: {
        findFirst: vi.fn(async () => ({
          payloadJson: {
            schema_version: 2,
            source: "codex_app_server",
            method: "item/completed",
            params: {
              threadId: "codex-thread-1",
              turnId: "codex-turn-1",
              item: {
                type: "agentMessage",
                id: "native-final-message",
                text: "最终结果",
                phase: "final_answer",
              },
            },
            local: { message_id: FINAL_MESSAGE_ID },
          },
        })),
      },
      conversationMessage: {
        findFirst: vi.fn(async (query: { where: unknown }) => {
          expect(query.where).toEqual({
            id: FINAL_MESSAGE_ID,
            turnId: TURN_ID,
            role: "assistant",
          });
          return { contentText: "最终结果" };
        }),
      },
    };
    const repository = new PrismaWeixinRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(repository.getTurnOutcome(TURN_ID)).resolves.toEqual({
      status: "completed",
      text: "最终结果",
    });
  });
});
