import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationService } from "../src/modules/conversations/service.js";
import type { FeishuOfficialClient } from "../src/modules/feishu/client.js";
import type { RedisFeishuCoordinator } from "../src/modules/feishu/coordinator.js";
import type { PrismaFeishuRepository } from "../src/modules/feishu/repository.js";
import { FeishuRuntime } from "../src/modules/feishu/runtime.js";
import { encryptFeishuCredentials } from "../src/modules/feishu/state.js";
import type { RedisWeixinCoordinator } from "../src/modules/weixin/coordinator.js";
import type {
  WeixinIlinkClient,
  WeixinUpdatesResult,
} from "../src/modules/weixin/protocol.js";
import type { PrismaWeixinRepository } from "../src/modules/weixin/repository.js";
import { WeixinRuntime } from "../src/modules/weixin/runtime.js";
import {
  encryptWeixinConnectionState,
  encryptWeixinContext,
} from "../src/modules/weixin/state.js";

const NOW = new Date("2026-09-06T03:00:00.000Z");
const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "50000000-0000-4000-8000-000000000001";
const TURN_ID = "60000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe.each(["weixin", "feishu"] as const)(
  "%s ingress latency",
  (channel) => {
    it("accepts an incoming message without waiting for a slow outbound scan", async () => {
      const fixture = createFixture(channel);
      const outboundScan = deferred<[]>();
      fixture.repository.listPendingDeliveries.mockImplementationOnce(
        () => outboundScan.promise,
      );
      try {
        await fixture.runtime.start();
        await vi.advanceTimersByTimeAsync(0);
        await fixture.receive();
        await vi.advanceTimersByTimeAsync(0);

        expect(fixture.conversations.acceptTurn).toHaveBeenCalledOnce();
        expect(fixture.repository.markInboundAccepted).toHaveBeenCalledWith(
          expect.objectContaining({ messageId: MESSAGE_ID, turnId: TURN_ID }),
        );
        expect(Date.now()).toBe(NOW.getTime());
      } finally {
        outboundScan.resolve([]);
        await fixture.runtime.close();
      }
    });

    it("remembers an incoming message notification during an in-flight inbound scan", async () => {
      const fixture = createFixture(channel);
      const inboundScan = deferred<[]>();
      fixture.repository.listPendingInbound.mockImplementationOnce(
        () => inboundScan.promise,
      );
      try {
        await fixture.runtime.start();
        await vi.advanceTimersByTimeAsync(0);
        await fixture.receive();
        await vi.advanceTimersByTimeAsync(0);
        inboundScan.resolve([]);
        await vi.advanceTimersByTimeAsync(0);

        expect(fixture.conversations.acceptTurn).toHaveBeenCalledOnce();
        expect(Date.now()).toBe(NOW.getTime());
      } finally {
        inboundScan.resolve([]);
        await fixture.runtime.close();
      }
    });
  },
);

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value: T) => resolvePromise?.(value) };
}

function createFixture(channel: "weixin" | "feishu") {
  const encryption = {
    masterKey: Buffer.alloc(32, 3).toString("base64"),
    keyId: "ingress-latency-test-key",
  };
  const connection = {
    id: CONNECTION_ID,
    ownerId: OWNER_ID,
    apiBaseUrl: "https://ilinkai.weixin.qq.com",
    ilinkUserId: "wx-user",
    ownerOpenId: "ou_owner",
    botName: "test bot",
    encryptedState: encryptWeixinConnectionState(
      CONNECTION_ID,
      { token: "bot-token", cursor: "cursor" },
      encryption,
    ),
    encryptedCredentials: encryptFeishuCredentials(
      CONNECTION_ID,
      {
        appId: "cli_0123456789abcdef",
        appSecret: "test-secret",
        domain: "feishu",
      },
      encryption,
    ),
    encryptionKeyId: encryption.keyId,
  };
  const message = {
    id: MESSAGE_ID,
    connectionId: CONNECTION_ID,
    peerUserId: "wx-user",
    chatId: "oc_chat",
    senderOpenId: "ou_owner",
    contentText: "start this task",
    peerSessionId: "40000000-0000-4000-8000-000000000001",
    conversationId: CONVERSATION_ID,
    turnId: null,
    attempts: 0,
    encryptedContext: encryptWeixinContext(
      "inbound",
      MESSAGE_ID,
      "context-token",
      encryption,
    ),
    encryptionKeyId: encryption.keyId,
  };
  let pending = false;
  const repository = {
    listActiveConnections: vi.fn(async () => [connection]),
    findActiveConnection: vi.fn(async () => connection),
    listPendingInbound: vi.fn(async () =>
      pending ? [{ connection, message }] : [],
    ),
    listPendingDeliveries: vi.fn(async (): Promise<[]> => []),
    persistPoll: vi.fn(async () => {
      pending = true;
      return true;
    }),
    persistInbound: vi.fn(async () => {
      pending = true;
      return true;
    }),
    markConnected: vi.fn(async () => undefined),
    claimInbound: vi.fn(async () => {
      pending = false;
      return { ...message };
    }),
    hasEarlierPendingMessage: vi.fn(async () => false),
    hasUnsentDeliveryForPeer: vi.fn(async () => false),
    hasUnsentDeliveryForChat: vi.fn(async () => false),
    findTurnByIdempotencyKey: vi.fn(async () => null),
    conversationIsAvailable: vi.fn(async () => true),
    conversationIsBusy: vi.fn(async () => false),
    markInboundAccepted: vi.fn(async () => true),
    markInboundRetry: vi.fn(async () => undefined),
    getTurnOutcome: vi.fn(async () => ({ status: "running" as const })),
  };
  const coordinator = {
    acquireLease: vi.fn(async (scope: string, id: string) => ({
      key: `${scope}:${id}`,
      token: "lease-token",
    })),
    renewLease: vi.fn(async () => true),
    releaseLease: vi.fn(async () => undefined),
  };
  const conversations = {
    create: vi.fn(),
    acceptTurn: vi.fn(async () => ({
      accepted: true as const,
      status: "starting" as const,
      turn_id: TURN_ID,
    })),
  };
  let deliverFeishu:
    Parameters<FeishuOfficialClient["connect"]>[0]["onMessage"] | undefined;
  const updates = deferred<WeixinUpdatesResult>();
  const client = {
    connect: vi.fn<FeishuOfficialClient["connect"]>(async (input) => {
      deliverFeishu = input.onMessage;
      return { botName: "test bot", close: async () => undefined };
    }),
    getUpdates: vi
      .fn<WeixinIlinkClient["getUpdates"]>()
      .mockImplementationOnce(() => updates.promise)
      .mockImplementation(
        async ({ signal }) =>
          new Promise((resolve) => {
            const abort = () =>
              resolve({
                cursor: "next",
                messages: [],
                suggestedTimeoutMs: null,
              });
            if (signal?.aborted) abort();
            else signal?.addEventListener("abort", abort, { once: true });
          }),
      ),
    notifyStart: vi.fn(async () => undefined),
    notifyStop: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ typingTicket: "" })),
  };
  const runtime =
    channel === "weixin"
      ? new WeixinRuntime(
          repository as unknown as PrismaWeixinRepository,
          coordinator as unknown as RedisWeixinCoordinator,
          client as unknown as WeixinIlinkClient,
          { ...conversations, createApplicationConversation: vi.fn() },
          encryption,
        )
      : new FeishuRuntime(
          repository as unknown as PrismaFeishuRepository,
          coordinator as unknown as RedisFeishuCoordinator,
          client as unknown as FeishuOfficialClient,
          conversations as unknown as Pick<
            ConversationService,
            "create" | "acceptTurn"
          >,
          encryption,
        );
  return {
    runtime,
    repository,
    conversations,
    receive: async () => {
      if (channel === "feishu") {
        await deliverFeishu?.({
          messageKey: "om_message",
          chatId: "oc_chat",
          senderOpenId: "ou_owner",
          text: message.contentText,
          receivedAt: NOW,
        });
      } else {
        updates.resolve({
          cursor: "next",
          messages: [
            {
              message_id: "wx-message",
              message_type: 1,
              from_user_id: "wx-user",
              context_token: "context-token",
              item_list: [
                { type: 1, text_item: { text: message.contentText } },
              ],
            },
          ],
          suggestedTimeoutMs: null,
        });
      }
    },
  };
}
