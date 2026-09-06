import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationService } from "../src/modules/conversations/service.js";
import type { RedisWeixinCoordinator } from "../src/modules/weixin/coordinator.js";
import {
  WeixinProtocolError,
  type WeixinIlinkClient,
} from "../src/modules/weixin/protocol.js";
import type {
  PendingWeixinDelivery,
  PrismaWeixinRepository,
  WeixinTurnOutcome,
} from "../src/modules/weixin/repository.js";
import { WeixinRuntime } from "../src/modules/weixin/runtime.js";
import {
  encryptWeixinConnectionState,
  encryptWeixinContext,
} from "../src/modules/weixin/state.js";

const NOW = new Date("2026-09-06T02:14:00.000Z");
const runtimes: WeixinRuntime[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  vi.useRealTimers();
});

describe("Weixin typing lifecycle", () => {
  it("does not send a queued keepalive after the final reply and cancellation", async () => {
    const harness = createHarness();
    const runtime = harness.createRuntime();
    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.typingStatuses()).toEqual(["typing"]);

    harness.state.available = false;
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquireLease =
      harness.coordinator.acquireLease.getMockImplementation();
    harness.coordinator.acquireLease.mockImplementationOnce(async (...args) => {
      await waiting;
      return acquireLease?.(...args) ?? null;
    });
    try {
      await vi.advanceTimersByTimeAsync(5_000);
      harness.state.outcome = { status: "completed", text: "done" };
      harness.state.available = true;
      runtime.wake();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.client.sendText).toHaveBeenCalledOnce();
      expect(harness.typingStatuses()).toEqual(["typing", "cancel"]);
    } finally {
      release?.();
      await vi.advanceTimersByTimeAsync(0);
    }

    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.typingStatuses()).toEqual(["typing", "cancel"]);
  });

  it.each<WeixinTurnOutcome>([
    { status: "completed", text: "done" },
    { status: "failed", errorCode: "TURN_FAILED" },
  ])(
    "cancels $status replies delivered by another runtime and stops the old keepalive",
    async (outcome) => {
      const harness = createHarness();
      const firstRuntime = harness.createRuntime();
      await firstRuntime.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.typingStatuses()).toEqual(["typing"]);

      harness.state.outcome = outcome;
      harness.item.delivery.nextAttemptAt = new Date();
      const secondRuntime = harness.createRuntime();
      await secondRuntime.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(harness.client.sendText).toHaveBeenCalledOnce();
      expect(harness.repository.markDeliverySent).toHaveBeenCalledOnce();
      expect(harness.typingStatuses()).toEqual(["typing", "cancel"]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(harness.typingStatuses()).toEqual(["typing", "cancel"]);
    },
  );

  it("retries failed cancellation without sending the reply text twice", async () => {
    const harness = createHarness();
    const runtime = harness.createRuntime();
    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    harness.state.outcome = { status: "completed", text: "done" };
    harness.client.sendTyping.mockRejectedValueOnce(new Error("timeout"));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.client.sendText).toHaveBeenCalledOnce();
    expect(harness.repository.markDeliveryRetry).toHaveBeenCalledOnce();
    expect(harness.repository.markDeliverySent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(harness.typingStatuses()).toEqual(["typing", "cancel", "cancel"]);
    expect(harness.client.sendText).toHaveBeenCalledOnce();
    expect(harness.repository.markDeliverySent).toHaveBeenCalledOnce();
  });

  it("retries ticket lookup after worker handoff without sending the reply twice", async () => {
    const harness = createHarness();
    harness.state.outcome = { status: "completed", text: "done" };
    harness.client.getConfig.mockRejectedValueOnce(new Error("timeout"));
    const runtime = harness.createRuntime();
    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.client.sendText).toHaveBeenCalledOnce();
    expect(harness.repository.markDeliverySent).not.toHaveBeenCalled();
    expect(harness.repository.markDeliveryRetry).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(harness.client.sendText).toHaveBeenCalledOnce();
    expect(harness.typingStatuses()).toEqual(["cancel"]);
    expect(harness.repository.markDeliverySent).toHaveBeenCalledOnce();
  });

  it("preserves a reply credential error when cancellation also fails", async () => {
    const harness = createHarness();
    harness.state.outcome = { status: "completed", text: "done" };
    harness.client.sendText.mockRejectedValueOnce(
      new WeixinProtocolError("WEIXIN_CREDENTIAL_EXPIRED"),
    );
    harness.client.sendTyping.mockRejectedValueOnce(new Error("timeout"));
    const runtime = harness.createRuntime();
    await runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.typingStatuses()).toEqual(["cancel"]);
    expect(harness.repository.requireReauthorization).toHaveBeenCalledWith(
      harness.item.connection.id,
      NOW,
    );
    expect(harness.repository.markDeliveryRetry).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "WEIXIN_CREDENTIAL_EXPIRED" }),
    );
    expect(harness.repository.markDeliverySent).not.toHaveBeenCalled();
  });

  it("does not cancel a completed turn again when its original worker shuts down", async () => {
    const harness = createHarness();
    const firstRuntime = harness.createRuntime();
    await firstRuntime.start();
    await vi.advanceTimersByTimeAsync(0);
    harness.state.outcome = { status: "completed", text: "done" };
    harness.item.delivery.nextAttemptAt = new Date();
    await harness.createRuntime().start();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.typingStatuses()).toEqual(["typing", "cancel"]);

    await firstRuntime.close();
    expect(harness.typingStatuses()).toEqual(["typing", "cancel"]);
  });

  it("keeps typing during a running turn and cancels before runtime shutdown completes", async () => {
    const harness = createHarness();
    const runtime = harness.createRuntime();
    await runtime.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.typingStatuses()).toEqual(["typing", "typing", "typing"]);
    expect(harness.client.sendText).not.toHaveBeenCalled();

    await runtime.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.typingStatuses()).toEqual([
      "typing",
      "typing",
      "typing",
      "cancel",
    ]);
  });
});

function createHarness() {
  const encryption = {
    masterKey: Buffer.alloc(32, 4).toString("base64"),
    keyId: "typing-test-key",
  };
  const item: PendingWeixinDelivery = {
    connection: {
      id: "20000000-0000-4000-8000-000000000001",
      ownerId: "10000000-0000-4000-8000-000000000001",
      applicationId: null,
      applicationName: null,
      ilinkBotId: "bot-id",
      ilinkUserId: "user-id",
      apiBaseUrl: "https://ilinkai.weixin.qq.com",
      encryptedState: encryptWeixinConnectionState(
        "20000000-0000-4000-8000-000000000001",
        { token: "bot-token", cursor: "cursor" },
        encryption,
      ),
      encryptionKeyId: encryption.keyId,
      status: "active",
      lastPollAt: null,
      lastInboundAt: NOW,
      lastErrorCode: null,
      lastErrorAt: null,
      nextIngestOrder: 1n,
      createdAt: NOW,
      updatedAt: NOW,
    },
    inbound: {
      id: "30000000-0000-4000-8000-000000000001",
      connectionId: "20000000-0000-4000-8000-000000000001",
      peerUserId: "user-id",
      messageKey: "message-key",
      contentText: "hello",
      encryptedContext: encryptWeixinContext(
        "inbound",
        "30000000-0000-4000-8000-000000000001",
        "context-token",
        encryption,
      ),
      encryptionKeyId: encryption.keyId,
      status: "accepted",
      peerSessionId: "40000000-0000-4000-8000-000000000001",
      conversationId: "50000000-0000-4000-8000-000000000001",
      turnId: "60000000-0000-4000-8000-000000000001",
      sourceSequence: 1n,
      ingestOrder: 1n,
      processingToken: null,
      errorCode: null,
      attempts: 0,
      nextAttemptAt: NOW,
      processedAt: NOW,
      receivedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
    delivery: {
      id: "70000000-0000-4000-8000-000000000001",
      connectionId: "20000000-0000-4000-8000-000000000001",
      peerSessionId: "40000000-0000-4000-8000-000000000001",
      inboundMessageId: "30000000-0000-4000-8000-000000000001",
      conversationId: "50000000-0000-4000-8000-000000000001",
      turnId: "60000000-0000-4000-8000-000000000001",
      status: "pending",
      processingToken: null,
      sentChunkCount: 0,
      attempts: 0,
      nextAttemptAt: NOW,
      lastErrorCode: null,
      sentAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
  const state: { available: boolean; outcome: WeixinTurnOutcome } = {
    available: true,
    outcome: { status: "running" },
  };
  const repository = {
    listActiveConnections: vi.fn(async () => []),
    listPendingInbound: vi.fn(async () => []),
    listPendingDeliveries: vi.fn(async () =>
      state.available &&
      item.delivery.status === "pending" &&
      item.delivery.nextAttemptAt.getTime() <= Date.now()
        ? [item]
        : [],
    ),
    findActiveConnection: vi.fn(async () => item.connection),
    claimDelivery: vi.fn<PrismaWeixinRepository["claimDelivery"]>(
      async (_id, token) => {
        item.delivery.status = "processing";
        item.delivery.processingToken = token;
        return { ...item.delivery };
      },
    ),
    findClaimedDelivery: vi.fn(async () => item.delivery),
    getTurnOutcome: vi.fn(async () => state.outcome),
    getOwnerLocale: vi.fn(async () => "zh-CN" as const),
    deferDelivery: vi.fn<PrismaWeixinRepository["deferDelivery"]>(
      async (_id, _token, nextAttemptAt) => {
        item.delivery.status = "pending";
        item.delivery.nextAttemptAt = nextAttemptAt;
      },
    ),
    markDeliveryChunkSent: vi.fn<
      PrismaWeixinRepository["markDeliveryChunkSent"]
    >(async (_id, _token, count) => {
      item.delivery.sentChunkCount = count;
      return true;
    }),
    markDeliverySent: vi.fn(async () => {
      item.delivery.status = "sent";
    }),
    markDeliveryRetry: vi.fn<PrismaWeixinRepository["markDeliveryRetry"]>(
      async (input) => {
        item.delivery.status = input.terminal ? "failed" : "pending";
        item.delivery.attempts = input.attempts;
        item.delivery.nextAttemptAt = input.nextAttemptAt;
      },
    ),
    requireReauthorization: vi.fn(async () => undefined),
  };
  const locks = new Map<string, string>();
  let leaseSequence = 0;
  const coordinator = {
    acquireLease: vi.fn<RedisWeixinCoordinator["acquireLease"]>(
      async (scope, resourceId) => {
        const key = `${scope}:${resourceId}`;
        if (locks.has(key)) return null;
        const token = String(++leaseSequence);
        locks.set(key, token);
        return { key, token };
      },
    ),
    renewLease: vi.fn<RedisWeixinCoordinator["renewLease"]>(
      async (lease) => locks.get(lease.key) === lease.token,
    ),
    releaseLease: vi.fn<RedisWeixinCoordinator["releaseLease"]>(
      async (lease) => {
        if (locks.get(lease.key) === lease.token) locks.delete(lease.key);
      },
    ),
  };
  const client = {
    getConfig: vi.fn<WeixinIlinkClient["getConfig"]>(async () => ({
      typingTicket: "typing-ticket",
    })),
    sendTyping: vi.fn<WeixinIlinkClient["sendTyping"]>(async () => undefined),
    sendText: vi.fn<WeixinIlinkClient["sendText"]>(async () => undefined),
  };
  const conversations: Pick<
    ConversationService,
    "acceptTurn" | "create" | "createApplicationConversation"
  > = {
    acceptTurn: vi.fn(),
    create: vi.fn(),
    createApplicationConversation: vi.fn(),
  };
  return {
    item,
    state,
    repository,
    coordinator,
    client,
    typingStatuses: () =>
      client.sendTyping.mock.calls.map(([input]) => input.status),
    createRuntime: () => {
      const runtime = new WeixinRuntime(
        repository as unknown as PrismaWeixinRepository,
        coordinator as unknown as RedisWeixinCoordinator,
        client as unknown as WeixinIlinkClient,
        conversations,
        encryption,
      );
      runtimes.push(runtime);
      return runtime;
    },
  };
}
