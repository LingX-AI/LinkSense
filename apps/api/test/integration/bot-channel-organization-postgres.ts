import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { z } from "zod";
import { createPrismaClient } from "../../src/db.js";
import { PrismaBotChannelRepository } from "../../src/modules/bot-channels/repository.js";
import { RedisBotChannelCoordinator } from "../../src/modules/bot-channels/coordinator.js";
import { BotChannelIdentityService } from "../../src/modules/bot-channels/identity.js";
import {
  BotChannelRuntime,
  type BotChannelConversations,
} from "../../src/modules/bot-channels/runtime.js";
import { encryptChannelCredentials } from "../../src/modules/bot-channels/state.js";
import { projectChannelMessage } from "../../src/modules/bot-channels/clients/message-projection.js";
import type { ChannelConnectInput } from "../../src/modules/bot-channels/types.js";
import { testCredentials, platformPayload } from "../fixtures/bot-channels.js";
const env = z
  .object({
    BOT_CHANNEL_TEST_DATABASE_URL: z.url(),
    BOT_CHANNEL_TEST_REDIS_URL: z.url(),
  })
  .parse(process.env);
const url = new URL(env.BOT_CHANNEL_TEST_DATABASE_URL),
  redisUrl = new URL(env.BOT_CHANNEL_TEST_REDIS_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/linksense_channel_tests");
assert.equal(redisUrl.hostname, "127.0.0.1");
const prisma = createPrismaClient(url.href),
  redis = new Redis(redisUrl.href, { maxRetriesPerRequest: 1 });
const repository = new PrismaBotChannelRepository(prisma),
  coordinator = new RedisBotChannelCoordinator(redis),
  identities = new BotChannelIdentityService(repository, coordinator);
const encryption = {
  masterKey: Buffer.alloc(32, 6).toString("base64"),
  keyId: "isolated-channel-test",
};
const users: string[] = [randomUUID(), randomUUID()],
  connectionId = randomUUID();
const replies: string[] = [];
let transport: ChannelConnectInput | undefined;
let accepted = 0;
const conversations: BotChannelConversations = {
  create: async (ownerId) => {
    assert.ok(users.includes(ownerId));
    const id = randomUUID();
    return prisma.conversation.create({
      data: {
        id,
        ownerId,
        title: "Member test",
        titleSource: "manual",
        archiveStatus: "active",
        workspaceRelPath: `channel-test/${id}`,
        runtimeGeneration: randomUUID(),
      },
    });
  },
  acceptTurn: async (ownerId, conversationId, request, audit) => {
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    assert.equal(conversation.ownerId, ownerId);
    assert.equal(audit.actorId, ownerId);
    accepted += 1;
    const id = randomUUID(),
      messageId = randomUUID(),
      sequence =
        (await prisma.conversationTurn.count({ where: { conversationId } })) +
        1;
    await prisma.$transaction(async (tx) => {
      await tx.conversationTurn.create({
        data: {
          id,
          conversationId,
          sequenceNo: sequence,
          submittedBy: ownerId,
          codexThreadId: conversationId,
          codexTurnId: id,
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
          turnId: id,
          sequenceNo: sequence,
          role: "assistant",
          contentText: `reply:${ownerId}`,
        },
      });
      await tx.conversationEvent.create({
        data: {
          conversationId,
          turnId: id,
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
    return { turn_id: id };
  },
};
const runtime = new BotChannelRuntime(
  repository,
  coordinator,
  {
    connect: async (input) => {
      transport = input;
      return {
        isConnected: () => !input.signal.aborted,
        close: async () => undefined,
        send: async (_context, text) => {
          replies.push(text);
        },
      };
    },
  },
  conversations,
  encryption,
);
async function until(
  check: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const credentials = testCredentials[0]!;
const base = projectChannelMessage(
  credentials,
  platformPayload("wecom", true),
)!;
try {
  for (const [index, id] of users.entries())
    await prisma.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        name: `Member ${index}`,
        role: "user",
        status: "active",
      },
    });
  await repository.createConnection({
    id: connectionId,
    ownerId: null,
    provider: "wecom",
    externalId: "aib-test",
    allowGroupMessages: true,
    encryptedCredentials: encryptChannelCredentials(
      connectionId,
      credentials,
      encryption,
    ),
    encryptionKeyId: encryption.keyId,
  });
  await runtime.start();
  await until(async () => transport !== undefined, "shared transport ready");
  const exposed = await identities.issue(users[0]!, connectionId);
  await transport!.onMessage({
    ...base,
    senderId: "member-0",
    text: exposed.command,
  });
  assert.equal(
    await identities.handleCommand(
      connectionId,
      "another-member",
      exposed.command,
      false,
    ),
    "link_failed",
  );
  assert.equal(
    await repository.resolveSenderOwner(connectionId, "member-0"),
    null,
  );
  for (const [index, userId] of users.entries()) {
    const code = await identities.issue(userId, connectionId);
    await transport!.onMessage({
      ...base,
      group: false,
      senderId: `member-${index}`,
      text: code.command,
    });
    assert.equal(
      await repository.resolveSenderOwner(connectionId, `member-${index}`),
      userId,
    );
    assert.equal(
      await identities.handleCommand(
        connectionId,
        "stolen-code",
        code.command,
        false,
      ),
      "link_failed",
    );
  }
  assert.equal(
    await prisma.botChannelInboundMessage.count({ where: { connectionId } }),
    0,
    "confirmation codes must never become task content",
  );
  await transport!.onMessage({
    ...base,
    senderId: "unregistered-member",
    messageKey: "unknown",
  });
  assert.equal(
    await prisma.botChannelInboundMessage.count({ where: { connectionId } }),
    0,
  );
  await Promise.all(
    users.flatMap((_id, index) =>
      Array.from({ length: 3 }, () =>
        transport!.onMessage({
          ...base,
          senderId: `member-${index}`,
          messageKey: `member-message-${index}`,
        }),
      ),
    ),
  );
  await until(
    async () =>
      (await prisma.botChannelOutboundDelivery.count({
        where: { connectionId, status: "sent" },
      })) === 2,
    "each member reply delivered",
  );
  assert.equal(accepted, 2, "duplicate callbacks must not replay native turns");
  const peers = await prisma.botChannelPeerSession.findMany({
    where: { connectionId },
  });
  assert.equal(peers.length, 2);
  assert.equal(new Set(peers.map((p) => p.chatId)).size, 1);
  assert.equal(new Set(peers.map((p) => p.conversationId)).size, 2);
  assert.deepEqual(peers.map((p) => p.ownerId).sort(), [...users].sort());
  for (const id of users) assert.ok(replies.includes(`reply:${id}`));
  const existingA = peers.find((p) => p.ownerId === users[0])!;
  await transport!.onMessage({
    ...base,
    senderId: "member-0",
    messageKey: "member-a-again",
  });
  await until(
    async () =>
      (await prisma.botChannelOutboundDelivery.count({
        where: { connectionId, status: "sent" },
      })) === 3,
    "member conversation reused",
  );
  assert.equal(
    (await repository.findPeerSession(connectionId, base.chatId, users[0]!))
      ?.conversationId,
    existingA.conversationId,
  );
  const stale = await identities.issue(users[0]!, connectionId);
  await identities.unlink(users[0]!, connectionId);
  assert.equal(
    await identities.handleCommand(
      connectionId,
      "member-0",
      stale.command,
      false,
    ),
    "link_failed",
  );
  await transport!.onMessage({
    ...base,
    senderId: "member-0",
    messageKey: "after-unlink",
  });
  await prisma.user.update({
    where: { id: users[1]! },
    data: { status: "disabled" },
  });
  await transport!.onMessage({
    ...base,
    senderId: "member-1",
    messageKey: "after-disable",
  });
  assert.equal(
    await prisma.botChannelInboundMessage.count({
      where: {
        connectionId,
        messageKey: { in: ["after-unlink", "after-disable"] },
      },
    }),
    0,
  );
  assert.notEqual(
    await repository.findActiveConnection(connectionId),
    null,
    "organization transport is independent of a member status",
  );
  assert.equal(await repository.setEnabled(connectionId, false), true);
  assert.equal(await repository.findActiveConnection(connectionId), null);
  assert.equal(await repository.setEnabled(connectionId, true), true);
  await runtime.close();
  assert.equal(await repository.deleteConnection(null, connectionId), true);
  assert.equal(
    await prisma.botChannelIdentity.count({ where: { connectionId } }),
    0,
  );
  assert.equal(
    await prisma.conversation.count({ where: { ownerId: { in: users } } }),
    2,
  );
  console.log(
    "organization identity proof, one-use/revoked codes, multi-member group isolation, native idempotency, member status, pause/resume and task-preserving cleanup: passed",
  );
} finally {
  await runtime.close();
  await repository.deleteConnection(null, connectionId);
  const ids = (
    await prisma.conversation.findMany({
      where: { ownerId: { in: users } },
      select: { id: true },
    })
  ).map((row) => row.id);
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
    prisma.conversation.deleteMany({ where: { id: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: users } } }),
  ]);
  await prisma.$disconnect();
  await redis.quit();
}
