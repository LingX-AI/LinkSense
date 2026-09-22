import { Prisma } from "../../generated/prisma/client.js";
import type {
  BotChannelConnection,
  BotChannelInboundMessage,
  BotChannelOutboundDelivery,
  BotChannelPeerSession,
  PrismaClient,
} from "../../generated/prisma/client.js";
import { isLocale, type BotChannelProvider, type Locale } from "@linksense/shared";

export type PendingBotChannelInbound = {
  connection: BotChannelConnection;
  message: BotChannelInboundMessage;
};
export type PendingBotChannelDelivery = {
  connection: BotChannelConnection;
  delivery: BotChannelOutboundDelivery;
  inbound: BotChannelInboundMessage;
};
export type BotChannelTurnOutcome =
  | { status: "running" }
  | { status: "completed"; text: string | null }
  | { status: "failed"; errorCode: string | null };

export class PrismaBotChannelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  listForOwner(ownerId: string): Promise<BotChannelConnection[]> {
    return this.prisma.botChannelConnection.findMany({
      where: { ownerId, status: "active" },
      orderBy: { createdAt: "asc" },
    });
  }
  findConnectionForOwner(
    ownerId: string,
    id: string,
  ): Promise<BotChannelConnection | null> {
    return this.prisma.botChannelConnection.findFirst({
      where: { id, ownerId, status: "active" },
    });
  }
  async listActiveConnections(limit = 500): Promise<BotChannelConnection[]> {
    const connections = await this.prisma.botChannelConnection.findMany({
      where: { status: "active" },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return this.#filterActiveOwners(connections);
  }
  async findActiveConnection(id: string): Promise<BotChannelConnection | null> {
    const connection = await this.prisma.botChannelConnection.findFirst({
      where: { id, status: "active" },
    });
    if (!connection) return null;
    return (await this.#filterActiveOwners([connection]))[0] ?? null;
  }
  async createConnection(input: {
    id: string;
    ownerId: string;
    provider: BotChannelProvider;
    externalId: string;
    allowedSenderId: string;
    allowGroupMessages: boolean;
    encryptedCredentials: string;
    encryptionKeyId: string;
  }): Promise<BotChannelConnection> {
    return this.prisma.botChannelConnection.create({ data: input });
  }
  async deleteConnection(ownerId: string, id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.botChannelConnection.updateMany({
        where: { id, ownerId, status: "active" },
        data: { status: "disconnecting" },
      });
      if (!found.count) return false;
      await tx.botChannelOutboundDelivery.deleteMany({
        where: { connectionId: id },
      });
      await tx.botChannelInboundMessage.deleteMany({
        where: { connectionId: id },
      });
      await tx.botChannelPeerSession.deleteMany({
        where: { connectionId: id },
      });
      await tx.botChannelConnection.delete({ where: { id } });
      return true;
    });
  }
  async markConnected(id: string, now: Date): Promise<void> {
    await this.prisma.botChannelConnection.updateMany({
      where: { id, status: "active" },
      data: { lastConnectedAt: now, lastErrorCode: null, lastErrorAt: null },
    });
  }
  async recordConnectionError(
    id: string,
    code: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.botChannelConnection.updateMany({
      where: { id, status: "active" },
      data: { lastErrorCode: code, lastErrorAt: now },
    });
  }
  async persistInbound(input: {
    id: string;
    connectionId: string;
    messageKey: string;
    chatId: string;
    senderId: string;
    contentText: string;
    encryptedContext: string;
    encryptionKeyId: string;
    receivedAt: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.botChannelInboundMessage.findUnique({
        where: {
          connectionId_messageKey: {
            connectionId: input.connectionId,
            messageKey: input.messageKey,
          },
        },
        select: { id: true },
      });
      if (existing) return false;
      const [updated] = await tx.$queryRaw<Array<{ ingestOrder: bigint }>>`
        UPDATE "bot_channel_connections"
        SET
          "next_ingest_order" = "next_ingest_order" + 1,
          "last_inbound_at" = GREATEST(
            COALESCE("last_inbound_at", ${input.receivedAt}::timestamptz),
            ${input.receivedAt}::timestamptz
          ),
          "last_error_code" = NULL,
          "last_error_at" = NULL,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.connectionId}::uuid AND "status" = 'active'
        RETURNING "next_ingest_order" AS "ingestOrder"
      `;
      if (!updated) return false;
      const created = await tx.botChannelInboundMessage.createMany({
        data: [
          {
            ...input,
            status: "pending",
            ingestOrder: updated.ingestOrder,
          },
        ],
        skipDuplicates: true,
      });
      return created.count === 1;
    });
  }

  async listPendingInbound(
    now: Date,
    limit: number,
  ): Promise<PendingBotChannelInbound[]> {
    const connections = await this.listActiveConnections(500);
    if (connections.length === 0) return [];
    const messages = await this.prisma.botChannelInboundMessage.findMany({
      where: {
        connectionId: { in: connections.map((item) => item.id) },
        OR: [
          { status: "pending", nextAttemptAt: { lte: now } },
          { status: "processing", nextAttemptAt: { lte: now } },
        ],
      },
      orderBy: [{ ingestOrder: "asc" }, { id: "asc" }],
      take: limit,
    });
    const byId = new Map(connections.map((item) => [item.id, item]));
    return messages.flatMap((message) => {
      const connection = byId.get(message.connectionId);
      return connection ? [{ connection, message }] : [];
    });
  }

  async claimInbound(
    messageId: string,
    processingToken: string,
    claimedAt: Date,
    claimExpiresAt: Date,
  ): Promise<BotChannelInboundMessage | null> {
    const claimed = await this.prisma.botChannelInboundMessage.updateMany({
      where: {
        id: messageId,
        OR: [
          { status: "pending", nextAttemptAt: { lte: claimedAt } },
          { status: "processing", nextAttemptAt: { lte: claimedAt } },
        ],
      },
      data: {
        status: "processing",
        processingToken,
        nextAttemptAt: claimExpiresAt,
      },
    });
    if (claimed.count === 0) return null;
    return this.prisma.botChannelInboundMessage.findFirst({
      where: { id: messageId, status: "processing", processingToken },
    });
  }

  findClaimedInbound(
    messageId: string,
    processingToken: string,
  ): Promise<BotChannelInboundMessage | null> {
    return this.prisma.botChannelInboundMessage.findFirst({
      where: { id: messageId, status: "processing", processingToken },
    });
  }

  async hasEarlierPendingMessage(
    message: BotChannelInboundMessage,
  ): Promise<boolean> {
    return (
      (await this.prisma.botChannelInboundMessage.count({
        where: {
          connectionId: message.connectionId,
          chatId: message.chatId,
          status: { in: ["pending", "processing"] },
          ingestOrder: { lt: message.ingestOrder },
        },
      })) > 0
    );
  }

  async prepareInbound(input: {
    messageId: string;
    processingToken: string;
    peerSessionId: string;
    conversationId: string;
  }): Promise<boolean> {
    const result = await this.prisma.botChannelInboundMessage.updateMany({
      where: {
        id: input.messageId,
        status: "processing",
        processingToken: input.processingToken,
      },
      data: {
        peerSessionId: input.peerSessionId,
        conversationId: input.conversationId,
      },
    });
    return result.count === 1;
  }

  async clearInboundPreparation(
    messageId: string,
    processingToken: string,
  ): Promise<boolean> {
    const result = await this.prisma.botChannelInboundMessage.updateMany({
      where: { id: messageId, status: "processing", processingToken },
      data: { peerSessionId: null, conversationId: null },
    });
    return result.count === 1;
  }

  findPeerSession(
    connectionId: string,
    chatId: string,
  ): Promise<BotChannelPeerSession | null> {
    return this.prisma.botChannelPeerSession.findUnique({
      where: { connectionId_chatId: { connectionId, chatId } },
    });
  }

  async conversationIsAvailable(
    ownerId: string,
    conversationId: string,
  ): Promise<boolean> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ownerId, archiveStatus: "active" },
      select: { id: true },
    });
    return conversation !== null;
  }

  upsertPeerSession(input: {
    id: string;
    connectionId: string;
    chatId: string;
    senderId: string;
    conversationId: string;
    lastInboundAt: Date;
  }): Promise<BotChannelPeerSession> {
    return this.prisma.botChannelPeerSession.upsert({
      where: {
        connectionId_chatId: {
          connectionId: input.connectionId,
          chatId: input.chatId,
        },
      },
      create: input,
      update: {
        senderId: input.senderId,
        conversationId: input.conversationId,
        lastInboundAt: input.lastInboundAt,
      },
    });
  }

  async conversationIsBusy(conversationId: string): Promise<boolean> {
    const [runningTurns, startIntents] = await Promise.all([
      this.prisma.conversationTurn.count({
        where: { conversationId, status: "running" },
      }),
      this.prisma.conversationTurnStartIntent.count({
        where: { conversationId },
      }),
    ]);
    return runningTurns > 0 || startIntents > 0;
  }

  async findTurnByIdempotencyKey(
    conversationId: string,
    idempotencyKey: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.conversationTurn.findFirst({
      where: { conversationId, idempotencyKey },
      select: { id: true },
    });
  }

  async hasUnsentDeliveryForChat(
    connectionId: string,
    chatId: string,
  ): Promise<boolean> {
    const peer = await this.findPeerSession(connectionId, chatId);
    if (!peer) return false;
    return (
      (await this.prisma.botChannelOutboundDelivery.count({
        where: {
          connectionId,
          peerSessionId: peer.id,
          status: { in: ["pending", "processing"] },
        },
      })) > 0
    );
  }

  async getOwnerLocale(ownerId: string): Promise<Locale> {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { preferredLocale: true },
    });
    return isLocale(owner?.preferredLocale) ? owner.preferredLocale : "zh-CN";
  }

  async markInboundAccepted(input: {
    messageId: string;
    processingToken: string;
    connectionId: string;
    peerSessionId: string;
    conversationId: string;
    turnId: string;
    processedAt: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.botChannelInboundMessage.updateMany({
        where: {
          id: input.messageId,
          status: "processing",
          processingToken: input.processingToken,
        },
        data: {
          status: "accepted",
          peerSessionId: input.peerSessionId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          processedAt: input.processedAt,
          errorCode: null,
          processingToken: null,
        },
      });
      if (updated.count === 0) return false;
      await tx.botChannelOutboundDelivery.create({
        data: {
          connectionId: input.connectionId,
          peerSessionId: input.peerSessionId,
          inboundMessageId: input.messageId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          status: "pending",
        },
      });
      return true;
    });
  }

  async markInboundFailed(
    messageId: string,
    processingToken: string,
    errorCode: string,
    processedAt: Date,
  ): Promise<void> {
    await this.prisma.botChannelInboundMessage.updateMany({
      where: { id: messageId, status: "processing", processingToken },
      data: {
        status: "failed",
        errorCode,
        processedAt,
        processingToken: null,
      },
    });
  }

  async markInboundRetry(input: {
    messageId: string;
    processingToken: string;
    attempts: number;
    errorCode: string;
    nextAttemptAt: Date;
  }): Promise<void> {
    await this.prisma.botChannelInboundMessage.updateMany({
      where: {
        id: input.messageId,
        status: "processing",
        processingToken: input.processingToken,
      },
      data: {
        status: "pending",
        processingToken: null,
        attempts: input.attempts,
        errorCode: input.errorCode,
        nextAttemptAt: input.nextAttemptAt,
      },
    });
  }

  async deferInbound(
    messageId: string,
    processingToken: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.prisma.botChannelInboundMessage.updateMany({
      where: { id: messageId, status: "processing", processingToken },
      data: { status: "pending", processingToken: null, nextAttemptAt },
    });
  }

  async listPendingDeliveries(
    now: Date,
    limit: number,
    connectionIds: readonly string[],
  ): Promise<PendingBotChannelDelivery[]> {
    const connections = (await this.listActiveConnections(500)).filter((row) =>
      connectionIds.includes(row.id),
    );
    if (connections.length === 0) return [];
    const deliveries = await this.prisma.botChannelOutboundDelivery.findMany({
      where: {
        connectionId: { in: connections.map((item) => item.id) },
        OR: [
          { status: "pending", nextAttemptAt: { lte: now } },
          { status: "processing", nextAttemptAt: { lte: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    const inbound = await this.prisma.botChannelInboundMessage.findMany({
      where: {
        id: { in: deliveries.map((item) => item.inboundMessageId) },
      },
    });
    const connectionById = new Map(connections.map((item) => [item.id, item]));
    const inboundById = new Map(inbound.map((item) => [item.id, item]));
    return deliveries.flatMap((delivery) => {
      const connection = connectionById.get(delivery.connectionId);
      const inboundMessage = inboundById.get(delivery.inboundMessageId);
      return connection && inboundMessage
        ? [{ connection, delivery, inbound: inboundMessage }]
        : [];
    });
  }

  async claimDelivery(
    deliveryId: string,
    processingToken: string,
    claimedAt: Date,
    claimExpiresAt: Date,
  ): Promise<BotChannelOutboundDelivery | null> {
    const claimed = await this.prisma.botChannelOutboundDelivery.updateMany({
      where: {
        id: deliveryId,
        OR: [
          { status: "pending", nextAttemptAt: { lte: claimedAt } },
          { status: "processing", nextAttemptAt: { lte: claimedAt } },
        ],
      },
      data: {
        status: "processing",
        processingToken,
        nextAttemptAt: claimExpiresAt,
      },
    });
    if (claimed.count === 0) return null;
    return this.prisma.botChannelOutboundDelivery.findFirst({
      where: { id: deliveryId, status: "processing", processingToken },
    });
  }

  findClaimedDelivery(
    deliveryId: string,
    processingToken: string,
  ): Promise<BotChannelOutboundDelivery | null> {
    return this.prisma.botChannelOutboundDelivery.findFirst({
      where: { id: deliveryId, status: "processing", processingToken },
    });
  }

  async getTurnOutcome(turnId: string): Promise<BotChannelTurnOutcome> {
    const turn = await this.prisma.conversationTurn.findUnique({
      where: { id: turnId },
      select: { status: true, errorCode: true, collaborationMode: true },
    });
    if (
      !turn ||
      !["completed", "failed", "interrupted"].includes(turn.status)
    ) {
      return { status: "running" };
    }
    if (turn.status !== "completed") {
      return { status: "failed", errorCode: turn.errorCode };
    }
    const event = await this.prisma.conversationEvent.findFirst({
      where: {
        turnId,
        eventType: "item/completed",
        payloadJson: {
          path: [
            "params",
            "item",
            turn.collaborationMode === "plan" ? "type" : "phase",
          ],
          equals: turn.collaborationMode === "plan" ? "plan" : "final_answer",
        },
      },
      orderBy: [{ sequenceNo: "desc" }, { id: "desc" }],
      select: { payloadJson: true },
    });
    let messageId =
      turn.collaborationMode === "plan"
        ? nativePlanMessageId(event?.payloadJson)
        : nativeAgentMessageId(event?.payloadJson, "final_answer");
    if (!messageId && turn.collaborationMode !== "plan") {
      const unphasedEvent = await this.prisma.conversationEvent.findFirst({
        where: {
          turnId,
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
      messageId = nativeAgentMessageId(unphasedEvent?.payloadJson, null);
    }
    if (!messageId) return { status: "running" };
    const message = await this.prisma.conversationMessage.findFirst({
      where: { id: messageId, turnId, role: "assistant" },
      select: { contentText: true },
    });
    return message
      ? { status: "completed", text: message.contentText }
      : { status: "running" };
  }

  async markDeliveryChunkSent(
    deliveryId: string,
    processingToken: string,
    sentChunkCount: number,
  ): Promise<boolean> {
    const result = await this.prisma.botChannelOutboundDelivery.updateMany({
      where: {
        id: deliveryId,
        status: "processing",
        processingToken,
        sentChunkCount: { lt: sentChunkCount },
      },
      data: { sentChunkCount, lastErrorCode: null },
    });
    return result.count === 1;
  }

  async markDeliverySent(
    deliveryId: string,
    processingToken: string,
    sentAt: Date,
  ): Promise<void> {
    await this.prisma.botChannelOutboundDelivery.updateMany({
      where: { id: deliveryId, status: "processing", processingToken },
      data: {
        status: "sent",
        processingToken: null,
        sentAt,
        lastErrorCode: null,
      },
    });
  }

  async markDeliveryRetry(input: {
    deliveryId: string;
    processingToken: string;
    attempts: number;
    errorCode: string;
    nextAttemptAt: Date;
    terminal: boolean;
  }): Promise<void> {
    await this.prisma.botChannelOutboundDelivery.updateMany({
      where: {
        id: input.deliveryId,
        status: "processing",
        processingToken: input.processingToken,
      },
      data: {
        processingToken: null,
        attempts: input.attempts,
        lastErrorCode: input.errorCode,
        nextAttemptAt: input.nextAttemptAt,
        status: input.terminal ? "failed" : "pending",
      },
    });
  }

  async deferDelivery(
    deliveryId: string,
    processingToken: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.prisma.botChannelOutboundDelivery.updateMany({
      where: { id: deliveryId, status: "processing", processingToken },
      data: { status: "pending", processingToken: null, nextAttemptAt },
    });
  }

  async #filterActiveOwners(
    connections: readonly BotChannelConnection[],
  ): Promise<BotChannelConnection[]> {
    if (connections.length === 0) return [];
    const owners = await this.prisma.user.findMany({
      where: {
        id: { in: [...new Set(connections.map((item) => item.ownerId))] },
        status: "active",
      },
      select: { id: true },
    });
    const activeOwnerIds = new Set(owners.map((owner) => owner.id));
    return connections.filter((item) => activeOwnerIds.has(item.ownerId));
  }
}

function nativeAgentMessageId(
  payload: unknown,
  expectedPhase: "final_answer" | null,
): string | null {
  const root = asObject(payload);
  const item = asObject(asObject(root.params).item);
  if (
    root.method !== "item/completed" ||
    item.type !== "agentMessage" ||
    (expectedPhase === null
      ? item.phase !== null && item.phase !== undefined
      : item.phase !== expectedPhase)
  ) {
    return null;
  }
  return nativeLocalMessageId(root);
}

function nativePlanMessageId(payload: unknown): string | null {
  const root = asObject(payload);
  const item = asObject(asObject(root.params).item);
  if (root.method !== "item/completed" || item.type !== "plan") return null;
  return nativeLocalMessageId(root);
}

function nativeLocalMessageId(payload: Record<string, unknown>): string | null {
  const local = asObject(payload.local);
  return typeof local.message_id === "string" && isUuid(local.message_id)
    ? local.message_id
    : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
