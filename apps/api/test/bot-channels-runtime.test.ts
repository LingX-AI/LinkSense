import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BotChannelConnection,
  BotChannelInboundMessage,
  BotChannelOutboundDelivery,
} from "../src/generated/prisma/client.js";
import { BotChannelRuntime } from "../src/modules/bot-channels/runtime.js";
import type { PrismaBotChannelRepository } from "../src/modules/bot-channels/repository.js";
import type { RedisBotChannelCoordinator } from "../src/modules/bot-channels/coordinator.js";
import {
  encryptChannelCredentials,
  encryptReplyContext,
} from "../src/modules/bot-channels/state.js";
import type { ChannelConnectInput } from "../src/modules/bot-channels/types.js";
import { projectChannelMessage } from "../src/modules/bot-channels/clients/message-projection.js";
import { testCredentials, platformPayload } from "./fixtures/bot-channels.js";

const runtimes: BotChannelRuntime[] = [];
const NOW = new Date("2026-09-06T00:00:00Z");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  vi.useRealTimers();
});
it("rejects a callback after shutdown so the transport cannot acknowledge an unpersisted message", async () => {
  const fixture = harness(testCredentials[1]!);
  await fixture.runtime.start();
  await vi.advanceTimersByTimeAsync(0);
  await fixture.runtime.close();
  await expect(fixture.receive()).rejects.toThrow(
    "BOT_CHANNEL_CONNECTION_FAILED",
  );
  expect(fixture.repository.persistInbound).not.toHaveBeenCalled();
});
describe.each(testCredentials)("$provider runtime", (credentials) => {
  it("accepts a pushed message immediately while the outbound scan is blocked", async () => {
    const fixture = harness(credentials);
    let finish: (() => void) | undefined;
    fixture.repository.listPendingDeliveries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([]);
        }),
    );
    try {
      await fixture.runtime.start();
      await vi.advanceTimersByTimeAsync(0);
      await fixture.receive();
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.conversations.acceptTurn).toHaveBeenCalledOnce();
      expect(fixture.repository.markInboundAccepted).toHaveBeenCalledWith(
        expect.objectContaining({ turnId: "turn" }),
      );
      expect(Date.now()).toBe(NOW.getTime());
    } finally {
      finish?.();
    }
  });
  it("resumes a previously accepted native turn without accepting it a second time", async () => {
    const fixture = harness(credentials);
    fixture.repository.findTurnByIdempotencyKey.mockResolvedValue({
      id: "existing-turn",
    });
    await fixture.runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await fixture.receive();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.conversations.acceptTurn).not.toHaveBeenCalled();
    expect(fixture.repository.markInboundAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: "existing-turn" }),
    );
  });
});
it("renews lifecycle locks during a slow send and stops further chunks if the lock is lost", async () => {
  const fixture = harness(testCredentials[0]!);
  let finish: (() => void) | undefined;
  fixture.send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(undefined);
      }),
  );
  fixture.repository.getTurnOutcome.mockResolvedValue({
    status: "completed",
    text: "a".repeat(3500) + "tail",
  });
  fixture.coordinator.renewLease.mockImplementation(
    async (lease) => !lease.key.startsWith("user-lifecycle"),
  );
  try {
    await fixture.runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await fixture.receive();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.coordinator.renewLease).toHaveBeenCalledWith(
      expect.objectContaining({ key: "user-lifecycle:owner" }),
      30_000,
    );
    finish?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.repository.markDeliverySent).not.toHaveBeenCalled();
  } finally {
    finish?.();
  }
});
it("does not submit a native turn after losing the connection lease during preparation", async () => {
  const fixture = harness(testCredentials[0]!);
  let finish: (() => void) | undefined;
  fixture.repository.conversationIsAvailable.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(true);
      }),
  );
  fixture.coordinator.renewLease.mockImplementation(
    async (lease) => !lease.key.startsWith("connection:"),
  );
  try {
    await fixture.runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await fixture.receive();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(120_000);
    finish?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.conversations.acceptTurn).not.toHaveBeenCalled();
    expect(fixture.repository.markInboundAccepted).not.toHaveBeenCalled();
  } finally {
    finish?.();
  }
});
it("sends a localized failure result only once when a native turn fails", async () => {
  const fixture = harness(testCredentials[0]!);
  fixture.repository.getTurnOutcome.mockResolvedValue({
    status: "failed",
    errorCode: "TURN_FAILED",
  });
  await fixture.runtime.start();
  await vi.advanceTimersByTimeAsync(0);
  await fixture.receive();
  await vi.advanceTimersByTimeAsync(2000);
  expect(fixture.send).toHaveBeenCalledOnce();
  expect(fixture.send.mock.calls[0]?.[1]).toContain("任务");
  expect(fixture.repository.markDeliverySent).toHaveBeenCalledOnce();
});
it("closes a disconnected session and reconnects without restarting the runtime", async () => {
  const fixture = harness(testCredentials[0]!);
  await fixture.runtime.start();
  await vi.advanceTimersByTimeAsync(0);
  fixture.isConnected.mockReturnValueOnce(false);
  fixture.runtime.wake();
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.close).toHaveBeenCalledOnce();
  expect(fixture.client.connect).toHaveBeenCalledTimes(2);
});
function harness(credentials: (typeof testCredentials)[number]) {
  const encryption = {
    masterKey: Buffer.alloc(32, 8).toString("base64"),
    keyId: "test-key",
  };
  const connection: BotChannelConnection = {
    id: "connection",
    ownerId: "owner",
    provider: credentials.provider,
    externalId: "app",
    allowedSenderId: credentials.allowed_sender_id,
    allowGroupMessages: true,
    encryptedCredentials: encryptChannelCredentials(
      "connection",
      credentials,
      encryption,
    ),
    encryptionKeyId: encryption.keyId,
    status: "active",
    lastConnectedAt: NOW,
    lastInboundAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    nextIngestOrder: 0n,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const incoming = projectChannelMessage(
    credentials,
    platformPayload(credentials.provider),
  )!;
  const message: BotChannelInboundMessage = {
    id: "message",
    connectionId: connection.id,
    messageKey: incoming.messageKey,
    chatId: incoming.chatId,
    senderId: incoming.senderId,
    contentText: incoming.text,
    status: "pending",
    peerSessionId: "peer",
    conversationId: "conversation",
    turnId: null,
    ingestOrder: 1n,
    processingToken: null,
    errorCode: null,
    attempts: 0,
    nextAttemptAt: NOW,
    processedAt: null,
    receivedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    encryptedContext: encryptReplyContext(
      "message",
      incoming.context,
      encryption,
    ),
    encryptionKeyId: encryption.keyId,
  };
  const delivery: BotChannelOutboundDelivery = {
    id: "delivery",
    connectionId: connection.id,
    peerSessionId: "peer",
    inboundMessageId: "message",
    conversationId: "conversation",
    turnId: "turn",
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
  let pending = false;
  let outbound = false;
  const repository = {
    listActiveConnections: vi.fn(async () => [connection]),
    findActiveConnection: vi.fn(async () => connection),
    markConnected: vi.fn(async () => undefined),
    recordConnectionError: vi.fn(async () => undefined),
    persistInbound: vi.fn(async () => {
      pending = true;
      return true;
    }),
    listPendingInbound: vi.fn(async () =>
      pending ? [{ connection, message }] : [],
    ),
    claimInbound: vi.fn(async () => {
      if (!pending) return null;
      pending = false;
      return message;
    }),
    hasEarlierPendingMessage: vi.fn(async () => false),
    hasUnsentDeliveryForChat: vi.fn(async () => false),
    conversationIsAvailable: vi.fn(async () => true),
    conversationIsBusy: vi.fn(async () => false),
    findTurnByIdempotencyKey: vi
      .fn<PrismaBotChannelRepository["findTurnByIdempotencyKey"]>()
      .mockResolvedValue(null),
    markInboundAccepted: vi.fn(async () => {
      outbound = true;
    }),
    markInboundRetry: vi.fn(async () => undefined),
    listPendingDeliveries: vi.fn<
      PrismaBotChannelRepository["listPendingDeliveries"]
    >(async (_now, _limit, ids) =>
      outbound && ids.includes(connection.id)
        ? [{ connection, delivery, inbound: message }]
        : [],
    ),
    claimDelivery: vi.fn(async () => {
      if (!outbound) return null;
      outbound = false;
      return delivery;
    }),
    getTurnOutcome: vi
      .fn<PrismaBotChannelRepository["getTurnOutcome"]>()
      .mockResolvedValue({ status: "completed", text: "done" }),
    getOwnerLocale: vi.fn(async () => "zh-CN"),
    findClaimedDelivery: vi.fn(async () => delivery),
    markDeliveryChunkSent: vi.fn(async (_id, _token, count: number) => {
      delivery.sentChunkCount = count;
      return true;
    }),
    markDeliverySent: vi.fn(async () => undefined),
    markDeliveryRetry: vi.fn(async () => undefined),
  };
  const coordinator = {
    acquireLease: vi.fn(async (scope: string, id: string) => ({
      key: `${scope}:${id}`,
      token: "token",
    })),
    renewLease: vi
      .fn<RedisBotChannelCoordinator["renewLease"]>()
      .mockResolvedValue(true),
    releaseLease: vi.fn(async () => undefined),
  };
  const conversations = {
    create: vi.fn(async () => ({ id: "conversation" })),
    acceptTurn: vi.fn(async () => ({ turn_id: "turn" })),
  };
  let input: ChannelConnectInput | undefined;
  const send = vi
    .fn<(context: unknown, text: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const close = vi.fn(async () => undefined);
  const isConnected = vi.fn(() => true);
  const client = {
    connect: vi.fn(async (args: ChannelConnectInput) => {
      input = args;
      return { send, close, isConnected };
    }),
  };
  const runtime = new BotChannelRuntime(
    repository as unknown as PrismaBotChannelRepository,
    coordinator as unknown as RedisBotChannelCoordinator,
    client,
    conversations,
    encryption,
  );
  runtimes.push(runtime);
  return {
    runtime,
    repository,
    coordinator,
    conversations,
    client,
    send,
    close,
    isConnected,
    receive: async () => {
      expect(input).toBeDefined();
      await input!.onMessage(incoming);
    },
  };
}
