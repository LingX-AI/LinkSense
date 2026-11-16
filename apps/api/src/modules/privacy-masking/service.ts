import {
  defaultPrivacyMaskingSettings,
  privacyMaskingRuntimeSchema,
  privacyMaskingSettingsSchema,
  updatePrivacyMaskingSettingsSchema,
  type PrivacyMaskingRuntime,
  type PrivacyMaskingSettings,
  type PrivacyMaskingSettingsResponse,
  type UpdatePrivacyMaskingSettings,
} from "@linksense/shared";

import type { AppConfig } from "../../config.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson, hmacSha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext } from "../audit/service.js";

const SETTINGS_CONTEXT = "linksense:user-privacy-masking:v1";
const PLACEHOLDER_KEY_NAMESPACE = "linksense:privacy-masking:v1:";

function cloneSettings(
  settings: PrivacyMaskingSettings,
): PrivacyMaskingSettings {
  return {
    ...settings,
    kinds: { ...settings.kinds },
    words: [...settings.words],
    actions: { ...settings.actions },
    allow: [...settings.allow],
  };
}

function uniqueValues(
  values: readonly string[],
  anyCase = true,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "") continue;
    const key = anyCase ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalize(
  settings: PrivacyMaskingSettings,
): PrivacyMaskingSettings {
  return {
    ...settings,
    words: uniqueValues(settings.words, settings.words_any_case),
    allow: uniqueValues(settings.allow),
  };
}

/**
 * A user's privacy masking preferences. The row is absent until the user
 * changes a setting; absence means the defaults, so an upgrade needs no
 * backfill. Settings are encrypted because custom words and allowlisted
 * values may name internal projects or real credentials.
 */
export class PrivacyMaskingSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Pick<
      AppConfig,
      "credentialMasterKey" | "credentialKeyId"
    >,
  ) {}

  async getForUser(userId: string): Promise<PrivacyMaskingSettingsResponse> {
    return this.readForUser(userId);
  }

  async updateForUser(
    userId: string,
    raw: UpdatePrivacyMaskingSettings,
    audit: AuditContext,
  ): Promise<PrivacyMaskingSettingsResponse> {
    const input = updatePrivacyMaskingSettingsSchema.parse(raw);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`linksense-user-privacy-masking:${userId}`}, 0))`;
      const row = await transaction.userPrivacyMaskingSetting.findUnique({
        where: { userId },
        select: {
          encryptedSettings: true,
          encryptionKeyId: true,
          revision: true,
        },
      });
      if ((row?.revision ?? 0) !== input.expected_revision) {
        throw new AppError("CONFLICT");
      }
      const settings = normalize(input.settings);
      const revision = (row?.revision ?? 0) + 1;
      const encryptedSettings = encryptJson(
        settings,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        SETTINGS_CONTEXT,
      );
      await transaction.userPrivacyMaskingSetting.upsert({
        where: { userId },
        create: {
          userId,
          encryptedSettings,
          encryptionKeyId: this.config.credentialKeyId,
          revision,
        },
        update: {
          encryptedSettings,
          encryptionKeyId: this.config.credentialKeyId,
          revision,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: userId,
          action: "privacy_masking_settings_updated",
          targetType: "user_privacy_masking",
          targetId: userId,
          result: "success",
          metadataJson: {
            revision,
            enabled: settings.enabled,
            secrets: settings.secrets,
            personal: settings.personal,
            word_count: settings.words.length,
            allow_count: settings.allow.length,
            action_count: Object.keys(settings.actions).length,
          },
          ipAddress: audit.ipAddress ?? null,
          userAgent: audit.userAgent ?? null,
        },
      });
      return { revision, settings };
    });
  }

  /**
   * The runner configuration, or undefined while masking is off. The
   * placeholder key is per user so the same secret never gets the same
   * placeholder in two users' traffic to a shared provider account.
   */
  async runtimeForUser(
    userId: string,
  ): Promise<PrivacyMaskingRuntime | undefined> {
    const stored = await this.readForUser(userId);
    if (!stored.settings.enabled) return undefined;
    return privacyMaskingRuntimeSchema.parse({
      revision: stored.revision,
      secrets: stored.settings.secrets,
      personal: stored.settings.personal,
      kinds: stored.settings.kinds,
      words: stored.settings.words,
      words_any_case: stored.settings.words_any_case,
      words_whole: stored.settings.words_whole,
      actions: stored.settings.actions,
      allow: stored.settings.allow,
      placeholder_key: hmacSha256(
        this.config.credentialMasterKey,
        PLACEHOLDER_KEY_NAMESPACE,
        userId,
      ),
    });
  }

  private async readForUser(
    userId: string,
  ): Promise<PrivacyMaskingSettingsResponse> {
    const row = await this.prisma.userPrivacyMaskingSetting.findUnique({
      where: { userId },
      select: {
        encryptedSettings: true,
        encryptionKeyId: true,
        revision: true,
      },
    });
    if (!row) {
      return {
        revision: 0,
        settings: cloneSettings(defaultPrivacyMaskingSettings),
      };
    }
    return {
      revision: row.revision,
      settings: this.decrypt(row.encryptedSettings, row.encryptionKeyId),
    };
  }

  private decrypt(
    encryptedSettings: string,
    encryptionKeyId: string,
  ): PrivacyMaskingSettings {
    try {
      const parsed = privacyMaskingSettingsSchema.parse(
        decryptJson<unknown>(
          encryptedSettings,
          this.config.credentialMasterKey,
          encryptionKeyId,
          SETTINGS_CONTEXT,
        ),
      );
      return cloneSettings(parsed);
    } catch {
      // Fail closed: the caller must not treat an unreadable setting as off.
      throw new AppError("PRIVACY_MASKING_SETTINGS_UNAVAILABLE");
    }
  }
}
