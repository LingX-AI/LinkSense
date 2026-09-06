import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { z } from "zod";
import { createPrismaClient } from "../../src/db.js";
import { PrismaBotChannelRepository } from "../../src/modules/bot-channels/repository.js";
import { RedisBotChannelCoordinator } from "../../src/modules/bot-channels/coordinator.js";
import {
  BotChannelRuntime,
  type BotChannelConversations,
} from "../../src/modules/bot-channels/runtime.js";
import { encryptChannelCredentials } from "../../src/modules/bot-channels/state.js";
import { projectChannelMessage } from "../../src/modules/bot-channels/clients/message-projection.js";
import type {
  ChannelConnectInput,
  ChannelSession,
  ReplyContext,
} from "../../src/modules/bot-channels/types.js";
import { platformPayload, testCredentials } from "../fixtures/bot-channels.js";

// Explicit disposable database only. This script never reads the application's .env.
const env = z
  .object({
    BOT_CHANNEL_TEST_DATABASE_URL: z.url(),
    BOT_CHANNEL_TEST_REDIS_URL: z.url(),
  })
  .parse(process.env);
const databaseUrl = new URL(env.BOT_CHANNEL_TEST_DATABASE_URL);
const redisUrl = new URL(env.BOT_CHANNEL_TEST_REDIS_URL);
assert.equal(databaseUrl.hostname, "127.0.0.1");
assert.equal(databaseUrl.pathname, "/linksense_channel_tests");
assert.equal(redisUrl.hostname, "127.0.0.1");
const prisma = createPrismaClient(databaseUrl.href);
const redis = new Redis(redisUrl.href, { maxRetriesPerRequest: 1 });
const repository = new PrismaBotChannelRepository(prisma);
const coordinator = new RedisBotChannelCoordinator(redis);
const encryption = {
  masterKey: Buffer.alloc(32, 5).toString("base64"),
  keyId: "integration-test",
};
const ownerId = randomUUID();
const inputs = new Map<string, ChannelConnectInput>();
const sends: Array<{
  connectionId: string;
  context: ReplyContext;
  text: string;
}> = [];
let failChunkOnce = false;
let replyText = "completed reply";
let acceptCount = 0;
let runtime: BotChannelRuntime | undefined;
let apiWorker: BotChannelRuntime | undefined;
const connectionIds: string[] = [];
const conversations: BotChannelConversations = {
  create: async (owner) => {
    const id = randomUUID();
    return prisma.conversation.create({
      data: {
        id,
        ownerId: owner,
        title: "Channel integration test",
        titleSource: "manual",
        archiveStatus: "active",
        workspaceRelPath: `channel-test/${id}`,
        runtimeGeneration: randomUUID(),
      },
    });
  },
  acceptTurn: async (owner, conversationId, request) => {
    acceptCount += 1;
    assert.equal(owner, ownerId);
    assert.equal(request.preserveStagedAttachments, true);
    const turnId = randomUUID();
    const messageId = randomUUID();
    const sequence =
      (await prisma.conversationTurn.count({ where: { conversationId } })) + 1;
    await prisma.$transaction(async (tx) => {
      await tx.conversationTurn.create({
        data: {
          id: turnId,
          conversationId,
          sequenceNo: sequence,
          submittedBy: owner,
          codexThreadId: conversationId,
          codexTurnId: turnId,
          status: "completed",
          submitMode: "normal",
          idempotencyKey: request.idempotencyKey ?? null,
          capabilityGeneration: "0".repeat(64),
          capabilitiesJson: [],
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await tx.conversationMessage.create({
        data: {
          id: messageId,
          conversationId,
          turnId,
          sequenceNo: sequence,
          role: "assistant",
          contentText: replyText,
        },
      });
      await tx.conversationEvent.create({
        data: {
          conversationId,
          turnId,
          sequenceNo: BigInt(sequence),
          eventType: "item/completed",
          visibility: "user_visible",
          payloadJson: {
            method: "item/completed",
            params: { item: { type: "agentMessage", phase: "final_answer" } },
            local: { message_id: messageId },
          },
          sseEventId: randomUUID(),
        },
      });
    });
    return { turn_id: turnId };
  },
};
function createRuntime(): BotChannelRuntime {
  return new BotChannelRuntime(
    repository,
    coordinator,
    {
      connect: async (input) => {
        inputs.set(input.id, input);
        const session: ChannelSession = {
          isConnected: () => !input.signal.aborted,
          close: async () => undefined,
          send: async (context, text) => {
            if (failChunkOnce && text.startsWith("b")) {
              failChunkOnce = false;
              throw new Error("simulated platform failure");
            }
            sends.push({ connectionId: input.id, context, text });
          },
        };
        return session;
      },
    },
    conversations,
    encryption,
  );
}
async function until(
  check: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
try {
  await prisma.user.create({
    data: {
      id: ownerId,
      email: `${ownerId}@example.test`,
      name: "Channel test",
      role: "user",
      status: "active",
    },
  });
  for (const credentials of testCredentials) {
    const id = randomUUID();
    connectionIds.push(id);
    await repository.createConnection({
      id,
      ownerId,
      provider: credentials.provider,
      externalId:
        credentials.provider === "wecom"
          ? credentials.bot_id
          : credentials.client_id,
      allowedSenderId: credentials.allowed_sender_id,
      allowGroupMessages: true,
      encryptedCredentials: encryptChannelCredentials(
        id,
        credentials,
        encryption,
      ),
      encryptionKeyId: encryption.keyId,
    });
  }
  runtime = createRuntime();
  await runtime.start();
  await until(async () => inputs.size === 3, "all provider sessions ready");
  apiWorker = createRuntime();
  await apiWorker.start();
  for (const [index, credentials] of testCredentials.entries()) {
    const connectionId = connectionIds[index]!;
    const payload = platformPayload(credentials.provider, true);
    const message = projectChannelMessage(credentials, payload)!;
    assert.ok(message);
    const receive = inputs.get(connectionId)!.onMessage;
    const started = Date.now();
    await Promise.all(Array.from({ length: 5 }, () => receive(message)));
    await until(
      async () =>
        (await prisma.botChannelOutboundDelivery.count({
          where: { connectionId, status: "sent" },
        })) === 1,
      `${credentials.provider} reply`,
    );
    assert.equal(
      await prisma.botChannelInboundMessage.count({ where: { connectionId } }),
      1,
    );
    assert.equal(
      sends.filter((send) => send.connectionId === connectionId).length,
      1,
    );
    assert.equal(
      sends.find((send) => send.connectionId === connectionId)?.text,
      replyText,
    );
    assert.deepEqual(
      sends.find((send) => send.connectionId === connectionId)?.context,
      message.context,
    );
    console.log(
      `${credentials.provider}: persisted → native task boundary → reply, duplicate callbacks and two workers: passed (${Date.now() - started} ms)`,
    );
  }
  assert.equal(acceptCount, 3);
  await apiWorker.close();
  apiWorker = undefined;
  const firstId = connectionIds[0]!;
  const credentials = testCredentials[0]!;
  const base = projectChannelMessage(
    credentials,
    platformPayload("wecom", true),
  )!;
  await inputs
    .get(firstId)!
    .onMessage({
      ...base,
      senderId: "unauthorized",
      messageKey: "unauthorized",
    });
  assert.equal(
    await prisma.botChannelInboundMessage.count({
      where: { messageKey: "unauthorized" },
    }),
    0,
  );
  // Two messages in the same chat must use its existing task, preserving order.
  await Promise.all(
    ["ordered-1", "ordered-2"].map((messageKey) =>
      inputs.get(firstId)!.onMessage({ ...base, messageKey }),
    ),
  );
  await until(
    async () =>
      (await prisma.botChannelOutboundDelivery.count({
        where: { connectionId: firstId, status: "sent" },
      })) === 3,
    "same-chat ordered messages",
  );
  assert.equal(
    await prisma.botChannelPeerSession.count({
      where: { connectionId: firstId },
    }),
    1,
  );
  const ordered = await prisma.botChannelInboundMessage.findMany({
    where: { connectionId: firstId },
    orderBy: { ingestOrder: "asc" },
  });
  assert.deepEqual(
    ordered.map((row) => row.messageKey),
    ["m1", "ordered-1", "ordered-2"],
  );
  assert.equal(new Set(ordered.map((row) => row.conversationId)).size, 1);
  console.log(
    "same-chat order, conversation reuse and sender authorization: passed",
  );
  // Persist successful chunk progress, restart, and retry only the unsent tail.
  replyText = "a".repeat(3500) + "b".repeat(20);
  failChunkOnce = true;
  await inputs.get(firstId)!.onMessage({ ...base, messageKey: "chunk-retry" });
  await until(
    async () =>
      (await prisma.botChannelOutboundDelivery.count({
        where: { connectionId: firstId, attempts: 1, sentChunkCount: 1 },
      })) === 1,
    "first chunk durable before failure",
  );
  const beforeRestart = acceptCount;
  await runtime.close();
  runtime = createRuntime();
  await runtime.start();
  await until(
    async () =>
      (await prisma.botChannelOutboundDelivery.count({
        where: { connectionId: firstId, status: "sent" },
      })) === 4,
    "unsent chunk recovered after restart",
  );
  assert.equal(
    sends.filter((send) => send.text === "a".repeat(3500)).length,
    1,
  );
  assert.equal(sends.filter((send) => send.text === "b".repeat(20)).length, 1);
  assert.equal(acceptCount, beforeRestart);
  console.log(
    "chunk retry after restart without replaying a native turn: passed",
  );
  await prisma.user.update({
    where: { id: ownerId },
    data: { status: "disabled" },
  });
  assert.equal(await repository.findActiveConnection(firstId), null);
  await inputs.get(firstId)!.onMessage({ ...base, messageKey: "suspended" });
  assert.equal(
    await prisma.botChannelInboundMessage.count({
      where: { messageKey: "suspended" },
    }),
    0,
  );
  await runtime.close();
  runtime = undefined;
  for (const id of connectionIds)
    assert.equal(await repository.deleteConnection(ownerId, id), true);
  assert.equal(
    await prisma.botChannelPeerSession.count({
      where: { connectionId: { in: connectionIds } },
    }),
    0,
  );
  assert.equal(
    await prisma.botChannelInboundMessage.count({
      where: { connectionId: { in: connectionIds } },
    }),
    0,
  );
  assert.equal(
    await prisma.botChannelOutboundDelivery.count({
      where: { connectionId: { in: connectionIds } },
    }),
    0,
  );
  assert.equal(await prisma.conversation.count({ where: { ownerId } }), 3);
  console.log(
    "disabled owner and transactional disconnect cleanup preserving tasks: passed",
  );
} finally {
  await apiWorker?.close();
  await runtime?.close();
  for (const id of connectionIds)
    await repository.deleteConnection(ownerId, id);
  const records = await prisma.conversation.findMany({
    where: { ownerId },
    select: { id: true },
  });
  const ids = records.map((row) => row.id);
  await prisma.$transaction([
    prisma.conversationEvent.deleteMany({
      where: { conversationId: { in: ids } },
    }),
    prisma.conversationMessage.deleteMany({
      where: { conversationId: { in: ids } },
    }),
    prisma.conversationTurn.deleteMany({
      where: { conversationId: { in: ids } },
    }),
    prisma.conversation.deleteMany({ where: { ownerId } }),
    prisma.user.deleteMany({ where: { id: ownerId } }),
  ]);
  await prisma.$disconnect();
  await redis.quit();
}
