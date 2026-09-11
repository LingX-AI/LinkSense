import { z } from "zod";
import {
  defaultQuotaSettings,
  decimalToCreditMicros,
  quotaSettingsSchema,
  resetMemberQuotasInputSchema,
  applyOrganizationCreditLimitsInputSchema,
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
  totalCreditLimitMicros: bigint | null;
  weeklyCreditLimitMicros: bigint | null;
  monthlyCreditLimitMicros: bigint | null;
} {
  return {
    totalCreditLimitMicros:
      limits.total_credit_limit === null
        ? null
        : decimalToCreditMicros(limits.total_credit_limit),
    weeklyCreditLimitMicros:
      limits.weekly_credit_limit === null
        ? null
        : decimalToCreditMicros(limits.weekly_credit_limit),
    monthlyCreditLimitMicros:
      limits.monthly_credit_limit === null
        ? null
        : decimalToCreditMicros(limits.monthly_credit_limit),
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
  costPicoCny: bigint,
): Promise<{ creditPriceMicrosCny: bigint; usedCreditMicros: bigint }> {
  const settings = await readQuotaSettings(db);
  const creditPriceMicrosCny = decimalToCreditMicros(settings.credit_price_cny);
  // pico-CNY / micro-CNY per credit = microcredits. Round positive fractions up.
  const usedCreditMicros =
    (costPicoCny + creditPriceMicrosCny - 1n) / creditPriceMicrosCny;
  return { creditPriceMicrosCny, usedCreditMicros };
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
    const { scope } = resetMemberQuotasInputSchema.parse(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `;
      const resetAt = this.options.now?.() ?? new Date();
      const result = await tx.user.updateMany({
        where: {
          accountType: "member",
          selfRegisteredAt:
            scope === "organization_members" ? null : { not: null },
        },
        data: { creditQuotaResetAt: resetAt },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "member_credit_quotas_reset",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: { scope, updated_user_count: result.count },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return { updated_user_count: result.count };
    });
  }

  async applyOrganizationLimits(
    actorId: string,
    input: unknown,
    context: AuditContext,
  ): Promise<{ settings: QuotaSettings; updated_user_count: number }> {
    const { limits } = applyOrganizationCreditLimitsInputSchema.parse(input);
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
        organization_members: limits,
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
        where: { accountType: "member", selfRegisteredAt: null },
        data: storedCreditLimits(limits),
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "organization_credit_limits_applied",
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
      const previous = quotaSettingsFromJson(current).self_registered_users;
      const next = settings.self_registered_users;
      const registrationChanged =
        previous.total_credit_limit !== next.total_credit_limit ||
        previous.weekly_credit_limit !== next.weekly_credit_limit ||
        previous.monthly_credit_limit !== next.monthly_credit_limit;
      const synchronized = registrationChanged
        ? await tx.user.updateMany({
            where: { accountType: "member", selfRegisteredAt: { not: null } },
            data: storedCreditLimits(next),
          })
        : { count: 0 };
      await tx.auditLog.create({
        data: {
          actorId,
          action: "quota_settings_updated",
          targetType: "system_settings",
          targetId: SYSTEM_SETTINGS_ID,
          result: "success",
          metadataJson: { updated_user_count: synchronized.count },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return settings;
    });
  }
}
