import { describe, expect, it, vi } from "vitest";

import { Prisma } from "../src/generated/prisma/client.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaFeishuRepository } from "../src/modules/feishu/repository.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000001";
const TURN_ID = "40000000-0000-4000-8000-000000000001";
const FINAL_MESSAGE_ID = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-27T08:00:00.000Z");

const connection = {
  id: CONNECTION_ID,
  ownerId: OWNER_ID,
  appId: "cli_0123456789abcdef",
  ownerOpenId: "ou_owner",
  botName: null,
  domain: "feishu",
  encryptedCredentials: "encrypted",
  encryptionKeyId: "key-id",
  status: "active",
  lastConnectedAt: null,
  lastInboundAt: null,
  lastErrorCode: null,
  lastErrorAt: null,
  nextIngestOrder: BigInt(0),
  createdAt: NOW,
  updatedAt: NOW,
};

describe("PrismaFeishuRepository", () => {
  it("moves a connection requiring reauthorization into disconnecting state", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PrismaFeishuRepository({
      feishuConnection: { updateMany },
    } as unknown as PrismaClient);

    await expect(
      repository.markConnectionDisconnecting(
        OWNER_ID,
        CONNECTION_ID,
        "reauthorization_required",
      ),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: CONNECTION_ID,
        ownerId: OWNER_ID,
        status: "reauthorization_required",
      },
      data: { status: "disconnecting" },
    });
  });

  it("restores the original connection status when disconnect fails", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PrismaFeishuRepository({
      feishuConnection: { updateMany },
    } as unknown as PrismaClient);

    await repository.restoreConnectionStatus(
      OWNER_ID,
      CONNECTION_ID,
      "reauthorization_required",
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: CONNECTION_ID,
        ownerId: OWNER_ID,
        status: "disconnecting",
      },
      data: { status: "reauthorization_required" },
    });
  });

  it("marks an application as awaiting administrator approval", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PrismaFeishuRepository({
      feishuConnection: { updateMany },
    } as unknown as PrismaClient);

    await repository.markApprovalPending(
      CONNECTION_ID,
      "FEISHU_REAUTHORIZATION_REQUIRED",
      NOW,
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: CONNECTION_ID,
        status: { in: ["active", "reauthorization_required"] },
      },
      data: {
        status: "reauthorization_required",
        lastErrorCode: "FEISHU_REAUTHORIZATION_REQUIRED",
        lastErrorAt: NOW,
      },
    });
  });

  it("reactivates an approved application when its websocket connects", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PrismaFeishuRepository({
      feishuConnection: { updateMany },
    } as unknown as PrismaClient);

    await repository.markConnected(CONNECTION_ID, "LinkSense 个人助手", NOW);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: CONNECTION_ID,
        status: { in: ["active", "reauthorization_required"] },
      },
      data: {
        status: "active",
        botName: "LinkSense 个人助手",
        lastConnectedAt: NOW,
        lastErrorCode: null,
        lastErrorAt: null,
      },
    });
  });

  it("keeps the registered app identity when disconnecting LinkSense", async () => {
    const tx = {
      feishuConnection: {
        findFirst: vi.fn(async () => ({ id: CONNECTION_ID })),
        delete: vi.fn(async () => connection),
      },
      feishuOutboundDelivery: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      feishuInboundMessage: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      feishuPeerSession: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      feishuAppBinding: { delete: vi.fn() },
    };
    const repository = new PrismaFeishuRepository({
      $transaction: vi.fn(async (action) => action(tx)),
    } as unknown as PrismaClient);

    await repository.deleteConnection(OWNER_ID, CONNECTION_ID);

    expect(tx.feishuConnection.delete).toHaveBeenCalledWith({
      where: { id: CONNECTION_ID },
    });
    expect(tx.feishuAppBinding.delete).not.toHaveBeenCalled();
  });

  it("stores a reusable non-secret app binding when a connection is created", async () => {
    const created = { ...connection };
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: OWNER_ID }]),
      feishuConnection: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => created),
      },
      feishuAppBinding: { upsert: vi.fn(async () => undefined) },
    };
    const repository = new PrismaFeishuRepository({
      $transaction: vi.fn(async (action) => action(tx)),
    } as unknown as PrismaClient);

    await repository.replaceConnection({
      id: CONNECTION_ID,
      ownerId: OWNER_ID,
      appId: "cli_0123456789abcdef",
      ownerOpenId: "ou_owner",
      domain: "feishu",
      encryptedCredentials: "encrypted-secret",
      encryptionKeyId: "key-id",
    });

    expect(tx.feishuAppBinding.upsert).toHaveBeenCalledWith({
      where: { ownerId: OWNER_ID },
      create: {
        ownerId: OWNER_ID,
        appId: "cli_0123456789abcdef",
        ownerOpenId: "ou_owner",
        domain: "feishu",
      },
      update: {
        appId: "cli_0123456789abcdef",
        ownerOpenId: "ou_owner",
        domain: "feishu",
      },
    });
  });

  it("excludes inactive owners from websocket and durable work", async () => {
    const queryRaw = vi.fn<
      (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<Array<{ id: string }>>
    >(async () => [{ id: CONNECTION_ID }]);
    const prisma = {
      $queryRaw: queryRaw,
      feishuConnection: { findMany: vi.fn(async () => [connection]) },
      user: { findMany: vi.fn(async () => []) },
    };
    const repository = new PrismaFeishuRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(repository.listActiveConnections()).resolves.toEqual([]);
    expect(String(queryRaw.mock.calls[0]?.[0])).toContain(
      "INTERVAL '5 seconds'",
    );
    expect(prisma.feishuConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [CONNECTION_ID] },
          status: { in: ["active", "reauthorization_required"] },
        },
      }),
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [OWNER_ID] }, status: "active" },
      select: { id: true },
    });
  });

  it("persists an inbound message with a monotonic order and duplicate guard", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ ingestOrder: BigInt(5) }]),
      feishuInboundMessage: {
        findUnique: vi.fn(async () => null),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = { $transaction: vi.fn(async (action) => action(tx)) };
    const repository = new PrismaFeishuRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(
      repository.persistInbound({
        id: "30000000-0000-4000-8000-000000000001",
        connectionId: CONNECTION_ID,
        messageKey: "om_message",
        chatId: "oc_chat",
        senderOpenId: "ou_owner",
        contentText: "hello",
        receivedAt: NOW,
      }),
    ).resolves.toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.feishuInboundMessage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          messageKey: "om_message",
          status: "pending",
          ingestOrder: BigInt(5),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("waits for the native final answer projection before delivery", async () => {
    const prisma = {
      conversationTurn: {
        findUnique: vi.fn(async () => ({
          status: "completed",
          errorCode: null,
          collaborationMode: "default",
        })),
      },
      conversationEvent: { findFirst: vi.fn(async () => null) },
    };
    const repository = new PrismaFeishuRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(
      repository.getTurnOutcome(TURN_ID),
    ).resolves.toEqual({ status: "running" });
  });

  it("prefers an explicit native final answer without using the fallback", async () => {
    const findEvent = vi.fn(async () => ({
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
    }));
    const prisma = {
      conversationTurn: {
        findUnique: vi.fn(async () => ({
          status: "completed",
          errorCode: null,
          collaborationMode: "default",
        })),
      },
      conversationEvent: { findFirst: findEvent },
      conversationMessage: {
        findFirst: vi.fn(async () => ({ contentText: "最终结果" })),
      },
    };
    const repository = new PrismaFeishuRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(repository.getTurnOutcome(TURN_ID)).resolves.toEqual({
      status: "completed",
      text: "最终结果",
    });
    expect(findEvent).toHaveBeenCalledTimes(1);
  });

  it("delivers a terminal assistant message when the native phase is null", async () => {
    const findEvent = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
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
              phase: null,
            },
          },
          local: { message_id: FINAL_MESSAGE_ID },
        },
      });
    const findMessage = vi.fn(async () => ({ contentText: "最终结果" }));
    const prisma = {
      conversationTurn: {
        findUnique: vi.fn(async () => ({
          status: "completed",
          errorCode: null,
          collaborationMode: "default",
        })),
      },
      conversationEvent: { findFirst: findEvent },
      conversationMessage: { findFirst: findMessage },
    };
    const repository = new PrismaFeishuRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(repository.getTurnOutcome(TURN_ID)).resolves.toEqual({
      status: "completed",
      text: "最终结果",
    });
    expect(findEvent).toHaveBeenCalledTimes(2);
    expect(findEvent).toHaveBeenNthCalledWith(2, {
      where: {
        turnId: TURN_ID,
        eventType: "item/completed",
        AND: [
          {
            payloadJson: {
              path: ["params", "item", "type"],
              equals: "agentMessage",
            },
          },
          {
            payloadJson: {
              path: ["params", "item", "phase"],
              equals: Prisma.JsonNull,
            },
          },
        ],
      },
      orderBy: [{ sequenceNo: "desc" }, { id: "desc" }],
      select: { payloadJson: true },
    });
    expect(findMessage).toHaveBeenCalledWith({
      where: { id: FINAL_MESSAGE_ID, turnId: TURN_ID, role: "assistant" },
      select: { contentText: true },
    });
  });

  it("never uses a commentary message as the null-phase fallback", async () => {
    const prisma = {
      conversationTurn: {
        findUnique: vi.fn(async () => ({
          status: "completed",
          errorCode: null,
          collaborationMode: "default",
        })),
      },
      conversationEvent: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            payloadJson: {
              schema_version: 2,
              source: "codex_app_server",
              method: "item/completed",
              params: {
                threadId: "codex-thread-1",
                turnId: "codex-turn-1",
                item: {
                  type: "agentMessage",
                  id: "native-commentary-message",
                  text: "处理中",
                  phase: "commentary",
                },
              },
              local: { message_id: FINAL_MESSAGE_ID },
            },
          }),
      },
      conversationMessage: { findFirst: vi.fn() },
    };
    const repository = new PrismaFeishuRepository(
      prisma as unknown as PrismaClient,
    );

    await expect(repository.getTurnOutcome(TURN_ID)).resolves.toEqual({
      status: "running",
    });
    expect(prisma.conversationMessage.findFirst).not.toHaveBeenCalled();
  });
});
