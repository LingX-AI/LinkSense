import {
  sharePointConnectionSettingsSchema,
  updateSharePointConnectionSettingsSchema,
  type SharePointConnectionSettings,
  type UpdateSharePointConnectionSettings,
} from "@linksense/shared";
import { z } from "zod";

import type { AppConfig } from "../../config.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext } from "../audit/service.js";

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001";
const ENCRYPTED_SETTINGS_KEY = "sharepoint_knowledge_source_settings_encrypted";
const ENCRYPTION_KEY_ID_KEY = "sharepoint_knowledge_source_settings_key_id";
const ENCRYPTION_CONTEXT = "linksense:sharepoint-knowledge-source-settings:v1";

const storedSettingsSchema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  tenantId: z.string().uuid().nullable(),
  clientId: z.string().uuid().nullable(),
  tenantDomain: z.string().min(1).max(253).nullable(),
  clientSecret: z.string().min(1).max(16_384).nullable(),
});

type StoredSettings = z.infer<typeof storedSettingsSchema>;

export type ResolvedSharePointRuntime = {
  revision: number;
  tenantId: string;
  clientId: string;
  tenantDomain: string;
  clientSecret: string;
};

export interface SharePointCredentialProbe {
  validateCredentials(runtime: ResolvedSharePointRuntime): Promise<void>;
}

export class SharePointSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly probe: SharePointCredentialProbe,
  ) {}

  async getAdminSettings(): Promise<SharePointConnectionSettings> {
    return project(await this.read());
  }

  async resolveRuntime(): Promise<ResolvedSharePointRuntime> {
    const stored = await this.read();
    if (
      !stored?.enabled ||
      !stored.tenantId ||
      !stored.clientId ||
      !stored.tenantDomain ||
      !stored.clientSecret
    ) {
      throw new AppError("KNOWLEDGE_SOURCE_NOT_CONFIGURED");
    }
    return {
      revision: stored.revision,
      tenantId: stored.tenantId,
      clientId: stored.clientId,
      tenantDomain: stored.tenantDomain,
      clientSecret: stored.clientSecret,
    };
  }

  async update(
    actorId: string,
    raw: UpdateSharePointConnectionSettings,
    context: AuditContext,
  ): Promise<SharePointConnectionSettings> {
    const input = updateSharePointConnectionSettingsSchema.parse(raw);
    const current = await this.read();
    if ((current?.revision ?? 0) !== input.expected_revision) {
      throw new AppError("CONFLICT");
    }
    const next = createStored(input, current);
    if (next.enabled) {
      try {
        await this.probe.validateCredentials(resolve(next));
      } catch {
        throw new AppError("KNOWLEDGE_SOURCE_CREDENTIAL_VALIDATION_FAILED");
      }
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `;
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
        select: { settingsJson: true },
      });
      const settingsJson = asObject(row?.settingsJson);
      const latest = readStored(
        settingsJson,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
      );
      if ((latest?.revision ?? 0) !== input.expected_revision) {
        throw new AppError("CONFLICT");
      }
      const finalSettings = createStored(input, latest);
      const encrypted = encryptJson(
        finalSettings,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        ENCRYPTION_CONTEXT,
      );
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson: {
            ...settingsJson,
            [ENCRYPTED_SETTINGS_KEY]: encrypted,
            [ENCRYPTION_KEY_ID_KEY]: this.config.credentialKeyId,
          },
          updatedBy: actorId,
        },
        update: {
          settingsJson: {
            ...settingsJson,
            [ENCRYPTED_SETTINGS_KEY]: encrypted,
            [ENCRYPTION_KEY_ID_KEY]: this.config.credentialKeyId,
          },
          updatedBy: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "knowledge_source.sharepoint_settings_updated",
          targetType: "knowledge_source_provider",
          targetId: "sharepoint",
          result: "success",
          metadataJson: {
            revision: finalSettings.revision,
            enabled: finalSettings.enabled,
            tenant_domain: finalSettings.tenantDomain,
            client_secret_replaced: input.client_secret !== undefined,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return finalSettings;
    });
    return project(saved);
  }

  private async read(): Promise<StoredSettings | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { settingsJson: true },
    });
    return readStored(
      asObject(row?.settingsJson),
      this.config.credentialMasterKey,
      this.config.credentialKeyId,
    );
  }
}

function createStored(
  input: z.output<typeof updateSharePointConnectionSettingsSchema>,
  current: StoredSettings | null,
): StoredSettings {
  const identityChanged =
    current !== null &&
    (current.tenantId !== input.tenant_id ||
      current.clientId !== input.client_id);
  const clientSecret =
    input.client_secret ??
    (identityChanged ? null : (current?.clientSecret ?? null));
  if (
    input.enabled &&
    (!input.tenant_id ||
      !input.client_id ||
      !input.tenant_domain ||
      !clientSecret)
  ) {
    throw new AppError("KNOWLEDGE_SOURCE_CREDENTIAL_VALIDATION_FAILED");
  }
  return storedSettingsSchema.parse({
    version: 1,
    revision: (current?.revision ?? 0) + 1,
    enabled: input.enabled,
    tenantId: input.tenant_id,
    clientId: input.client_id,
    tenantDomain: input.tenant_domain?.toLocaleLowerCase("en-US") ?? null,
    clientSecret,
  });
}

function resolve(value: StoredSettings): ResolvedSharePointRuntime {
  if (
    !value.enabled ||
    !value.tenantId ||
    !value.clientId ||
    !value.tenantDomain ||
    !value.clientSecret
  ) {
    throw new AppError("KNOWLEDGE_SOURCE_NOT_CONFIGURED");
  }
  return {
    revision: value.revision,
    tenantId: value.tenantId,
    clientId: value.clientId,
    tenantDomain: value.tenantDomain,
    clientSecret: value.clientSecret,
  };
}

function project(value: StoredSettings | null): SharePointConnectionSettings {
  return sharePointConnectionSettingsSchema.parse({
    provider: "sharepoint",
    revision: value?.revision ?? 0,
    enabled: value?.enabled ?? false,
    tenant_id: value?.tenantId ?? null,
    client_id: value?.clientId ?? null,
    tenant_domain: value?.tenantDomain ?? null,
    client_secret_configured: Boolean(value?.clientSecret),
  });
}

function readStored(
  settings: Record<string, unknown>,
  masterKey: string,
  keyId: string,
): StoredSettings | null {
  const encrypted = settings[ENCRYPTED_SETTINGS_KEY];
  if (encrypted === undefined) return null;
  if (typeof encrypted !== "string") throw new AppError("INTERNAL_ERROR");
  const storedKeyId = settings[ENCRYPTION_KEY_ID_KEY];
  if (storedKeyId !== undefined && storedKeyId !== keyId) {
    throw new AppError("INTERNAL_ERROR");
  }
  try {
    return storedSettingsSchema.parse(
      decryptJson<unknown>(encrypted, masterKey, keyId, ENCRYPTION_CONTEXT),
    );
  } catch {
    throw new AppError("INTERNAL_ERROR");
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
