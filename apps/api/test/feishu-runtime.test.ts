import { describe, expect, it, vi } from "vitest";

import type { ConversationService } from "../src/modules/conversations/service.js";
import {
  FeishuProtocolError,
  type FeishuOfficialClient,
} from "../src/modules/feishu/client.js";
import type { RedisFeishuCoordinator } from "../src/modules/feishu/coordinator.js";
import type { PrismaFeishuRepository } from "../src/modules/feishu/repository.js";
import { FeishuRuntime } from "../src/modules/feishu/runtime.js";
import { encryptFeishuCredentials } from "../src/modules/feishu/state.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000001";
const INBOUND_ID = "30000000-0000-4000-8000-000000000001";
const PEER_ID = "40000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "50000000-0000-4000-8000-000000000001";
const TURN_ID = "60000000-0000-4000-8000-000000000001";
const DELIVERY_ID = "70000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-27T08:00:00.000Z");
const encryption = {
  masterKey: Buffer.alloc(32, 9).toString("base64"),
  keyId: "feishu-runtime-test-key",
};

describe("FeishuRuntime", () => {
  it("keeps an app pending and eligible for automatic recovery while approval is missing", async () => {
    const connection = createConnection();
    const repository = {
      listActiveConnections: vi.fn(async () => [connection]),
      findActiveConnection: vi.fn(async () => connection),
      markApprovalPending: vi.fn(async () => undefined),
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
      connect: vi.fn(async () => {
        throw new FeishuProtocolError("FEISHU_REAUTHORIZATION_REQUIRED");
      }),
    };
    const runtime = new FeishuRuntime(
      repository as never as PrismaFeishuRepository,
      coordinator as never as RedisFeishuCoordinator,
      client as never as FeishuOfficialClient,
      {
        acceptTurn: vi.fn(),
        createOrUpdateDraft: vi.fn(),
      } as never as ConversationService,
      encryption,
      () => NOW,
    );

    await runtime.start();
    await vi.waitFor(() => {
      expect(repository.markApprovalPending).toHaveBeenCalledWith(
        CONNECTION_ID,
        "FEISHU_REAUTHORIZATION_REQUIRED",
        NOW,
      );
    });
    expect(repository.recordConnectionError).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("automatically marks a previously pending application active after approval", async () => {
    const connection = {
      ...createConnection(),
      status: "reauthorization_required",
      lastErrorCode: "FEISHU_REAUTHORIZATION_REQUIRED",
      lastErrorAt: NOW,
    };
    const repository = {
      listActiveConnections: vi.fn(async () => [connection]),
      findActiveConnection: vi.fn(async () => connection),
      markConnected: vi.fn(async () => undefined),
      recordConnectionError: vi.fn(async () => undefined),
      markApprovalPending: vi.fn(async () => undefined),
      listPendingInbound: vi.fn(async () => []),
      listPendingDeliveries: vi.fn(async () => []),
    };
    const coordinator = {
      acquireLease: vi.fn(async () => ({ key: "lease", token: "token" })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const close = vi.fn(async () => undefined);
    const client = {
      connect: vi.fn(async () => ({ botName: "LinkSense 个人助手", close })),
    };
    const runtime = new FeishuRuntime(
      repository as never as PrismaFeishuRepository,
      coordinator as never as RedisFeishuCoordinator,
      client as never as FeishuOfficialClient,
      {
        acceptTurn: vi.fn(),
        createOrUpdateDraft: vi.fn(),
      } as never as ConversationService,
      encryption,
      () => NOW,
    );

    await runtime.start();
    await vi.waitFor(() => {
      expect(repository.markConnected).toHaveBeenCalledWith(
        CONNECTION_ID,
        "LinkSense 个人助手",
        NOW,
      );
    });
    expect(repository.markApprovalPending).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("lets the conversation service own task-start locks for inbound messages", async () => {
    const connection = createConnection();
    const pendingInbound = {
      id: INBOUND_ID,
      connectionId: CONNECTION_ID,
      messageKey: "om_inbound",
      chatId: "oc_chat",
      senderOpenId: "ou_owner",
      contentText: "start this task",
      status: "pending",
      peerSessionId: null,
      conversationId: null,
      turnId: null,
      ingestOrder: BigInt(1),
      processingToken: null,
      errorCode: null,
      attempts: 0,
      nextAttemptAt: NOW,
      processedAt: null,
      receivedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    };
    let inboundAvailable = true;
    const repository = {
      listActiveConnections: vi.fn(async () => [connection]),
      findActiveConnection: vi.fn(async () => connection),
      markConnected: vi.fn(async () => undefined),
      recordConnectionError: vi.fn(async () => undefined),
      listPendingInbound: vi.fn(async () =>
        inboundAvailable ? [{ connection, message: pendingInbound }] : [],
      ),
      listPendingDeliveries: vi.fn(async () => []),
      claimInbound: vi.fn(async (_id, processingToken) => {
        if (!inboundAvailable) return null;
        inboundAvailable = false;
        return {
          ...pendingInbound,
          status: "processing",
          processingToken,
        };
      }),
      hasEarlierPendingMessage: vi.fn(async () => false),
      hasUnsentDeliveryForChat: vi.fn(async () => false),
      findTurnByIdempotencyKey: vi.fn(async () => null),
      findPeerSession: vi.fn(async () => null),
      upsertPeerSession: vi.fn(async (input) => ({
        ...input,
        createdAt: NOW,
        updatedAt: NOW,
      })),
      prepareInbound: vi.fn(async () => true),
      conversationIsBusy: vi.fn(async () => false),
      markInboundAccepted: vi.fn(async () => true),
      markInboundRetry: vi.fn(async () => undefined),
    };
    const client = {
      connect: vi.fn(async () => ({
        botName: "LinkSense 个人助手",
        close: vi.fn(async () => undefined),
      })),
    };
    const coordinator = {
      acquireLease: vi.fn(async (scope) => ({
        key: `${scope}-lease`,
        token: `${scope}-token`,
      })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const conversations = {
      createOrUpdateDraft: vi.fn(async () => ({
        conversation: { id: CONVERSATION_ID },
      })),
      acceptTurn: vi.fn(async () => ({
        accepted: true,
        status: "starting" as const,
        turn_id: TURN_ID,
      })),
    };
    const runtime = new FeishuRuntime(
      repository as never as PrismaFeishuRepository,
      coordinator as never as RedisFeishuCoordinator,
      client as never as FeishuOfficialClient,
      conversations as never as ConversationService,
      encryption,
      () => NOW,
      () => PEER_ID,
    );

    await runtime.start();
    await vi.waitFor(() => {
      expect(conversations.acceptTurn).toHaveBeenCalledWith(
        OWNER_ID,
        CONVERSATION_ID,
        expect.objectContaining({
          inputText: "start this task",
          idempotencyKey: `feishu-inbound:${INBOUND_ID}`,
        }),
        expect.objectContaining({ userAgent: "LinkSense Feishu" }),
      );
      expect(repository.markInboundAccepted).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: INBOUND_ID,
          conversationId: CONVERSATION_ID,
          turnId: TURN_ID,
        }),
      );
    });
    const acquiredScopes = coordinator.acquireLease.mock.calls.map(
      ([scope]) => scope,
    );
    expect(acquiredScopes).not.toContain("user-lifecycle");
    expect(acquiredScopes).not.toContain("conversation");
    await runtime.close();
  });

  it("connects with encrypted credentials, persists inbound messages, and delivers replies", async () => {
    const connection = createConnection();
    const inbound = {
      id: INBOUND_ID,
      connectionId: CONNECTION_ID,
      messageKey: "om_message",
      chatId: "oc_chat",
      senderOpenId: "ou_owner",
      contentText: "hello",
      status: "accepted",
      peerSessionId: PEER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      ingestOrder: BigInt(1),
      processingToken: null,
      errorCode: null,
      attempts: 0,
      nextAttemptAt: NOW,
      processedAt: NOW,
      receivedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const delivery = {
      id: DELIVERY_ID,
      connectionId: CONNECTION_ID,
      peerSessionId: PEER_ID,
      inboundMessageId: INBOUND_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      status: "pending",
      processingToken: null,
      sentChunkCount: 0,
      attempts: 0,
      nextAttemptAt: NOW,
      lastErrorCode: null,
      sentAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    let deliveryAvailable = true;
    let sentChunkCount = 0;
    const repository = {
      listActiveConnections: vi.fn(async () => [connection]),
      findActiveConnection: vi.fn(async () => connection),
      markConnected: vi.fn(async () => undefined),
      recordConnectionError: vi.fn(async () => undefined),
      persistInbound: vi.fn(async () => true),
      listPendingInbound: vi.fn(async () => []),
      listPendingDeliveries: vi.fn(async () =>
        deliveryAvailable ? [{ connection, delivery, inbound }] : [],
      ),
      claimDelivery: vi.fn(async (_id, processingToken) => {
        if (!deliveryAvailable) return null;
        deliveryAvailable = false;
        return { ...delivery, status: "processing", processingToken };
      }),
      getTurnOutcome: vi.fn(async () => ({
        status: "completed" as const,
        text: "Agent reply",
      })),
      getOwnerLocale: vi.fn(async () => "zh-CN" as const),
      findClaimedDelivery: vi.fn(async () => ({
        ...delivery,
        status: "processing",
        processingToken: "delivery-token",
        sentChunkCount,
      })),
      markDeliveryChunkSent: vi.fn(async (_id, _token, count) => {
        sentChunkCount = count;
        return true;
      }),
      markDeliverySent: vi.fn(async () => undefined),
      markDeliveryRetry: vi.fn(async () => undefined),
      deferDelivery: vi.fn(async () => undefined),
    };
    let onInbound: ((message: never) => Promise<void>) | null = null;
    const closeConnection = vi.fn(async () => undefined);
    const client = {
      connect: vi.fn(async (input) => {
        onInbound = input.onMessage;
        return { botName: "LinkSense 个人助手", close: closeConnection };
      }),
      sendText: vi.fn(async () => undefined),
    };
    let leaseSequence = 0;
    const coordinator = {
      acquireLease: vi.fn(async (scope) => ({
        key: `${scope}-${leaseSequence}`,
        token: scope === "delivery" ? "delivery-token" : `token-${leaseSequence++}`,
      })),
      renewLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    };
    const conversations = {
      acceptTurn: vi.fn(),
      createOrUpdateDraft: vi.fn(),
    };
    const runtime = new FeishuRuntime(
      repository as never as PrismaFeishuRepository,
      coordinator as never as RedisFeishuCoordinator,
      client as never as FeishuOfficialClient,
      conversations as never as ConversationService,
      encryption,
      () => NOW,
      () => INBOUND_ID,
    );

    await runtime.start();
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalledTimes(1));
    await (onInbound as unknown as (message: object) => Promise<void>)({
      messageKey: "om_new",
      chatId: "oc_chat",
      senderOpenId: "ou_owner",
      text: "new request",
      receivedAt: NOW,
    });

    await vi.waitFor(() => {
      expect(repository.persistInbound).toHaveBeenCalledWith({
        id: INBOUND_ID,
        connectionId: CONNECTION_ID,
        messageKey: "om_new",
        chatId: "oc_chat",
        senderOpenId: "ou_owner",
        contentText: "new request",
        receivedAt: NOW,
      });
      expect(client.sendText).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: "oc_chat",
          text: "Agent reply",
          credentials: {
            appId: "cli_0123456789abcdef",
            appSecret: "runtime-secret",
            domain: "feishu",
          },
        }),
      );
      expect(repository.markDeliverySent).toHaveBeenCalled();
    });
    await runtime.close();
    expect(closeConnection).toHaveBeenCalledTimes(1);
  });
});

function createConnection() {
  return {
    id: CONNECTION_ID,
    ownerId: OWNER_ID,
    appId: "cli_0123456789abcdef",
    ownerOpenId: "ou_owner",
    botName: null,
    domain: "feishu",
    encryptedCredentials: encryptFeishuCredentials(
      CONNECTION_ID,
      {
        appId: "cli_0123456789abcdef",
        appSecret: "runtime-secret",
        domain: "feishu",
      },
      encryption,
    ),
    encryptionKeyId: encryption.keyId,
    status: "active",
    lastConnectedAt: null,
    lastInboundAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    nextIngestOrder: BigInt(0),
    createdAt: NOW,
    updatedAt: NOW,
  };
}
