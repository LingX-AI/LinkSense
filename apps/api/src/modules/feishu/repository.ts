import { Prisma } from "../../generated/prisma/client.js";
import { isLocale, type Locale } from "@linksense/shared";
import type {
  FeishuAppBinding,
  FeishuConnection,
  FeishuInboundMessage,
  FeishuOutboundDelivery,
  FeishuPeerSession,
  PrismaClient,
} from "../../generated/prisma/client.js";

export type PendingFeishuInbound = {
  connection: FeishuConnection;
  message: FeishuInboundMessage;
};

export type PendingFeishuDelivery = {
  connection: FeishuConnection;
  delivery: FeishuOutboundDelivery;
  inbound: FeishuInboundMessage;
};

export type FeishuTurnOutcome =
  | { status: "running" }
  | { status: "completed"; text: string | null }
  | { status: "failed"; errorCode: string | null };

type DisconnectableFeishuConnectionStatus =
  | "active"
  | "reauthorization_required";

type ReplaceFeishuConnectionInput = {
  id: string;
  ownerId: string;
  appId: string;
  ownerOpenId: string;
  domain: string;
  encryptedCredentials: string;
  encryptionKeyId: string;
};

export class FeishuConnectionConflictError extends Error {
  constructor() {
    super("FEISHU_CONNECTION_CONFLICT");
    this.name = "FeishuConnectionConflictError";
  }
}

export class PrismaFeishuRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findConnectionByOwner(ownerId: string): Promise<FeishuConnection | null> {
    return this.prisma.feishuConnection.findUnique({ where: { ownerId } });
  }

  findAppBindingByOwner(ownerId: string): Promise<FeishuAppBinding | null> {
    return this.prisma.feishuAppBinding.findUnique({ where: { ownerId } });
  }

  findConnectionForOwner(
    ownerId: string,
    connectionId: string,
  ): Promise<FeishuConnection | null> {
    return this.prisma.feishuConnection.findFirst({
      where: { id: connectionId, ownerId },
    });
  }

  async listActiveConnections(limit = 200): Promise<FeishuConnection[]> {
    const activeIds = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c."id"
      FROM "feishu_connections" c
      INNER JOIN "users" u ON u."id" = c."owner_id"
      WHERE
        u."status" = 'active'
        AND (
          c."status" = 'active'
          OR (
            c."status" = 'reauthorization_required'
            AND (
              c."last_error_at" IS NULL
              OR c."last_error_at" <= CURRENT_TIMESTAMP - INTERVAL '5 seconds'
            )
          )
        )
      ORDER BY c."updated_at" ASC, c."id" ASC
      LIMIT ${limit}
    `;
    if (activeIds.length === 0) return [];
    const connections = await this.prisma.feishuConnection.findMany({
      where: {
        id: { in: activeIds.map((item) => item.id) },
        status: { in: ["active", "reauthorization_required"] },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    });
    return this.#filterActiveOwners(connections);
  }

  async findActiveConnection(
    connectionId: string,
  ): Promise<FeishuConnection | null> {
    const connection = await this.prisma.feishuConnection.findFirst({
      where: {
        id: connectionId,
        status: { in: ["active", "reauthorization_required"] },
      },
    });
    if (!connection) return null;
    const [active] = await this.#filterActiveOwners([connection]);
    return active ?? null;
  }

  async replaceConnection(
    input: ReplaceFeishuConnectionInput,
  ): Promise<FeishuConnection> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "users"
        WHERE "id" = ${input.ownerId}::uuid
        FOR UPDATE
      `;
      const current = await tx.feishuConnection.findUnique({
        where: { ownerId: input.ownerId },
        select: { id: true, status: true },
      });
      if (current?.status === "disconnecting") {
        throw new FeishuConnectionConflictError();
      }
      if (current) {
        await tx.feishuOutboundDelivery.deleteMany({
          where: { connectionId: current.id },
        });
        await tx.feishuInboundMessage.deleteMany({
          where: { connectionId: current.id },
        });
        await tx.feishuPeerSession.deleteMany({
          where: { connectionId: current.id },
        });
        await tx.feishuConnection.delete({ where: { id: current.id } });
      }
      await tx.feishuAppBinding.upsert({
        where: { ownerId: input.ownerId },
        create: {
          ownerId: input.ownerId,
          appId: input.appId,
          ownerOpenId: input.ownerOpenId,
          domain: input.domain,
        },
        update: {
          appId: input.appId,
          ownerOpenId: input.ownerOpenId,
          domain: input.domain,
        },
      });
      return tx.feishuConnection.create({
        data: { ...input, status: "active" },
      });
    });
  }

  async markConnectionDisconnecting(
    ownerId: string,
    connectionId: string,
    expectedStatus: DisconnectableFeishuConnectionStatus,
  ): Promise<boolean> {
    const result = await this.prisma.feishuConnection.updateMany({
      where: { id: connectionId, ownerId, status: expectedStatus },
      data: { status: "disconnecting" },
    });
    return result.count === 1;
  }

  async restoreConnectionStatus(
    ownerId: string,
    connectionId: string,
    status: DisconnectableFeishuConnectionStatus,
  ): Promise<void> {
    await this.prisma.feishuConnection.updateMany({
      where: { id: connectionId, ownerId, status: "disconnecting" },
      data: { status },
    });
  }

  async deleteConnection(ownerId: string, connectionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const connection = await tx.feishuConnection.findFirst({
        where: { id: connectionId, ownerId, status: "disconnecting" },
        select: { id: true },
      });
      if (!connection) return;
      await tx.feishuOutboundDelivery.deleteMany({ where: { connectionId } });
      await tx.feishuInboundMessage.deleteMany({ where: { connectionId } });
      await tx.feishuPeerSession.deleteMany({ where: { connectionId } });
      await tx.feishuConnection.delete({ where: { id: connectionId } });
    });
  }

  async markConnected(
    connectionId: string,
    botName: string | null,
    connectedAt: Date,
  ): Promise<void> {
    await this.prisma.feishuConnection.updateMany({
      where: {
        id: connectionId,
        status: { in: ["active", "reauthorization_required"] },
      },
      data: {
        status: "active",
        ...(botName ? { botName } : {}),
        lastConnectedAt: connectedAt,
        lastErrorCode: null,
        lastErrorAt: null,
      },
    });
  }

  async recordConnectionError(
    connectionId: string,
    errorCode: string,
    occurredAt: Date,
  ): Promise<void> {
    await this.prisma.feishuConnection.updateMany({
      where: { id: connectionId, status: "active" },
      data: { lastErrorCode: errorCode, lastErrorAt: occurredAt },
    });
  }

  async markApprovalPending(
    connectionId: string,
    errorCode: string,
    occurredAt: Date,
  ): Promise<void> {
    await this.prisma.feishuConnection.updateMany({
      where: {
        id: connectionId,
        status: { in: ["active", "reauthorization_required"] },
      },
      data: {
        status: "reauthorization_required",
        lastErrorCode: errorCode,
        lastErrorAt: occurredAt,
      },
    });
  }

  async persistInbound(input: {
    id: string;
    connectionId: string;
    messageKey: string;
    chatId: string;
    senderOpenId: string;
    contentText: string;
    receivedAt: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.feishuInboundMessage.findUnique({
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
        UPDATE "feishu_connections"
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
      const created = await tx.feishuInboundMessage.createMany({
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
  ): Promise<PendingFeishuInbound[]> {
    const connections = await this.listActiveConnections(500);
    if (connections.length === 0) return [];
    const messages = await this.prisma.feishuInboundMessage.findMany({
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
  ): Promise<FeishuInboundMessage | null> {
    const claimed = await this.prisma.feishuInboundMessage.updateMany({
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
    return this.prisma.feishuInboundMessage.findFirst({
      where: { id: messageId, status: "processing", processingToken },
    });
  }

  findClaimedInbound(
    messageId: string,
    processingToken: string,
  ): Promise<FeishuInboundMessage | null> {
    return this.prisma.feishuInboundMessage.findFirst({
      where: { id: messageId, status: "processing", processingToken },
    });
  }

  async hasEarlierPendingMessage(
    message: FeishuInboundMessage,
  ): Promise<boolean> {
    return (
      (await this.prisma.feishuInboundMessage.count({
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
    const result = await this.prisma.feishuInboundMessage.updateMany({
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
    const result = await this.prisma.feishuInboundMessage.updateMany({
      where: { id: messageId, status: "processing", processingToken },
      data: { peerSessionId: null, conversationId: null },
    });
    return result.count === 1;
  }

  findPeerSession(
    connectionId: string,
    chatId: string,
  ): Promise<FeishuPeerSession | null> {
    return this.prisma.feishuPeerSession.findUnique({
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
    senderOpenId: string;
    conversationId: string;
    lastInboundAt: Date;
  }): Promise<FeishuPeerSession> {
    return this.prisma.feishuPeerSession.upsert({
      where: {
        connectionId_chatId: {
          connectionId: input.connectionId,
          chatId: input.chatId,
        },
      },
      create: input,
      update: {
        senderOpenId: input.senderOpenId,
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
      (await this.prisma.feishuOutboundDelivery.count({
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
      const updated = await tx.feishuInboundMessage.updateMany({
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
      await tx.feishuOutboundDelivery.create({
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
    await this.prisma.feishuInboundMessage.updateMany({
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
    await this.prisma.feishuInboundMessage.updateMany({
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
    await this.prisma.feishuInboundMessage.updateMany({
      where: { id: messageId, status: "processing", processingToken },
      data: { status: "pending", processingToken: null, nextAttemptAt },
    });
  }

  async listPendingDeliveries(
    now: Date,
    limit: number,
  ): Promise<PendingFeishuDelivery[]> {
    const connections = await this.listActiveConnections(500);
    if (connections.length === 0) return [];
    const deliveries = await this.prisma.feishuOutboundDelivery.findMany({
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
    const inbound = await this.prisma.feishuInboundMessage.findMany({
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
  ): Promise<FeishuOutboundDelivery | null> {
    const claimed = await this.prisma.feishuOutboundDelivery.updateMany({
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
    return this.prisma.feishuOutboundDelivery.findFirst({
      where: { id: deliveryId, status: "processing", processingToken },
    });
  }

  findClaimedDelivery(
    deliveryId: string,
    processingToken: string,
  ): Promise<FeishuOutboundDelivery | null> {
    return this.prisma.feishuOutboundDelivery.findFirst({
      where: { id: deliveryId, status: "processing", processingToken },
    });
  }

  async getTurnOutcome(turnId: string): Promise<FeishuTurnOutcome> {
    const turn = await this.prisma.conversationTurn.findUnique({
      where: { id: turnId },
      select: { status: true, errorCode: true, collaborationMode: true },
    });
    if (!turn || !["completed", "failed", "interrupted"].includes(turn.status)) {
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
    const result = await this.prisma.feishuOutboundDelivery.updateMany({
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
    await this.prisma.feishuOutboundDelivery.updateMany({
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
    await this.prisma.feishuOutboundDelivery.updateMany({
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
    await this.prisma.feishuOutboundDelivery.updateMany({
      where: { id: deliveryId, status: "processing", processingToken },
      data: { status: "pending", processingToken: null, nextAttemptAt },
    });
  }

  async #filterActiveOwners(
    connections: readonly FeishuConnection[],
  ): Promise<FeishuConnection[]> {
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
