import {
  connectionProviderSchema,
  connectionSettingsEnvelopeSchema,
  connectionSettingsListSchema,
  connectionSettingsStorage,
  updateConnectionSettingsSchema,
  type ConnectionConfiguration,
  type ConnectionProvider,
  type ConnectionProviderSettings,
  type UpdateConnectionSettings,
} from "@linksense/shared";
import type { AppConfig } from "../../config.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext } from "../audit/service.js";
import { connectionScopes } from "./protocol.js";

export type ConnectionSettingsReader = Pick<ConnectionSettingsService, "resolve">;

export class ConnectionSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Pick<AppConfig, "credentialMasterKey" | "credentialKeyId" | "publicBaseUrl">,
  ) {}

  private readEnvelope(value: Prisma.JsonValue | undefined) {
    const raw = jsonObject(value)[connectionSettingsStorage.key];
    if (raw === undefined) return {};
    if (typeof raw !== "string") throw new AppError("INTERNAL_ERROR");
    return connectionSettingsEnvelopeSchema.parse(decryptJson<unknown>(
      raw, this.config.credentialMasterKey, this.config.credentialKeyId,
      connectionSettingsStorage.context,
    ));
  }

  async resolve(provider: ConnectionProvider): Promise<ConnectionConfiguration | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: connectionSettingsStorage.id }, select: { settingsJson: true },
    });
    return this.readEnvelope(row?.settingsJson)[provider] ?? null;
  }

  async getAdminSettings(): Promise<ConnectionProviderSettings[]> {
    const [row, accounts] = await Promise.all([
      this.prisma.systemSetting.findUnique({
        where: { id: connectionSettingsStorage.id }, select: { settingsJson: true },
      }),
      this.prisma.userConnection.groupBy({
        by: ["provider"],
        where: { encryptedPayload: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const envelope = this.readEnvelope(row?.settingsJson);
    return connectionSettingsListSchema.parse(connectionProviderSchema.options.map((provider) => ({
      provider,
      revision: envelope[provider]?.revision ?? 0,
      client_id: envelope[provider]?.client_id ?? "",
      secret_configured: Boolean(envelope[provider]?.client_secret),
      redirect_uri: new URL(`/api/v1/connectors/${provider}/callback`, this.config.publicBaseUrl).toString(),
      required_scopes: connectionScopes[provider],
      connected_account_count: accounts.find((entry) => entry.provider === provider)?._count._all ?? 0,
    })));
  }

  async update(
    provider: ConnectionProvider,
    raw: UpdateConnectionSettings,
    actorId: string,
    audit: AuditContext,
  ): Promise<ConnectionProviderSettings[]> {
    const input = updateConnectionSettingsSchema.parse(raw);
    const callback = new URL(this.config.publicBaseUrl);
    if (!(callback.protocol === "https:" || callback.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname)))
      throw new AppError("VALIDATION_ERROR");
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${connectionSettingsStorage.lockKey}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))`;
      const row = await tx.systemSetting.findUnique({
        where: { id: connectionSettingsStorage.id }, select: { settingsJson: true },
      });
      const envelope = this.readEnvelope(row?.settingsJson);
      const current = envelope[provider];
      if ((current?.revision ?? 0) !== input.expected_revision) throw new AppError("CONFLICT");
      const clientChanged = Boolean(current?.client_id && current.client_id !== input.client_id);
      const secret = input.client_secret ?? (clientChanged ? "" : current?.client_secret ?? "");
      if (!secret) throw new AppError("CONNECTION_CLIENT_SECRET_REQUIRED");
      if (clientChanged && !input.acknowledge_reauthorization) {
        const count = await tx.userConnection.count({
          where: { provider, encryptedPayload: { not: null } },
        });
        if (count > 0) throw new AppError("CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION", { count });
      }
      const next: ConnectionConfiguration = {
        revision: input.expected_revision + 1, client_id: input.client_id, client_secret: secret,
      };
      const settingsJson = {
        ...jsonObject(row?.settingsJson),
        [connectionSettingsStorage.key]: encryptJson(
          { ...envelope, [provider]: next }, this.config.credentialMasterKey,
          this.config.credentialKeyId, connectionSettingsStorage.context,
        ),
      };
      await tx.systemSetting.upsert({
        where: { id: connectionSettingsStorage.id },
        create: { id: connectionSettingsStorage.id, settingsJson, updatedBy: actorId },
        update: { settingsJson, updatedBy: actorId },
      });
      await tx.auditLog.create({
        data: {
          actorId, action: "connection_settings_updated", targetType: "connection_provider",
          targetId: provider, result: "success",
          metadataJson: {
            provider, revision: next.revision, client_changed: clientChanged,
            secret_replaced: input.client_secret !== undefined,
            reauthorization_acknowledged: input.acknowledge_reauthorization,
          },
          ipAddress: audit.ipAddress ?? null, userAgent: audit.userAgent ?? null,
        },
      });
    }, { timeout: 30_000, maxWait: 10_000 });
    return this.getAdminSettings();
  }
}

function jsonObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new AppError("INTERNAL_ERROR");
  return value;
}
