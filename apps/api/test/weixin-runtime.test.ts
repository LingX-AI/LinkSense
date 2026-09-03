import { describe, expect, it, vi } from "vitest";

import type { ConversationService } from "../src/modules/conversations/service.js";
import type { RedisWeixinCoordinator } from "../src/modules/weixin/coordinator.js";
import {
  type WeixinIlinkClient,
  WeixinProtocolError,
} from "../src/modules/weixin/protocol.js";
import type { PrismaWeixinRepository } from "../src/modules/weixin/repository.js";
import { WeixinRuntime } from "../src/modules/weixin/runtime.js";
import {
  decryptWeixinConnectionState,
  decryptWeixinContext,
  encryptWeixinConnectionState,
  encryptWeixinContext,
} from "../src/modules/weixin/state.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const PEER_ID = "40000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "50000000-0000-4000-8000-000000000001";
const TURN_ID = "60000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-13T08:00:00.000Z");
const encryption = {
  masterKey: Buffer.alloc(32, 4).toString("base64"),
  keyId: "weixin-runtime-test-key",
};

describe("WeixinRuntime", () => {
  it("persists the next cursor and encrypted direct messages in one poll result", async () => {
    const activeConnection = {
      ...runtimeConnection(),
      encryptedState: encryptWeixinConnectionState(
        CONNECTION_ID,
        { token: "bot-token", cursor: "current-cursor" },
        encryption,
      ),
    };
    const persistPoll = vi.fn<
      (
        input: Parameters<PrismaWeixinRepository["persistPoll"]>[0],
      ) => Promise<boolean>
    >(async () => false);
    const repository = {
      listActiveConnections: vi
        .fn()
        .mockResolvedValueOnce([activeConnection])
        .mockResolvedValue([]),
      findActiveConnection: vi.fn(async () => activeConnection),
      persistPoll,
      recordConnectionError: vi.fn(async () => undefined),
      requireReauthorization: vi.fn(async () => undefined),
      listPendingInbound: vi.fn(async () => []),
      listPendingDeliveries: vi.fn(async () => []),
    };
    const coordinator = {
      acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const client = {
      notifyStart: vi.fn(async () => undefined),
      notifyStop: vi.fn(async () => undefined),
      getUpdates: vi.fn(async () => ({
        cursor: "next-cursor",
        suggestedTimeoutMs: null,
        messages: [
          {
            seq: 7,
            message_id: 41,
            from_user_id: "unauthorized-user",
            message_type: 1,
            context_token: "unauthorized-context",
            create_time_ms: NOW.getTime(),
            item_list: [{ type: 1, text_item: { text: "do not run" } }],
          },
          {
            seq: 8,
            message_id: 42,
            from_user_id: "user-id",
            message_type: 1,
            context_token: "context-token",
            create_time_ms: NOW.getTime(),
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          },
        ],
      })),
    };
    const runtime = new WeixinRuntime(
      repository as unknown as PrismaWeixinRepository,
      coordinator as unknown as RedisWeixinCoordinator,
      client as unknown as WeixinIlinkClient,
      {} as Pick<
        ConversationService,
        | "acceptTurn"
        | "createApplicationConversation"
        | "create"
      >,
      encryption,
      () => NOW,
      () => MESSAGE_ID,
    );

    await runtime.start();
    await vi.waitFor(() => expect(persistPoll).toHaveBeenCalledOnce());
    await runtime.close();

    expect(client.notifyStart).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-token",
      }),
    );
    expect(client.getUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-token",
        cursor: "current-cursor",
      }),
    );
    expect(client.notifyStop).toHaveBeenCalledWith({
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "bot-token",
    });
    const persisted = persistPoll.mock.calls[0]?.[0];
    expect(
      decryptWeixinConnectionState(
        {
          ...activeConnection,
          encryptedState: persisted?.encryptedState ?? "",
          encryptionKeyId: persisted?.encryptionKeyId ?? "",
        },
        encryption,
      ),
    ).toEqual({ token: "bot-token", cursor: "next-cursor" });
    expect(persisted?.messages).toHaveLength(1);
    expect(persisted?.messages[0]).toMatchObject({
      id: MESSAGE_ID,
      peerUserId: "user-id",
      contentText: "hello",
      sourceSequence: 8n,
    });
    expect(persisted?.expectedEncryptedState).toBe(activeConnection.encryptedState);
    expect(
      decryptWeixinContext(
        "inbound",
        MESSAGE_ID,
        persisted?.messages[0]?.encryptedContext ?? "",
        persisted?.messages[0]?.encryptionKeyId ?? "",
        encryption,
      ),
    ).toBe("context-token");
  });

  it("requires reauthorization when long polling reports an expired credential", async () => {
    const activeConnection = {
      ...runtimeConnection(),
      encryptedState: encryptWeixinConnectionState(
        CONNECTION_ID,
        { token: "expired-token", cursor: "cursor" },
        encryption,
      ),
    };
    const requireReauthorization = vi.fn(async () => undefined);
    const repository = {
      listActiveConnections: vi
        .fn()
        .mockResolvedValueOnce([activeConnection])
        .mockResolvedValue([]),
      findActiveConnection: vi.fn(async () => activeConnection),
      requireReauthorization,
      recordConnectionError: vi.fn(async () => undefined),
      listPendingInbound: vi.fn(async () => []),
      listPendingDeliveries: vi.fn(async () => []),
    };
    const coordinator = {
      acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const client = {
      notifyStart: vi.fn(async () => undefined),
      notifyStop: vi.fn(async () => undefined),
      getUpdates: vi.fn(async () => {
        throw new WeixinProtocolError("WEIXIN_CREDENTIAL_EXPIRED");
      }),
    };
    const runtime = new WeixinRuntime(
      repository as unknown as PrismaWeixinRepository,
      coordinator as unknown as RedisWeixinCoordinator,
      client as unknown as WeixinIlinkClient,
      {} as Pick<
        ConversationService,
        | "acceptTurn"
        | "createApplicationConversation"
        | "create"
      >,
      encryption,
      () => NOW,
    );

    await runtime.start();
    await vi.waitFor(() =>
      expect(requireReauthorization).toHaveBeenCalledWith(CONNECTION_ID, NOW),
    );
    await runtime.close();
  });

  it("recovers a prepared inbound message in its original conversation", async () => {
    const connection = runtimeConnection();
    const message = {
      id: MESSAGE_ID,
      connectionId: CONNECTION_ID,
      peerUserId: "user-id",
      messageKey: "message-key",
      contentText: "continue",
      encryptedContext: "encrypted-context",
      encryptionKeyId: encryption.keyId,
      status: "processing",
      peerSessionId: PEER_ID,
      conversationId: CONVERSATION_ID,
      turnId: null,
      sourceSequence: 1n,
      ingestOrder: 1n,
      processingToken: "old-token",
      errorCode: null,
      attempts: 1,
      nextAttemptAt: NOW,
      processedAt: null,
      receivedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const markInboundAccepted = vi.fn(async () => undefined);
    const repository = {
      listActiveConnections: vi.fn(async () => []),
      listPendingInbound: vi
        .fn()
        .mockResolvedValueOnce([{ connection, message }])
        .mockResolvedValue([]),
      listPendingDeliveries: vi.fn(async () => []),
      claimInbound: vi.fn(async () => ({
        ...message,
        processingToken: "token",
      })),
      findActiveConnection: vi.fn(async () => connection),
      hasEarlierPendingMessage: vi.fn(async () => false),
      hasUnsentDeliveryForPeer: vi.fn(async () => false),
      findTurnByIdempotencyKey: vi.fn(async () => ({ id: TURN_ID })),
      markInboundAccepted,
      markInboundRetry: vi.fn(async () => undefined),
      markInboundFailed: vi.fn(async () => undefined),
    };
    const coordinator = {
      acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const conversations = {
      create: vi.fn(),
      createApplicationConversation: vi.fn(),
      acceptTurn: vi.fn(),
    };
    const runtime = new WeixinRuntime(
      repository as unknown as PrismaWeixinRepository,
      coordinator as unknown as RedisWeixinCoordinator,
      {} as WeixinIlinkClient,
      conversations as unknown as Pick<
        ConversationService,
        | "acceptTurn"
        | "createApplicationConversation"
        | "create"
      >,
      encryption,
      () => NOW,
    );

    await runtime.start();
    await vi.waitFor(() => expect(markInboundAccepted).toHaveBeenCalledOnce());
    await runtime.close();

    expect(repository.findTurnByIdempotencyKey).toHaveBeenCalledWith(
      CONVERSATION_ID,
      `weixin-inbound:${MESSAGE_ID}`,
    );
    expect(conversations.create).not.toHaveBeenCalled();
    expect(conversations.createApplicationConversation).not.toHaveBeenCalled();
    expect(conversations.acceptTurn).not.toHaveBeenCalled();
    expect(markInboundAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: MESSAGE_ID,
        processingToken: "token",
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
      }),
    );
  });

  it("accepts a durable inbound message through ConversationService exactly once", async () => {
    const context = encryptWeixinContext(
      "inbound",
      MESSAGE_ID,
      "context-token",
      encryption,
    );
    const connection = {
      id: CONNECTION_ID,
      ownerId: OWNER_ID,
      applicationId: "70000000-0000-4000-8000-000000000001",
      applicationName: "Legacy support app",
      ilinkBotId: "bot-id",
      ilinkUserId: "user-id",
      apiBaseUrl: "https://ilinkai.weixin.qq.com",
      encryptedState: encryptWeixinConnectionState(
        CONNECTION_ID,
        { token: "bot-token", cursor: "cursor" },
        encryption,
      ),
      encryptionKeyId: encryption.keyId,
      status: "active",
      lastPollAt: null,
      lastInboundAt: NOW,
      lastErrorCode: null,
      lastErrorAt: null,
      nextIngestOrder: 0n,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const message = {
      id: MESSAGE_ID,
      connectionId: CONNECTION_ID,
      peerUserId: "user-id",
      messageKey: "message-key",
      contentText: "请总结今天的任务",
      encryptedContext: context,
      encryptionKeyId: encryption.keyId,
      status: "pending",
      peerSessionId: null,
      conversationId: null,
      turnId: null,
      sourceSequence: 1n,
      ingestOrder: 1n,
      processingToken: null,
      errorCode: null,
      attempts: 0,
      nextAttemptAt: NOW,
      processedAt: null,
      receivedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const markInboundAccepted = vi.fn(async () => true);
    const createId = vi.fn(() => "40000000-0000-4000-8000-000000000099");
    const repository = {
      listActiveConnections: vi.fn(async () => []),
      listPendingInbound: vi
        .fn()
        .mockResolvedValueOnce([{ connection, message }])
        .mockResolvedValue([]),
      listPendingDeliveries: vi.fn(async () => []),
      findActiveConnection: vi.fn(async () => connection),
      claimInbound: vi.fn(async () => ({
        ...message,
        status: "processing",
        processingToken: "token",
      })),
      hasEarlierPendingMessage: vi.fn(async () => false),
      hasUnsentDeliveryForPeer: vi.fn(async () => false),
      findPeerSession: vi.fn(async () => ({
        id: PEER_ID,
        connectionId: CONNECTION_ID,
        peerUserId: "user-id",
        conversationId: "50000000-0000-4000-8000-000000000099",
        applicationIdSnapshot: null,
        encryptedContext: context,
        encryptionKeyId: encryption.keyId,
        lastInboundAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })),
      conversationIsAvailable: vi.fn(async () => false),
      upsertPeerSession: vi.fn(async (input: Record<string, unknown>) => ({
        ...input,
        id: PEER_ID,
        createdAt: NOW,
        updatedAt: NOW,
      })),
      findTurnByIdempotencyKey: vi.fn(async () => null),
      conversationIsBusy: vi.fn(async () => false),
      prepareInbound: vi.fn(async () => true),
      markInboundAccepted,
      markInboundRetry: vi.fn(async () => undefined),
      markInboundFailed: vi.fn(async () => undefined),
    };
    const coordinator = {
      acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const conversations = {
      create: vi.fn(async () => ({ id: CONVERSATION_ID })),
      createApplicationConversation: vi.fn(),
      acceptTurn: vi.fn(async () => ({
        turn_id: TURN_ID,
        accepted: true as const,
        status: "starting" as const,
      })),
    };
    const sendTyping = vi.fn<WeixinIlinkClient["sendTyping"]>(
      async () => undefined,
    );
    const client = {
      getConfig: vi.fn<WeixinIlinkClient["getConfig"]>(async () => ({
        typingTicket: "typing-ticket",
      })),
      sendTyping,
      sendText: vi.fn(async () => undefined),
    };
    const runtime = new WeixinRuntime(
      repository as unknown as PrismaWeixinRepository,
      coordinator as unknown as RedisWeixinCoordinator,
      client as unknown as WeixinIlinkClient,
      conversations as unknown as Pick<
        ConversationService,
        | "acceptTurn"
        | "createApplicationConversation"
        | "create"
      >,
      encryption,
      () => NOW,
      createId,
    );

    await runtime.start();
    await vi.waitFor(() => expect(markInboundAccepted).toHaveBeenCalledTimes(1));
    await runtime.close();

    expect(conversations.create).toHaveBeenCalledWith(OWNER_ID, {
      collaborationMode: "default",
    });
    expect(conversations.createApplicationConversation).not.toHaveBeenCalled();
    expect(repository.conversationIsAvailable).toHaveBeenCalledWith(
      OWNER_ID,
      "50000000-0000-4000-8000-000000000099",
    );
    expect(repository.upsertPeerSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: PEER_ID, applicationIdSnapshot: null }),
    );
    expect(createId).not.toHaveBeenCalled();
    expect(conversations.acceptTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.objectContaining({
        inputText: "请总结今天的任务",
        idempotencyKey: `weixin-inbound:${MESSAGE_ID}`,
        preserveStagedAttachments: true,
      }),
      expect.objectContaining({ userAgent: "LinkSense Weixin" }),
    );
    expect(markInboundAccepted).toHaveBeenCalledWith({
      messageId: MESSAGE_ID,
      processingToken: "token",
      connectionId: CONNECTION_ID,
      peerSessionId: PEER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      processedAt: NOW,
    });
    expect(client.getConfig).toHaveBeenCalledWith({
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "bot-token",
      ilinkUserId: "user-id",
      contextToken: "context-token",
    });
    expect(client.sendTyping).toHaveBeenCalledWith({
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "bot-token",
      ilinkUserId: "user-id",
      typingTicket: "typing-ticket",
      status: "typing",
    });
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("defers blocked queue heads so later work is not starved", async () => {
    const deferInbound = vi.fn(async () => undefined);
    const deferDelivery = vi.fn(async () => undefined);
    const connection = { id: CONNECTION_ID, ownerId: OWNER_ID };
    const message = {
      id: MESSAGE_ID,
      connectionId: CONNECTION_ID,
      peerUserId: "wx-user",
      attempts: 0,
      ingestOrder: 1n,
    };
    const delivery = {
      id: "70000000-0000-4000-8000-000000000001",
      turnId: TURN_ID,
      attempts: 0,
    };
    const repository = {
      listActiveConnections: vi.fn(async () => []),
      listPendingInbound: vi
        .fn()
        .mockResolvedValueOnce([{ connection, message }])
        .mockResolvedValue([]),
      listPendingDeliveries: vi
        .fn()
        .mockResolvedValueOnce([{ connection, delivery, inbound: message }])
        .mockResolvedValue([]),
      findActiveConnection: vi.fn(async () => connection),
      claimInbound: vi.fn(async () => ({
        ...message,
        status: "processing",
        processingToken: "token",
      })),
      claimDelivery: vi.fn(async () => ({
        ...delivery,
        status: "processing",
        processingToken: "token",
      })),
      hasEarlierPendingMessage: vi.fn(async () => true),
      deferInbound,
      getTurnOutcome: vi.fn(async () => ({ status: "running" as const })),
      deferDelivery,
    };
    const coordinator = {
      acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const runtime = new WeixinRuntime(
      repository as unknown as PrismaWeixinRepository,
      coordinator as unknown as RedisWeixinCoordinator,
      {} as WeixinIlinkClient,
      {} as Pick<
        ConversationService,
        | "acceptTurn"
        | "createApplicationConversation"
        | "create"
      >,
      encryption,
      () => NOW,
    );

    await runtime.start();
    await vi.waitFor(() => {
      expect(deferInbound).toHaveBeenCalledWith(
        MESSAGE_ID,
        "token",
        new Date("2026-08-13T08:00:01.000Z"),
      );
      expect(deferDelivery).toHaveBeenCalledWith(
        delivery.id,
        "token",
        new Date("2026-08-13T08:00:01.000Z"),
      );
    });
    await runtime.close();
  });

  it("resumes a chunked final reply after the last confirmed chunk", async () => {
    const activeConnection = {
      ...runtimeConnection(),
      encryptedState: encryptWeixinConnectionState(
        CONNECTION_ID,
        { token: "bot-token", cursor: "cursor" },
        encryption,
      ),
    };
    const inbound = {
      id: MESSAGE_ID,
      peerUserId: "user-id",
      encryptedContext: encryptWeixinContext(
        "inbound",
        MESSAGE_ID,
        "context-token",
        encryption,
      ),
      encryptionKeyId: encryption.keyId,
    };
    const delivery = {
      id: "70000000-0000-4000-8000-000000000001",
      turnId: TURN_ID,
      conversationId: CONVERSATION_ID,
      sentChunkCount: 1,
      attempts: 0,
    };
    const markDeliveryChunkSent = vi.fn(async () => true);
    const markDeliverySent = vi.fn(async () => undefined);
    const repository = {
      listActiveConnections: vi.fn(async () => []),
      listPendingInbound: vi.fn(async () => []),
      listPendingDeliveries: vi
        .fn()
        .mockResolvedValueOnce([
          { connection: activeConnection, delivery, inbound },
        ])
        .mockResolvedValue([]),
      findActiveConnection: vi.fn(async () => activeConnection),
      claimDelivery: vi.fn(async () => ({
        ...delivery,
        status: "processing",
        processingToken: "token",
      })),
      findClaimedDelivery: vi.fn(async () => ({
        ...delivery,
        status: "processing",
        processingToken: "token",
      })),
      getTurnOutcome: vi.fn(async () => ({
        status: "completed" as const,
        text: "a".repeat(4_001),
      })),
      getOwnerLocale: vi.fn(async () => "zh-CN" as const),
      markDeliveryChunkSent,
      markDeliverySent,
      markDeliveryRetry: vi.fn(async () => undefined),
      requireReauthorization: vi.fn(async () => undefined),
    };
    const coordinator = {
      acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const client = {
      sendText: vi.fn(async () => undefined),
      sendTyping: vi.fn(async () => undefined),
    };
    const runtime = new WeixinRuntime(
      repository as unknown as PrismaWeixinRepository,
      coordinator as unknown as RedisWeixinCoordinator,
      client as unknown as WeixinIlinkClient,
      {} as Pick<
        ConversationService,
        | "acceptTurn"
        | "createApplicationConversation"
        | "create"
      >,
      encryption,
      () => NOW,
    );

    await runtime.start();
    await vi.waitFor(() => expect(markDeliverySent).toHaveBeenCalledOnce());
    await runtime.close();

    expect(client.sendText).toHaveBeenCalledOnce();
    expect(client.sendText).toHaveBeenCalledWith({
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "bot-token",
      toUserId: "user-id",
      contextToken: "context-token",
      text: "a",
      clientId: `linksense-${delivery.id}-1`,
    });
    expect(markDeliveryChunkSent).toHaveBeenCalledWith(
      delivery.id,
      "token",
      2,
    );
    expect(markDeliverySent).toHaveBeenCalledWith(delivery.id, "token", NOW);
  });

  it("keeps the final response within the context-token message limit", async () => {
    const activeConnection = {
      ...runtimeConnection(),
      encryptedState: encryptWeixinConnectionState(
        CONNECTION_ID,
        { token: "bot-token", cursor: "cursor" },
        encryption,
      ),
    };
    const inbound = {
      id: MESSAGE_ID,
      peerUserId: "user-id",
      encryptedContext: encryptWeixinContext(
        "inbound",
        MESSAGE_ID,
        "context-token",
        encryption,
      ),
      encryptionKeyId: encryption.keyId,
    };
    const delivery = {
      id: "70000000-0000-4000-8000-000000000009",
      turnId: TURN_ID,
      conversationId: CONVERSATION_ID,
      sentChunkCount: 0,
      attempts: 0,
    };
    let sentChunkCount = 0;
    const sendText = vi.fn<WeixinIlinkClient["sendText"]>(
      async () => undefined,
    );
    const repository = {
      listActiveConnections: vi.fn(async () => []),
      listPendingInbound: vi.fn(async () => []),
      listPendingDeliveries: vi
        .fn()
        .mockResolvedValueOnce([
          { connection: activeConnection, delivery, inbound },
        ])
        .mockResolvedValue([]),
      findActiveConnection: vi.fn(async () => activeConnection),
      claimDelivery: vi.fn(async () => ({
        ...delivery,
        status: "processing",
        processingToken: "token",
      })),
      findClaimedDelivery: vi.fn(async () => ({
        ...delivery,
        status: "processing",
        processingToken: "token",
        sentChunkCount,
      })),
      getTurnOutcome: vi.fn(async () => ({
        status: "completed" as const,
        text: "a".repeat(40_001),
      })),
      getOwnerLocale: vi.fn(async () => "zh-CN" as const),
      markDeliveryChunkSent: vi.fn(async (_deliveryId, _token, count) => {
        sentChunkCount = count;
        return true;
      }),
      markDeliverySent: vi.fn(async () => undefined),
      markDeliveryRetry: vi.fn(async () => undefined),
      requireReauthorization: vi.fn(async () => undefined),
    };
    const coordinator = {
      acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const client = {
      sendText,
      sendTyping: vi.fn(async () => undefined),
    };
    const runtime = new WeixinRuntime(
      repository as unknown as PrismaWeixinRepository,
      coordinator as unknown as RedisWeixinCoordinator,
      client as unknown as WeixinIlinkClient,
      {} as Pick<
        ConversationService,
        | "acceptTurn"
        | "createApplicationConversation"
        | "create"
      >,
      encryption,
      () => NOW,
    );

    await runtime.start();
    await vi.waitFor(() => expect(repository.markDeliverySent).toHaveBeenCalled());
    await runtime.close();

    expect(sendText).toHaveBeenCalledTimes(10);
    expect(sendText.mock.calls[9]?.[0]).toMatchObject({
      text: "回复内容较长，剩余内容请在 LinkSense 任务中查看。",
    });
  });

  it("uses native typing while waiting and cancels it after the final reply", async () => {
    const activeConnection = {
      ...runtimeConnection(),
      encryptedState: encryptWeixinConnectionState(
        CONNECTION_ID,
        { token: "bot-token", cursor: "cursor" },
        encryption,
      ),
    };
    const inbound = {
      id: MESSAGE_ID,
      peerUserId: "user-id",
      encryptedContext: encryptWeixinContext(
        "inbound",
        MESSAGE_ID,
        "context-token",
        encryption,
      ),
      encryptionKeyId: encryption.keyId,
    };
    const delivery = {
      id: "70000000-0000-4000-8000-000000000010",
      turnId: TURN_ID,
      conversationId: CONVERSATION_ID,
      sentChunkCount: 0,
      attempts: 0,
    };
    let deliveryClaim = 0;
    const repository = {
      listActiveConnections: vi.fn(async () => []),
      listPendingInbound: vi.fn(async () => []),
      listPendingDeliveries: vi
        .fn()
        .mockResolvedValueOnce([
          { connection: activeConnection, delivery, inbound },
        ])
        .mockResolvedValueOnce([
          { connection: activeConnection, delivery, inbound },
        ])
        .mockResolvedValue([]),
      findActiveConnection: vi.fn(async () => activeConnection),
      claimDelivery: vi.fn(async () => {
        deliveryClaim += 1;
        return {
          ...delivery,
          status: "processing",
          processingToken: `token-${deliveryClaim}`,
        };
      }),
      findClaimedDelivery: vi.fn(async () => ({
        ...delivery,
        status: "processing",
        processingToken: `token-${deliveryClaim}`,
        sentChunkCount: 0,
      })),
      getTurnOutcome: vi
        .fn()
        .mockResolvedValueOnce({ status: "running" as const })
        .mockResolvedValue({ status: "completed" as const, text: "done" }),
      getOwnerLocale: vi.fn(async () => "zh-CN" as const),
      deferDelivery: vi.fn(async () => undefined),
      markDeliveryChunkSent: vi.fn(async () => true),
      markDeliverySent: vi.fn(async () => undefined),
      markDeliveryRetry: vi.fn(async () => undefined),
      requireReauthorization: vi.fn(async () => undefined),
    };
    const coordinator = {
      acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const sendTyping = vi.fn<WeixinIlinkClient["sendTyping"]>(
      async () => undefined,
    );
    const client = {
      getConfig: vi.fn<WeixinIlinkClient["getConfig"]>(async () => ({
        typingTicket: "typing-ticket",
      })),
      sendTyping,
      sendText: vi.fn(async () => undefined),
    };
    const runtime = new WeixinRuntime(
      repository as unknown as PrismaWeixinRepository,
      coordinator as unknown as RedisWeixinCoordinator,
      client as unknown as WeixinIlinkClient,
      {} as Pick<
        ConversationService,
        | "acceptTurn"
        | "createApplicationConversation"
        | "create"
      >,
      encryption,
      () => NOW,
    );

    await runtime.start();
    await vi.waitFor(() =>
      expect(client.sendTyping).toHaveBeenCalledWith(
        expect.objectContaining({ status: "typing" }),
      ),
    );
    expect(client.sendText).not.toHaveBeenCalled();
    runtime.wake();
    await vi.waitFor(() => expect(client.sendText).toHaveBeenCalledOnce());
    await runtime.close();

    expect(client.getConfig).toHaveBeenCalledTimes(1);
    expect(client.getConfig).toHaveBeenCalledWith({
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "bot-token",
      ilinkUserId: "user-id",
      contextToken: "context-token",
    });
    expect(sendTyping.mock.calls.map(([input]) => input.status)).toEqual([
      "typing",
      "cancel",
    ]);
    expect(sendTyping.mock.invocationCallOrder[1] ?? 0).toBeGreaterThan(
      client.sendText.mock.invocationCallOrder[0] ?? 0,
    );
    expect(client.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "done",
        toUserId: "user-id",
        contextToken: "context-token",
      }),
    );
  });

  it("waits for an active durable work sweep before closing", async () => {
    let releaseMessages: ((messages: []) => void) | undefined;
    const pendingMessages = new Promise<[]>((resolve) => {
      releaseMessages = resolve;
    });
    const repository = {
      listActiveConnections: vi.fn(async () => []),
      listPendingInbound: vi.fn(() => pendingMessages),
      listPendingDeliveries: vi.fn(async () => []),
    };
    const runtime = new WeixinRuntime(
      repository as unknown as PrismaWeixinRepository,
      {} as RedisWeixinCoordinator,
      {} as WeixinIlinkClient,
      {} as Pick<
        ConversationService,
        | "acceptTurn"
        | "createApplicationConversation"
        | "create"
      >,
      encryption,
      () => NOW,
    );

    await runtime.start();
    await vi.waitFor(() =>
      expect(repository.listPendingInbound).toHaveBeenCalledOnce(),
    );
    const closing = runtime.close();
    const closedEarly = await Promise.race([
      closing.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
    ]);

    expect(closedEarly).toBe(false);
    releaseMessages?.([]);
    await closing;
  });
});

function runtimeConnection() {
  return {
    id: CONNECTION_ID,
    ownerId: OWNER_ID,
    applicationId: null,
    applicationName: null,
    ilinkBotId: "bot-id",
    ilinkUserId: "user-id",
    apiBaseUrl: "https://ilinkai.weixin.qq.com",
    encryptedState: "placeholder",
    encryptionKeyId: encryption.keyId,
    status: "active",
    lastPollAt: null,
    lastInboundAt: NOW,
    lastErrorCode: null,
    lastErrorAt: null,
    nextIngestOrder: 0n,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
