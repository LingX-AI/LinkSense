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
  it("starts with one unlimited weekly policy and USD 0.01 per credit", () => {
    expect(quotaSettingsFromJson({})).toEqual(defaultQuotaSettings());
    expect(() =>
      quotaSettingsFromJson({ quota_settings: { credit_price_usd: "0" } }),
    ).toThrow();
  });

  it("saves the unified weekly default without overwriting existing users", async () => {
    const { service, tx } = fixture();
    const input = defaultQuotaSettings();
    input.weekly_credit_limit = "100";
    expect(await service.updateSettings("admin", input, {})).toEqual(input);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
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
          metadataJson: {},
        }),
      }),
    );
  });

  it("rejects removed population-specific settings before persistence", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.updateSettings(
        "admin",
        {
          ...defaultQuotaSettings(),
          organization_members: { weekly_credit_limit: "500" },
        },
        {},
      ),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid prices before accessing persistence", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.updateSettings(
        "admin",
        { ...defaultQuotaSettings(), credit_price_usd: "0" },
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
      creditPriceMicrosUsd: 10_000n,
      usedCreditMicros: 25_000_000n,
    });
    await service.updateSettings(
      "admin",
      { ...defaultQuotaSettings(), credit_price_usd: "0.02" },
      {},
    );
    expect(
      await creditUsageSnapshot(
        prisma as unknown as PrismaClient,
        250_000_000_000n,
      ),
    ).toEqual({ creditPriceMicrosUsd: 20_000n, usedCreditMicros: 12_500_000n });
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
