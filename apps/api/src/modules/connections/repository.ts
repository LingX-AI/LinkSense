import { randomUUID } from "node:crypto";
import { connectionProviderSchema, type ConnectionProvider } from "@linksense/shared";
import type { PrismaClient, UserConnection } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

export type ConnectionRecord = UserConnection;
export type ConnectionWrite = Pick<
  ConnectionRecord,
  | "status"
  | "enabled"
  | "accountName"
  | "encryptedPayload"
  | "encryptionKeyId"
  | "revision"
  | "connectedAt"
>;
export interface ConnectionRepository {
  list(ownerId: string): Promise<ConnectionRecord[]>;
  get(ownerId: string, provider: ConnectionProvider): Promise<ConnectionRecord | null>;
  authVersion(ownerId: string): Promise<string>;
  mutate(
    ownerId: string,
    provider: ConnectionProvider,
    transform: (row: ConnectionRecord | null) => Promise<ConnectionWrite>,
  ): Promise<ConnectionRecord>;
  assertTurn(ownerId: string, conversationId: string, turnId: string, write?: boolean): Promise<void>;
}

export class PrismaConnectionRepository implements ConnectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listAvailableProviders(ownerId: string): Promise<ConnectionProvider[]> {
    const rows = await this.prisma.userConnection.findMany({
      where: { ownerId, status: "connected", encryptedPayload: { not: null } },
      select: { provider: true },
      orderBy: { provider: "asc" },
    });
    return rows.map((row) => connectionProviderSchema.parse(row.provider));
  }

  list(ownerId: string): Promise<ConnectionRecord[]> {
    return this.prisma.userConnection.findMany({
      where: { ownerId },
      orderBy: { provider: "asc" },
    });
  }
  get(ownerId: string, provider: ConnectionProvider): Promise<ConnectionRecord | null> {
    return this.prisma.userConnection.findUnique({
      where: { ownerId_provider: { ownerId, provider } },
    });
  }
  async authVersion(ownerId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { status: true, role: true, authValidAfter: true },
    });
    if (!user || user.status !== "active" || !["admin", "user"].includes(user.role))
      throw new AppError("FORBIDDEN");
    return user.authValidAfter.toISOString();
  }
  mutate(
    ownerId: string,
    provider: ConnectionProvider,
    transform: (row: ConnectionRecord | null) => Promise<ConnectionWrite>,
  ): Promise<ConnectionRecord> {
    // Serializes refresh, callback and disconnect across API workers. No refresh
    // token can be rotated twice concurrently or resurrected after disconnect.
    return this.prisma.$transaction(
      async (tx) => {
        const key = `linksense-connection:${ownerId}:${provider}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const where = { ownerId_provider: { ownerId, provider } };
        const current = await tx.userConnection.findUnique({ where });
        const next = await transform(current);
        const data: ConnectionWrite = {
          status: next.status,
          enabled: next.enabled,
          accountName: next.accountName,
          encryptedPayload: next.encryptedPayload,
          encryptionKeyId: next.encryptionKeyId,
          revision: next.revision,
          connectedAt: next.connectedAt,
        };
        return tx.userConnection.upsert({
          where,
          create: { id: randomUUID(), ownerId, provider, ...data },
          update: data,
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }
  async assertTurn(ownerId: string, conversationId: string, turnId: string, write = false): Promise<void> {
    await this.authVersion(ownerId);
    const [conversation, turn, start, external] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id: conversationId, ownerId, archiveStatus: "active" },
        select: { id: true },
      }),
      this.prisma.conversationTurn.findUnique({
        where: { id: turnId },
        select: { conversationId: true, submittedBy: true, status: true, collaborationMode: true },
      }),
      this.prisma.conversationTurnStartIntent.findFirst({
        where: {
          projectionTurnId: turnId,
          conversationId,
          ownerId,
          runnerStatus: "runner_succeeded",
        },
        select: { projectionTurnId: true, collaborationMode: true },
      }),
      this.prisma.applicationExternalSession.findFirst({
        where: { conversationId },
        select: { id: true },
      }),
    ]);
    // External application sessions must never inherit a publisher's accounts.
    const active = turn
      ? turn.conversationId === conversationId &&
        turn.submittedBy === ownerId &&
        turn.status === "running"
      : Boolean(start);
    if (!conversation || !active || external) throw new AppError("FORBIDDEN");
    if (write && (turn?.collaborationMode ?? start?.collaborationMode) !== "default")
      throw new AppError("CONNECTION_ACCESS_DENIED");
  }
}

export function disconnectedConnection(revision: number): ConnectionWrite {
  return {
    status: "disconnected",
    enabled: false,
    accountName: null,
    encryptedPayload: null,
    encryptionKeyId: null,
    revision,
    connectedAt: null,
  };
}
