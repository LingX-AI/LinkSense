import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  botChannelAdminConnectionSchema,
  botChannelConnectionSchema,
  botChannelCredentialsSchema,
  botChannelRegistrationSchema,
  type BotChannelAdminConnection,
  type BotChannelAdminCreate,
  type BotChannelConnection,
  type BotChannelCredentials,
  type BotChannelRegistration,
  type BotChannelLinkingSession,
} from "@linksense/shared";
import type { BotChannelConnection as ConnectionRow } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext, AuditService } from "../audit/service.js";
import { PrismaBotChannelRepository } from "./repository.js";
import { RedisBotChannelCoordinator } from "./coordinator.js";
import { encryptChannelCredentials, type ChannelEncryption } from "./state.js";
import { BotChannelIdentityService } from "./identity.js";
import { DingtalkRegistrationClient } from "./dingtalk-registration-client.js";

const registrationState = botChannelRegistrationSchema.extend({
  ownerId: z.uuid(),
  deviceCode: z.string().min(1).max(4096),
  interval: z.number().int().positive(),
  nextPollAt: z.number().finite(),
  allowGroupMessages: z.boolean(),
});
type RegistrationState = z.infer<typeof registrationState>;
export class BotChannelService {
  constructor(
    private readonly repository: PrismaBotChannelRepository,
    private readonly coordinator: RedisBotChannelCoordinator,
    private readonly audit: AuditService,
    private readonly encryption: ChannelEncryption,
    private readonly runtime: { wake(): void },
    private readonly publicBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
    private readonly registrationClient: Pick<
      DingtalkRegistrationClient,
      "begin" | "poll"
    > = new DingtalkRegistrationClient(),
  ) {}
  issueLinking(ownerId: string, id: string): Promise<BotChannelLinkingSession> {
    return new BotChannelIdentityService(
      this.repository,
      this.coordinator,
      this.now,
    ).issue(ownerId, id);
  }
  unlink(ownerId: string, id: string): Promise<void> {
    return new BotChannelIdentityService(
      this.repository,
      this.coordinator,
      this.now,
    ).unlink(ownerId, id);
  }
  async list(ownerId: string): Promise<{ items: BotChannelConnection[] }> {
    const [rows, linked] = await Promise.all([
      this.repository.listForOwner(ownerId),
      this.repository.linkedConnectionIds(ownerId),
    ]);
    return { items: rows.map((row) => this.#project(row, linked.has(row.id))) };
  }
  async listOrganization(): Promise<{ items: BotChannelAdminConnection[] }> {
    return {
      items: (await this.repository.listOrganizationConnections()).map((row) =>
        this.#projectAdmin(row),
      ),
    };
  }
  async createOrganization(
    actorId: string,
    input: BotChannelAdminCreate,
    context: AuditContext,
  ): Promise<BotChannelAdminConnection> {
    const { allow_group_messages: groups, ...credentials } = input;
    return this.#projectAdmin(
      await this.#create(actorId, null, credentials, groups, context),
    );
  }
  async #create(
    actorId: string,
    ownerId: string | null,
    credentials: BotChannelCredentials,
    groups: boolean,
    context: AuditContext,
    id: string = randomUUID(),
  ): Promise<ConnectionRow> {
    const normalized =
      credentials.provider === "teams"
        ? {
            ...credentials,
            client_id: credentials.client_id.toLowerCase(),
            tenant_id: credentials.tenant_id.toLowerCase(),
          }
        : credentials;
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
        allowGroupMessages: groups,
        encryptedCredentials: encryptChannelCredentials(
          id,
          botChannelCredentialsSchema.parse(normalized),
          this.encryption,
        ),
        encryptionKeyId: this.encryption.keyId,
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2002")
        throw new AppError("BOT_CHANNEL_CONNECTION_CONFLICT");
      throw error;
    }
    await this.#audit(actorId, row, "bot_channel_connected", context);
    this.runtime.wake();
    return row;
  }
  async deletePersonal(
    ownerId: string,
    id: string,
    context: AuditContext,
  ): Promise<void> {
    const row = await this.repository.findConnectionForOwner(ownerId, id);
    if (!row || row.provider !== "dingtalk") throw new AppError("NOT_FOUND");
    await this.coordinator.cancelRegistration(ownerId);
    await this.#delete(ownerId, row, context);
  }
  async deleteOrganization(
    actorId: string,
    id: string,
    context: AuditContext,
  ): Promise<void> {
    const row = (await this.repository.listOrganizationConnections()).find(
      (item) => item.id === id,
    );
    if (!row) throw new AppError("NOT_FOUND");
    await this.#delete(actorId, row, context);
  }
  async #delete(
    actorId: string,
    row: ConnectionRow,
    context: AuditContext,
  ): Promise<void> {
    const lease = await this.coordinator.acquireLease(
      "connection",
      row.id,
      30_000,
    );
    if (!lease) throw new AppError("BOT_CHANNEL_BUSY");
    try {
      if (!(await this.repository.deleteConnection(row.ownerId, row.id)))
        throw new AppError("NOT_FOUND");
    } finally {
      await this.coordinator.releaseLease(lease);
    }
    await this.#audit(actorId, row, "bot_channel_disconnected", context);
    this.runtime.wake();
  }
  async setOrganizationEnabled(
    actorId: string,
    id: string,
    enabled: boolean,
    context: AuditContext,
  ): Promise<void> {
    const row = (await this.repository.listOrganizationConnections()).find(
      (item) => item.id === id,
    );
    if (!row) throw new AppError("NOT_FOUND");
    const lease = await this.coordinator.acquireLease("connection", id, 30_000);
    if (!lease) throw new AppError("BOT_CHANNEL_BUSY");
    try {
      if (!(await this.repository.setEnabled(id, enabled)))
        throw new AppError("NOT_FOUND");
    } finally {
      await this.coordinator.releaseLease(lease);
    }
    await this.#audit(
      actorId,
      row,
      enabled ? "bot_channel_connected" : "bot_channel_disconnected",
      context,
    );
    this.runtime.wake();
  }
  async beginRegistration(
    ownerId: string,
    groups: boolean,
  ): Promise<BotChannelRegistration> {
    const lease = await this.coordinator.acquireLease(
      "registration-owner",
      ownerId,
      30_000,
    );
    if (!lease) throw new AppError("BOT_CHANNEL_BUSY");
    try {
      if (
        (await this.repository.listForOwner(ownerId)).some(
          (row) => row.provider === "dingtalk",
        )
      )
        throw new AppError("BOT_CHANNEL_CONNECTION_CONFLICT");
      const start = await this.registrationClient.begin();
      const state: RegistrationState = {
        id: randomUUID(),
        ownerId,
        deviceCode: start.deviceCode,
        interval: start.interval,
        nextPollAt: this.now().getTime() + start.interval * 1000,
        allowGroupMessages: groups,
        status: "waiting_scan",
        qr_code_url: start.qrCodeUrl,
        expires_at: new Date(
          this.now().getTime() + start.expiresIn * 1000,
        ).toISOString(),
        connection_id: null,
      };
      await this.#saveRegistration(state);
      await this.coordinator.activateRegistration(ownerId, state.id);
      return this.#publicRegistration(state);
    } finally {
      await this.coordinator.releaseLease(lease);
    }
  }
  async pollRegistration(
    ownerId: string,
    id: string,
    context: AuditContext,
  ): Promise<BotChannelRegistration> {
    const lease = await this.coordinator.acquireLease(
      "registration",
      id,
      30_000,
    );
    if (!lease) throw new AppError("BOT_CHANNEL_BUSY");
    try {
      const encrypted = await this.coordinator.getRegistration(id);
      if (!encrypted) throw new AppError("NOT_FOUND");
      const state = registrationState.parse(
        decryptJson(
          encrypted,
          this.encryption.masterKey,
          this.encryption.keyId,
          `bot-registration:${id}`,
        ),
      );
      if (state.ownerId !== ownerId) throw new AppError("NOT_FOUND");
      if (state.status !== "waiting_scan")
        return this.#publicRegistration(state);
      const created = await this.repository.findConnectionForOwner(
        ownerId,
        state.id,
      );
      if (created) {
        state.status = "connected";
        state.connection_id = created.id;
        state.deviceCode = "consumed";
        state.qr_code_url = null;
        await this.#saveRegistration(state);
        return this.#publicRegistration(state);
      }
      if (
        !(await this.coordinator.isActiveRegistration(ownerId, id)) ||
        new Date(state.expires_at).getTime() <= this.now().getTime()
      )
        state.status = "expired";
      else if (state.nextPollAt <= this.now().getTime()) {
        state.nextPollAt = this.now().getTime() + state.interval * 1000;
        // Persist the next poll time before the external request, including on transient failure.
        await this.#saveRegistration(state);
        const result = await this.registrationClient.poll(state.deviceCode);
        if (result.status === "SUCCESS") {
          const row = await this.#create(
            ownerId,
            ownerId,
            {
              provider: "dingtalk",
              client_id: result.clientId,
              client_secret: result.clientSecret,
            },
            state.allowGroupMessages,
            context,
            state.id,
          );
          state.status = "connected";
          state.connection_id = row.id;
        } else if (result.status === "EXPIRED") state.status = "expired";
        else if (result.status === "FAIL") state.status = "failed";
      }
      if (state.status !== "waiting_scan") {
        state.deviceCode = "consumed";
        state.qr_code_url = null;
      }
      await this.#saveRegistration(state);
      return this.#publicRegistration(state);
    } finally {
      await this.coordinator.releaseLease(lease);
    }
  }
  #saveRegistration(state: RegistrationState): Promise<void> {
    return this.coordinator.setRegistration(
      state.id,
      encryptJson(
        state,
        this.encryption.masterKey,
        this.encryption.keyId,
        `bot-registration:${state.id}`,
      ),
      Math.max(
        60,
        Math.ceil(
          (new Date(state.expires_at).getTime() - this.now().getTime()) / 1000,
        ) + 300,
      ),
    );
  }
  #publicRegistration(state: RegistrationState): BotChannelRegistration {
    return botChannelRegistrationSchema.parse({
      id: state.id,
      status: state.status,
      qr_code_url: state.qr_code_url,
      expires_at: state.expires_at,
      connection_id: state.connection_id,
    });
  }
  async #audit(
    actorId: string,
    row: ConnectionRow,
    action: "bot_channel_connected" | "bot_channel_disconnected",
    context: AuditContext,
  ): Promise<void> {
    await this.audit.write({
      ...context,
      actorId,
      action,
      targetType: "bot_channel_connection",
      targetId: row.id,
      result: "success",
      metadata: { provider: row.provider },
    });
  }
  #projectAdmin(row: ConnectionRow): BotChannelAdminConnection {
    return botChannelAdminConnectionSchema.parse({
      ...this.#project(row, false),
      account_hint: row.externalId,
      callback_url:
        row.provider === "teams"
          ? new URL(
              `/api/v1/bot-channels/teams/${row.id}/messages`,
              this.publicBaseUrl,
            ).href
          : null,
    });
  }
  #project(row: ConnectionRow, linked: boolean): BotChannelConnection {
    const online =
      row.lastConnectedAt !== null &&
      (row.provider === "teams" ||
        this.now().getTime() - row.lastConnectedAt.getTime() < 90_000);
    return botChannelConnectionSchema.parse({
      id: row.id,
      provider: row.provider,
      scope: row.ownerId ? "personal" : "organization",
      identity_linked: linked,
      allow_group_messages: row.allowGroupMessages,
      runtime_status:
        row.status === "disabled"
          ? "disabled"
          : row.lastErrorCode
            ? "error"
            : online
              ? "online"
              : row.provider === "teams"
                ? "waiting_message"
                : "connecting",
      last_connected_at: row.lastConnectedAt?.toISOString() ?? null,
      last_inbound_at: row.lastInboundAt?.toISOString() ?? null,
      last_error_code: row.lastErrorCode,
      created_at: row.createdAt.toISOString(),
    });
  }
}
