import type {
  PrismaClient,
  WeixinConnection,
  WeixinInboundMessage,
  WeixinOutboundDelivery,
  WeixinPeerSession,
} from "../../generated/prisma/client.js";

export type WeixinConnectionState = {
  token: string;
  cursor: string;
};

export type PersistedWeixinInbound = {
  id: string;
  peerUserId: string;
  messageKey: string;
  contentText: string;
  encryptedContext: string;
  encryptionKeyId: string;
  receivedAt: Date;
  sourceSequence: bigint | null;
};

export type PendingWeixinInbound = {
  connection: WeixinConnection;
  message: WeixinInboundMessage;
};

export type PendingWeixinDelivery = {
  connection: WeixinConnection;
  delivery: WeixinOutboundDelivery;
  inbound: WeixinInboundMessage;
};

export type WeixinTurnOutcome =
  | { status: "running" }
  | { status: "completed"; text: string | null }
  | { status: "failed"; errorCode: string | null };

type ReplaceWeixinConnectionInput = {
  id: string;
  ownerId: string;
  applicationId: string | null;
  applicationName: string | null;
  ilinkBotId: string;
  ilinkUserId: string;
  apiBaseUrl: string;
  encryptedState: string;
  encryptionKeyId: string;
  drainedConnectionId?: string;
};

export class WeixinConnectionDisconnectingError extends Error {
  constructor() {
    super("WEIXIN_CONNECTION_DISCONNECTING");
    this.name = "WeixinConnectionDisconnectingError";
  }
}

export class PrismaWeixinRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findConnectionByOwner(ownerId: string): Promise<WeixinConnection | null> {
    return this.prisma.weixinConnection.findUnique({ where: { ownerId } });
  }

  findConnectionForOwner(
    ownerId: string,
    connectionId: string,
  ): Promise<WeixinConnection | null> {
    return this.prisma.weixinConnection.findFirst({
      where: { id: connectionId, ownerId },
    });
  }

  async listActiveConnections(limit = 200): Promise<WeixinConnection[]> {
    const activeIds = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c."id"
      FROM "weixin_connections" c
      INNER JOIN "users" u ON u."id" = c."owner_id"
      WHERE c."status" = 'active' AND u."status" = 'active'
      ORDER BY c."updated_at" ASC, c."id" ASC
      LIMIT ${limit}
    `;
    if (activeIds.length === 0) return [];
    const connections = await this.prisma.weixinConnection.findMany({
      where: {
        id: { in: activeIds.map((item) => item.id) },
        status: "active",
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    });
    return this.#filterActiveOwners(connections);
  }

  async findActiveConnection(
    connectionId: string,
  ): Promise<WeixinConnection | null> {
    const connection = await this.prisma.weixinConnection.findFirst({
      where: { id: connectionId, status: "active" },
    });
    if (!connection) return null;
    const [active] = await this.#filterActiveOwners([connection]);
    return active ?? null;
  }

  async replaceConnection(
    input: ReplaceWeixinConnectionInput,
  ): Promise<WeixinConnection> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "weixin_connections"
        WHERE "owner_id" = ${input.ownerId}::uuid
        FOR UPDATE
      `;
      const current = await tx.weixinConnection.findUnique({
        where: { ownerId: input.ownerId },
        select: { id: true, status: true },
      });
      if (!current) {
        if (input.drainedConnectionId) {
          throw new WeixinConnectionDisconnectingError();
        }
        return tx.weixinConnection.create({
          data: {
            ...connectionCreateData(input),
            status: "active",
          },
        });
      }
      if (
        current.status !== "disconnecting" ||
        current.id !== input.drainedConnectionId
      ) {
        throw new WeixinConnectionDisconnectingError();
      }

      await tx.weixinOutboundDelivery.deleteMany({
        where: { connectionId: current.id },
      });
      await tx.weixinInboundMessage.deleteMany({
        where: { connectionId: current.id },
      });
      await tx.weixinPeerSession.deleteMany({
        where: { connectionId: current.id },
      });
      await tx.weixinConnection.delete({ where: { id: current.id } });
      return tx.weixinConnection.create({
        data: {
          ...connectionCreateData(input),
          status: "active",
        },
      });
    });
  }

  async updateConnectionApplication(input: {
    id: string;
    applicationId: string | null;
    applicationName: string | null;
  }): Promise<WeixinConnection> {
    const updated = await this.prisma.weixinConnection.updateMany({
      where: {
        id: input.id,
        status: { in: ["active", "reauthorization_required"] },
      },
      data: {
        applicationId: input.applicationId,
        applicationName: input.applicationName,
      },
    });
    if (updated.count === 0) throw new WeixinConnectionDisconnectingError();
    const connection = await this.prisma.weixinConnection.findUnique({
      where: { id: input.id },
    });
    if (!connection) throw new WeixinConnectionDisconnectingError();
    return connection;
  }

  async reactivateConnection(input: {
    id: string;
    applicationId: string | null;
    applicationName: string | null;
  }): Promise<WeixinConnection> {
    const updated = await this.prisma.weixinConnection.updateMany({
      where: {
        id: input.id,
        status: { in: ["active", "reauthorization_required"] },
      },
      data: {
        applicationId: input.applicationId,
        applicationName: input.applicationName,
        status: "active",
        lastErrorCode: null,
        lastErrorAt: null,
      },
    });
    if (updated.count === 0) throw new WeixinConnectionDisconnectingError();
    const connection = await this.prisma.weixinConnection.findUnique({
      where: { id: input.id },
    });
    if (!connection) throw new WeixinConnectionDisconnectingError();
    return connection;
  }

  async deleteConnection(ownerId: string, connectionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.weixinConnection.findFirst({
        where: { id: connectionId, ownerId, status: "disconnecting" },
        select: { id: true },
      });
      if (!deleted) return;
      await tx.weixinOutboundDelivery.deleteMany({
        where: { connectionId },
      });
      await tx.weixinInboundMessage.deleteMany({ where: { connectionId } });
      await tx.weixinPeerSession.deleteMany({ where: { connectionId } });
      await tx.weixinConnection.delete({ where: { id: connectionId } });
    });
  }

  async markConnectionDisconnecting(
    ownerId: string,
    connectionId: string,
  ): Promise<boolean> {
    const result = await this.prisma.weixinConnection.updateMany({
      where: {
        id: connectionId,
        ownerId,
        status: { in: ["active", "reauthorization_required"] },
      },
      data: { status: "disconnecting" },
    });
    return result.count === 1;
  }

  async restoreConnectionStatus(
    ownerId: string,
    connectionId: string,
    status: string,
  ): Promise<void> {
    await this.prisma.weixinConnection.updateMany({
      where: { id: connectionId, ownerId, status: "disconnecting" },
      data: { status },
    });
  }

  async persistPoll(input: {
    connectionId: string;
    expectedEncryptedState: string;
    encryptedState: string;
    encryptionKeyId: string;
    messages: readonly PersistedWeixinInbound[];
    polledAt: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.weixinConnection.findUnique({
        where: { id: input.connectionId },
        select: {
          encryptedState: true,
          nextIngestOrder: true,
          status: true,
        },
      });
      if (
        !current ||
        current.status !== "active" ||
        current.encryptedState !== input.expectedEncryptedState
      ) {
        return false;
      }
      const updated = await tx.weixinConnection.updateMany({
        where: {
          id: input.connectionId,
          status: "active",
          encryptedState: input.expectedEncryptedState,
        },
        data: {
          encryptedState: input.encryptedState,
          encryptionKeyId: input.encryptionKeyId,
          lastPollAt: input.polledAt,
          ...(input.messages.length > 0
            ? {
                lastInboundAt: input.messages.reduce(
                  (latest, message) =>
                    message.receivedAt > latest
                      ? message.receivedAt
                      : latest,
                  input.messages[0]?.receivedAt ?? input.polledAt,
                ),
              }
            : {}),
          lastErrorAt: null,
          lastErrorCode: null,
          nextIngestOrder: {
            increment: BigInt(input.messages.length),
          },
        },
      });
      if (updated.count === 0) return false;
      if (input.messages.length > 0) {
        await tx.weixinInboundMessage.createMany({
          data: input.messages.map((message, index) => ({
            ...message,
            connectionId: input.connectionId,
            status: "pending",
            ingestOrder: current.nextIngestOrder + BigInt(index + 1),
          })),
          skipDuplicates: true,
        });
      }
      return true;
    });
  }

  async recordConnectionError(
    connectionId: string,
    errorCode: string,
    occurredAt: Date,
  ): Promise<void> {
    await this.prisma.weixinConnection.updateMany({
      where: { id: connectionId, status: "active" },
      data: { lastErrorCode: errorCode, lastErrorAt: occurredAt },
    });
  }

  async requireReauthorization(
    connectionId: string,
    occurredAt: Date,
  ): Promise<void> {
    await this.prisma.weixinConnection.updateMany({
      where: { id: connectionId, status: "active" },
      data: {
        status: "reauthorization_required",
        lastErrorCode: "WEIXIN_CREDENTIAL_EXPIRED",
        lastErrorAt: occurredAt,
      },
    });
  }

  async listPendingInbound(
    now: Date,
    limit: number,
  ): Promise<PendingWeixinInbound[]> {
    const connections = await this.listActiveConnections(500);
    if (connections.length === 0) return [];
    const messages = await this.prisma.weixinInboundMessage.findMany({
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
  ): Promise<WeixinInboundMessage | null> {
    const claimed = await this.prisma.weixinInboundMessage.updateMany({
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
    return this.prisma.weixinInboundMessage.findFirst({
      where: { id: messageId, status: "processing", processingToken },
    });
  }

  async findClaimedInbound(
    messageId: string,
    processingToken: string,
  ): Promise<WeixinInboundMessage | null> {
    return this.prisma.weixinInboundMessage.findFirst({
      where: { id: messageId, status: "processing", processingToken },
    });
  }

  async hasEarlierPendingMessage(message: WeixinInboundMessage): Promise<boolean> {
    return (
      (await this.prisma.weixinInboundMessage.count({
        where: {
          connectionId: message.connectionId,
          peerUserId: message.peerUserId,
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
    const result = await this.prisma.weixinInboundMessage.updateMany({
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
    const result = await this.prisma.weixinInboundMessage.updateMany({
      where: {
        id: messageId,
        status: "processing",
        processingToken,
      },
      data: { peerSessionId: null, conversationId: null },
    });
    return result.count === 1;
  }

  findPeerSession(
    connectionId: string,
    peerUserId: string,
  ): Promise<WeixinPeerSession | null> {
    return this.prisma.weixinPeerSession.findUnique({
      where: {
        connectionId_peerUserId: { connectionId, peerUserId },
      },
    });
  }

  async conversationIsAvailable(
    ownerId: string,
    conversationId: string,
  ): Promise<boolean> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ownerId,
        archiveStatus: "active",
      },
      select: { id: true },
    });
    return conversation !== null;
  }

  upsertPeerSession(input: {
    id: string;
    connectionId: string;
    peerUserId: string;
    conversationId: string;
    applicationIdSnapshot: string | null;
    encryptedContext: string;
    encryptionKeyId: string;
    lastInboundAt: Date;
  }): Promise<WeixinPeerSession> {
    const key = {
      connectionId: input.connectionId,
      peerUserId: input.peerUserId,
    };
    return this.prisma.weixinPeerSession.upsert({
      where: { connectionId_peerUserId: key },
      create: input,
      update: {
        conversationId: input.conversationId,
        applicationIdSnapshot: input.applicationIdSnapshot,
        encryptedContext: input.encryptedContext,
        encryptionKeyId: input.encryptionKeyId,
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

  async hasUnsentDeliveryForPeer(
    connectionId: string,
    peerUserId: string,
  ): Promise<boolean> {
    const peer = await this.prisma.weixinPeerSession.findUnique({
      where: {
        connectionId_peerUserId: { connectionId, peerUserId },
      },
      select: { id: true },
    });
    if (!peer) return false;
    return (
      (await this.prisma.weixinOutboundDelivery.count({
        where: {
          connectionId,
          peerSessionId: peer.id,
          status: { in: ["pending", "processing"] },
        },
      })) > 0
    );
  }

  async getOwnerLocale(ownerId: string): Promise<"zh-CN" | "en-US"> {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { preferredLocale: true },
    });
    return owner?.preferredLocale === "en-US" ? "en-US" : "zh-CN";
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
      const updated = await tx.weixinInboundMessage.updateMany({
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
      await tx.weixinOutboundDelivery.create({
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
    await this.prisma.weixinInboundMessage.updateMany({
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
    await this.prisma.weixinInboundMessage.updateMany({
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
    await this.prisma.weixinInboundMessage.updateMany({
      where: { id: messageId, status: "processing", processingToken },
      data: { status: "pending", processingToken: null, nextAttemptAt },
    });
  }

  async listPendingDeliveries(
    now: Date,
    limit: number,
  ): Promise<PendingWeixinDelivery[]> {
    const connections = await this.listActiveConnections(500);
    if (connections.length === 0) return [];
    const deliveries = await this.prisma.weixinOutboundDelivery.findMany({
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
    const inboundIds = [
      ...new Set(deliveries.map((item) => item.inboundMessageId)),
    ];
    const inboundMessages = await this.prisma.weixinInboundMessage.findMany({
      where: { id: { in: inboundIds } },
    });
    const connectionsById = new Map(connections.map((item) => [item.id, item]));
    const inboundById = new Map(inboundMessages.map((item) => [item.id, item]));
    return deliveries.flatMap((delivery) => {
      const connection = connectionsById.get(delivery.connectionId);
      const inbound = inboundById.get(delivery.inboundMessageId);
      return connection && inbound ? [{ connection, delivery, inbound }] : [];
    });
  }

  async claimDelivery(
    deliveryId: string,
    processingToken: string,
    claimedAt: Date,
    claimExpiresAt: Date,
  ): Promise<WeixinOutboundDelivery | null> {
    const claimed = await this.prisma.weixinOutboundDelivery.updateMany({
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
    return this.prisma.weixinOutboundDelivery.findFirst({
      where: { id: deliveryId, status: "processing", processingToken },
    });
  }

  async findClaimedDelivery(
    deliveryId: string,
    processingToken: string,
  ): Promise<WeixinOutboundDelivery | null> {
    return this.prisma.weixinOutboundDelivery.findFirst({
      where: { id: deliveryId, status: "processing", processingToken },
    });
  }

  async getTurnOutcome(turnId: string): Promise<WeixinTurnOutcome> {
    const turn = await this.prisma.conversationTurn.findUnique({
      where: { id: turnId },
      select: { status: true, errorCode: true, collaborationMode: true },
    });
    if (!turn) return { status: "running" };
    if (turn.status === "failed" || turn.status === "interrupted") {
      return { status: "failed", errorCode: turn?.errorCode ?? null };
    }
    if (turn.status !== "completed") return { status: "running" };
    const finalAnswerEvent = await this.prisma.conversationEvent.findFirst({
      where: {
        turnId,
        eventType: "item/completed",
        payloadJson: {
          path: ["params", "item", "phase"],
          equals: "final_answer",
        },
      },
      orderBy: [{ sequenceNo: "desc" }, { id: "desc" }],
      select: { payloadJson: true },
    });
    const finalAnswerMessageId = nativeFinalAnswerMessageId(
      finalAnswerEvent?.payloadJson,
    );
    if (finalAnswerMessageId) {
      const finalAnswer = await this.prisma.conversationMessage.findFirst({
        where: { id: finalAnswerMessageId, turnId, role: "assistant" },
        select: { contentText: true },
      });
      if (finalAnswer) {
        return { status: "completed", text: finalAnswer.contentText };
      }
    }
    if (turn.collaborationMode === "plan") {
      const planEvent = await this.prisma.conversationEvent.findFirst({
        where: {
          turnId,
          eventType: "item/completed",
          payloadJson: {
            path: ["params", "item", "type"],
            equals: "plan",
          },
        },
        orderBy: [{ sequenceNo: "desc" }, { id: "desc" }],
        select: { payloadJson: true },
      });
      const planMessageId = nativePlanMessageId(planEvent?.payloadJson);
      if (planMessageId) {
        const planMessage = await this.prisma.conversationMessage.findFirst({
          where: { id: planMessageId, turnId, role: "assistant" },
          select: { contentText: true },
        });
        if (planMessage) {
          return { status: "completed", text: planMessage.contentText };
        }
      }
    }
    return { status: "running" };
  }

  async markDeliveryChunkSent(
    deliveryId: string,
    processingToken: string,
    sentChunkCount: number,
  ): Promise<boolean> {
    const result = await this.prisma.weixinOutboundDelivery.updateMany({
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
    await this.prisma.weixinOutboundDelivery.updateMany({
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
    await this.prisma.weixinOutboundDelivery.updateMany({
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
    await this.prisma.weixinOutboundDelivery.updateMany({
      where: { id: deliveryId, status: "processing", processingToken },
      data: { status: "pending", processingToken: null, nextAttemptAt },
    });
  }

  async #filterActiveOwners(
    connections: readonly WeixinConnection[],
  ): Promise<WeixinConnection[]> {
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

function connectionCreateData(input: ReplaceWeixinConnectionInput) {
  return {
    id: input.id,
    ownerId: input.ownerId,
    applicationId: input.applicationId,
    applicationName: input.applicationName,
    ilinkBotId: input.ilinkBotId,
    ilinkUserId: input.ilinkUserId,
    apiBaseUrl: input.apiBaseUrl,
    encryptedState: input.encryptedState,
    encryptionKeyId: input.encryptionKeyId,
  };
}

function nativeFinalAnswerMessageId(payload: unknown): string | null {
  const root = asObject(payload);
  const params = asObject(root.params);
  const item = asObject(params.item);
  if (
    root.source !== "codex_app_server" ||
    root.method !== "item/completed" ||
    item.type !== "agentMessage" ||
    item.phase !== "final_answer"
  ) {
    return null;
  }
  return nativeLocalMessageId(root);
}

function nativePlanMessageId(payload: unknown): string | null {
  const root = asObject(payload);
  const params = asObject(root.params);
  const item = asObject(params.item);
  if (
    root.source !== "codex_app_server" ||
    root.method !== "item/completed" ||
    item.type !== "plan"
  ) {
    return null;
  }
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
