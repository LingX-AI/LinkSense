import { randomUUID } from "node:crypto";
import {
  botChannelConnectionSchema,
  type BotChannelConnection,
  type BotChannelCreate,
} from "@linksense/shared";
import type { BotChannelConnection as ConnectionRow } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext, AuditService } from "../audit/service.js";
import { PrismaBotChannelRepository } from "./repository.js";
import { RedisBotChannelCoordinator } from "./coordinator.js";
import { encryptChannelCredentials, type ChannelEncryption } from "./state.js";

export class BotChannelService {
  constructor(
    private readonly repository: PrismaBotChannelRepository,
    private readonly coordinator: RedisBotChannelCoordinator,
    private readonly audit: AuditService,
    private readonly encryption: ChannelEncryption,
    private readonly runtime: { wake(): void },
    private readonly publicBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(ownerId: string): Promise<{ items: BotChannelConnection[] }> {
    return {
      items: (await this.repository.listForOwner(ownerId)).map((row) =>
        this.#project(row),
      ),
    };
  }

  async create(
    ownerId: string,
    input: BotChannelCreate,
    context: AuditContext,
  ): Promise<BotChannelConnection> {
    const id = randomUUID();
    const normalized =
      input.provider === "teams"
        ? {
            ...input,
            client_id: input.client_id.toLowerCase(),
            tenant_id: input.tenant_id.toLowerCase(),
            allowed_sender_id: input.allowed_sender_id.toLowerCase(),
          }
        : input;
    let row: ConnectionRow;
    try {
      row = await this.repository.createConnection({
        id,
        ownerId,
        provider: normalized.provider,
        externalId:
          normalized.provider === "wecom"
            ? normalized.bot_id
            : normalized.client_id,
        allowedSenderId: normalized.allowed_sender_id,
        allowGroupMessages: normalized.allow_group_messages,
        encryptedCredentials: encryptChannelCredentials(
          id,
          normalized,
          this.encryption,
        ),
        encryptionKeyId: this.encryption.keyId,
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2002")
        throw new AppError("BOT_CHANNEL_CONNECTION_CONFLICT");
      throw error;
    }
    await this.audit.write({
      ...context,
      actorId: ownerId,
      action: "bot_channel_connected",
      targetType: "bot_channel_connection",
      targetId: id,
      result: "success",
      metadata: { provider: input.provider },
    });
    this.runtime.wake();
    return this.#project(row);
  }

  async delete(
    ownerId: string,
    id: string,
    context: AuditContext,
  ): Promise<void> {
    const row = await this.repository.findConnectionForOwner(ownerId, id);
    if (!row) throw new AppError("NOT_FOUND");
    const lease = await this.coordinator.acquireLease("connection", id, 30_000);
    if (!lease) throw new AppError("BOT_CHANNEL_BUSY");
    try {
      if (!(await this.repository.deleteConnection(ownerId, id)))
        throw new AppError("NOT_FOUND");
    } finally {
      await this.coordinator.releaseLease(lease);
    }
    await this.audit.write({
      ...context,
      actorId: ownerId,
      action: "bot_channel_disconnected",
      targetType: "bot_channel_connection",
      targetId: id,
      result: "success",
      metadata: { provider: row.provider },
    });
    this.runtime.wake();
  }

  #project(row: ConnectionRow): BotChannelConnection {
    const online =
      row.lastConnectedAt !== null &&
      (row.provider === "teams" ||
        this.now().getTime() - row.lastConnectedAt.getTime() < 90_000);
    return botChannelConnectionSchema.parse({
      id: row.id,
      provider: row.provider,
      account_hint: row.externalId,
      allowed_sender_id: row.allowedSenderId,
      allow_group_messages: row.allowGroupMessages,
      runtime_status: row.lastErrorCode
        ? "error"
        : online
          ? "online"
          : row.provider === "teams"
            ? "waiting_message"
            : "connecting",
      last_connected_at: row.lastConnectedAt?.toISOString() ?? null,
      last_inbound_at: row.lastInboundAt?.toISOString() ?? null,
      last_error_code: row.lastErrorCode,
      callback_url:
        row.provider === "teams"
          ? new URL(
              `/api/v1/bot-channels/teams/${row.id}/messages`,
              this.publicBaseUrl,
            ).href
          : null,
      created_at: row.createdAt.toISOString(),
    });
  }
}
