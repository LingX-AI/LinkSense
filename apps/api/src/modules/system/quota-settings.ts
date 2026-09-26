import { z } from "zod";
import {
  defaultQuotaSettings,
  decimalToCreditMicros,
  quotaSettingsSchema,
  resetMemberQuotasInputSchema,
  applyMemberCreditLimitsInputSchema,
  type CreditLimitSettings,
  type QuotaSettings,
} from "@linksense/shared";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { AuditContext } from "../audit/service.js";

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001";
const settingsObjectSchema = z.record(z.string(), z.unknown());

export function quotaSettingsFromJson(value: unknown): QuotaSettings {
  const settings = settingsObjectSchema.parse(value ?? {});
  return settings.quota_settings === undefined
    ? defaultQuotaSettings()
    : quotaSettingsSchema.parse(settings.quota_settings);
}

export function storedCreditLimits(limits: CreditLimitSettings): {
  weeklyCreditLimitMicros: bigint | null;
} {
  return {
    weeklyCreditLimitMicros:
      limits.weekly_credit_limit === null
        ? null
        : decimalToCreditMicros(limits.weekly_credit_limit),
  };
}

export async function readQuotaSettings(
  db: Pick<Prisma.TransactionClient, "systemSetting">,
): Promise<QuotaSettings> {
  const row = await db.systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID },
    select: { settingsJson: true },
  });
  return quotaSettingsFromJson(row?.settingsJson);
}

/** Capture credits with the usage fact, so later changes cannot reprice consumption. */
export async function creditUsageSnapshot(
  db: Pick<Prisma.TransactionClient, "systemSetting">,
  costPicoUsd: bigint,
): Promise<{ creditPriceMicrosUsd: bigint; usedCreditMicros: bigint }> {
  const settings = await readQuotaSettings(db);
  const creditPriceMicrosUsd = decimalToCreditMicros(settings.credit_price_usd);
  // pico-USD / micro-USD per credit = microcredits. Round positive fractions up.
  const usedCreditMicros =
    (costPicoUsd + creditPriceMicrosUsd - 1n) / creditPriceMicrosUsd;
  return { creditPriceMicrosUsd, usedCreditMicros };
}

export class QuotaSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: { now?: () => Date } = {},
  ) {}

  getSettings(): Promise<QuotaSettings> {
    return readQuotaSettings(this.prisma);
  }

  async resetMemberQuotas(
    actorId: string,
    input: unknown,
    context: AuditContext,
  ): Promise<{ updated_user_count: number }> {
    resetMemberQuotasInputSchema.parse(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `;
      const resetAt = this.options.now?.() ?? new Date();
      const result = await tx.user.updateMany({
        data: { creditQuotaResetAt: resetAt },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "member_credit_quotas_reset",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: { updated_user_count: result.count },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return { updated_user_count: result.count };
    });
  }

  async applyMemberLimits(
    actorId: string,
    input: unknown,
    context: AuditContext,
  ): Promise<{ settings: QuotaSettings; updated_user_count: number }> {
    const { limits } = applyMemberCreditLimitsInputSchema.parse(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `;
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
      });
      const current = settingsObjectSchema.parse(row?.settingsJson ?? {});
      const settings: QuotaSettings = {
        ...quotaSettingsFromJson(current),
        weekly_credit_limit: limits.weekly_credit_limit,
      };
      const merged = { ...current, quota_settings: settings };
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson: merged,
          updatedBy: actorId,
        },
        update: { settingsJson: merged, updatedBy: actorId },
      });
      const result = await tx.user.updateMany({
        data: storedCreditLimits(limits),
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "member_credit_limits_applied",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: { updated_user_count: result.count },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return { settings, updated_user_count: result.count };
    });
  }

  async updateSettings(
    actorId: string,
    input: unknown,
    context: AuditContext,
  ): Promise<QuotaSettings> {
    const settings = quotaSettingsSchema.parse(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `;
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
      });
      const current = row?.settingsJson;
      const merged = {
        ...(current && typeof current === "object" && !Array.isArray(current)
          ? current
          : {}),
        quota_settings: settings,
      };
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson: merged,
          updatedBy: actorId,
        },
        update: { settingsJson: merged, updatedBy: actorId },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "quota_settings_updated",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: {},
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return settings;
    });
  }
}
