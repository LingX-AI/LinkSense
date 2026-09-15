import { describe, expect, it, vi } from "vitest";
import { defaultQuotaSettings, type QuotaSettings } from "@linksense/shared";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import {
  creditUsageSnapshot,
  quotaSettingsFromJson,
  QuotaSettingsService,
} from "../src/modules/system/quota-settings.js";

function fixture(initial = defaultQuotaSettings()) {
  let settings = initial;
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    systemSetting: {
      findUnique: vi.fn(async () => ({
        settingsJson: {
          organization_name: "Test",
          quota_settings: settings,
          self_registration: { enabled: true },
        },
      })),
      upsert: vi.fn(
        async (input: {
          update: { settingsJson: { quota_settings: QuotaSettings } };
        }) => {
          settings = input.update.settingsJson.quota_settings;
        },
      ),
    },
    user: { updateMany: vi.fn(async () => ({ count: 3 })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (run: (db: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  return {
    tx,
    prisma,
    service: new QuotaSettingsService(prisma as unknown as PrismaClient),
  };
}

describe("quota settings", () => {
  it("starts with independent unlimited policies and CNY 0.01 per credit", () => {
    expect(quotaSettingsFromJson({})).toEqual(defaultQuotaSettings());
    expect(() =>
      quotaSettingsFromJson({ quota_settings: { credit_price_cny: "0" } }),
    ).toThrow();
  });

  it("saves all three self-registration limits atomically without changing organization members", async () => {
    const { service, tx } = fixture();
    const input = defaultQuotaSettings();
    input.organization_members = {
      total_credit_limit: "1000",
      weekly_credit_limit: "100",
      monthly_credit_limit: null,
    };
    input.self_registered_users = {
      total_credit_limit: "50",
      weekly_credit_limit: "2.5",
      monthly_credit_limit: "10",
    };
    expect(await service.updateSettings("admin", input, {})).toEqual(input);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { selfRegisteredAt: { not: null } },
      data: {
        totalCreditLimitMicros: 50_000_000n,
        weeklyCreditLimitMicros: 2_500_000n,
        monthlyCreditLimitMicros: 10_000_000n,
      },
    });
    expect(tx.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          settingsJson: expect.objectContaining({
            organization_name: "Test",
            self_registration: { enabled: true },
          }),
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "quota_settings_updated",
          metadataJson: { updated_user_count: 3 },
        }),
      }),
    );
  });

  it("clears restrictions for existing self-registered users when limits become unlimited", async () => {
    const initial = defaultQuotaSettings();
    initial.self_registered_users.total_credit_limit = "5";
    const { service, tx } = fixture(initial);
    await service.updateSettings("admin", defaultQuotaSettings(), {});
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          totalCreditLimitMicros: null,
          weeklyCreditLimitMicros: null,
          monthlyCreditLimitMicros: null,
        },
      }),
    );
  });

  it("does not overwrite individual user quotas when only the conversion or organization defaults change", async () => {
    const { service, tx } = fixture();
    const input = defaultQuotaSettings();
    input.credit_price_cny = "0.02";
    input.organization_members.monthly_credit_limit = "500";
    await service.updateSettings("admin", input, {});
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects invalid prices before accessing persistence", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.updateSettings(
        "admin",
        { ...defaultQuotaSettings(), credit_price_cny: "0" },
        {},
      ),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("captures credits at the current price without repricing a previously captured fact", async () => {
    const { service, prisma } = fixture();
    const first = await creditUsageSnapshot(
      prisma as unknown as PrismaClient,
      250_000_000_000n,
    );
    expect(first).toEqual({
      creditPriceMicrosCny: 10_000n,
      usedCreditMicros: 25_000_000n,
    });
    await service.updateSettings(
      "admin",
      { ...defaultQuotaSettings(), credit_price_cny: "0.02" },
      {},
    );
    expect(
      await creditUsageSnapshot(
        prisma as unknown as PrismaClient,
        250_000_000_000n,
      ),
    ).toEqual({ creditPriceMicrosCny: 20_000n, usedCreditMicros: 12_500_000n });
    expect(first.usedCreditMicros).toBe(25_000_000n);
    expect(
      (await creditUsageSnapshot(prisma as unknown as PrismaClient, 1n))
        .usedCreditMicros,
    ).toBe(1n);
    expect(
      (await creditUsageSnapshot(prisma as unknown as PrismaClient, 0n))
        .usedCreditMicros,
    ).toBe(0n);
  });
});
