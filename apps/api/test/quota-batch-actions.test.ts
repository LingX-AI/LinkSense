import { defaultQuotaSettings, type QuotaSettings } from "@linksense/shared";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { QuotaSettingsService } from "../src/modules/system/quota-settings.js";
import { CreditLimitService } from "../src/modules/usage/credit-limit.js";

const NOW = new Date("2026-09-10T08:00:00.000Z");
const BEFORE = new Date("2026-09-10T07:00:00.000Z");

function fixture() {
  let now = NOW;
  let settings = defaultQuotaSettings();
  const users = [
    { id: "org", status: "active" },
    { id: "disabled-org", status: "disabled" },
    { id: "registered", status: "active" },
    { id: "external", status: "active" },
  ].map((user) => ({
    ...user,
    weeklyCreditLimitMicros: 1_000n as bigint | null,
    creditQuotaResetAt: null as Date | null,
  }));
  const records = users.map((user) => ({
    ownerId: user.id,
    observedAt: BEFORE,
    usedCreditMicros: 1_000n,
  }));
  type AggregateInput = {
    where: { ownerId: string; observedAt?: { gte?: Date; lt?: Date } };
  };
  const aggregate = vi.fn(async ({ where }: AggregateInput) => ({
    _sum: {
      usedCreditMicros: records
        .filter(
          (entry) =>
            entry.ownerId === where.ownerId &&
            (!where.observedAt?.gte ||
              entry.observedAt >= where.observedAt.gte) &&
            (!where.observedAt?.lt || entry.observedAt < where.observedAt.lt),
        )
        .reduce((sum, entry) => sum + entry.usedCreditMicros, 0n),
    },
  }));
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          users.find(
            (user) => user.id === where.id && user.id !== "external",
          ) ?? null,
      ),
      updateMany: vi.fn(
        async ({ data }: { data: Partial<(typeof users)[number]> }) => {
          const selected = users.filter((user) => user.id !== "external");
          for (const user of selected) Object.assign(user, data);
          return { count: selected.length };
        },
      ),
    },
    applicationExternalSession: {
      findUnique: vi.fn(
        async ({ where }: { where: { runtimePrincipalId: string } }) =>
          users.find(
            (user) =>
              user.id === where.runtimePrincipalId && user.id === "external",
          ) ?? null,
      ),
    },
    systemSetting: {
      findUnique: vi.fn(async () => ({
        settingsJson: {
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
    auditLog: { create: vi.fn(async () => ({})) },
    tokenUsageRecord: { aggregate },
    modelUsageRecord: {
      aggregate: vi.fn(async () => ({ _sum: { usedCreditMicros: 0n } })),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (run: (db: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const db = prisma as unknown as PrismaClient;
  const quotas = new QuotaSettingsService(db, { now: () => now });
  const usage = new CreditLimitService(db, {
    now: () => now,
    timeZone: "Asia/Shanghai",
  });
  const user = (id: string) => {
    const found = users.find((entry) => entry.id === id);
    if (!found) throw new Error("Missing test user");
    return found;
  };
  return {
    quotas,
    usage,
    prisma,
    records,
    user,
    setNow: (value: Date) => {
      now = value;
    },
  };
}

describe("immediate quota batch actions", () => {
  it("immediately restores every member's weekly quota without altering history", async () => {
    const f = fixture();
    await expect(f.usage.assertCanStartTask("org")).rejects.toMatchObject({
      code: "CREDIT_LIMIT_EXCEEDED",
    });
    const history = structuredClone(f.records);

    await expect(f.quotas.resetMemberQuotas("admin", {}, {})).resolves.toEqual(
      { updated_user_count: 3 },
    );

    for (const id of ["org", "disabled-org", "registered"]) {
      const remaining = await f.usage.currentUsageForLimits(id, f.user(id));
      expect(remaining.weekly).toMatchObject({
        usedCreditMicros: 0n,
        remainingPercentage: 100,
      });
      expect(remaining.weekly?.remainingCreditMicros).toBe(
        remaining.weekly?.limitCreditMicros,
      );
    }
    await expect(f.usage.assertCanStartTask("org")).resolves.toBeUndefined();
    expect(f.user("external").creditQuotaResetAt).toBeNull();
    expect(f.records).toEqual(history);
    expect(f.prisma.systemSetting.upsert).not.toHaveBeenCalled();
    expect(f.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "member_credit_quotas_reset",
          metadataJson: { updated_user_count: 3 },
        }),
      }),
    );
  });

  it("deducts subsequent usage and restores 100% again on a second immediate reset", async () => {
    const f = fixture();
    await f.quotas.resetMemberQuotas("admin", {}, {});
    f.records.push({
      ownerId: "org",
      observedAt: new Date(NOW.getTime() + 1),
      usedCreditMicros: 250n,
    });
    expect(
      (await f.usage.currentUsageForLimits("org", f.user("org"))).weekly,
    ).toMatchObject({ usedCreditMicros: 250n, remainingPercentage: 75 });

    f.setNow(new Date(NOW.getTime() + 2));
    await f.quotas.resetMemberQuotas("admin", {}, {});
    expect(
      (await f.usage.currentUsageForLimits("org", f.user("org"))).weekly,
    ).toMatchObject({ usedCreditMicros: 0n, remainingPercentage: 100 });
    expect(f.records).toHaveLength(5);
  });

  it("preserves an unlimited weekly quota during a manual reset", async () => {
    const f = fixture();
    f.user("org").weeklyCreditLimitMicros = null;

    await f.quotas.resetMemberQuotas("admin", {}, {});

    const result = await f.usage.currentUsageForLimits("org", f.user("org"));
    expect(result.weekly).toBeNull();
  });

  it("saves and applies the weekly limit to every member while retaining consumed credits", async () => {
    const f = fixture();
    const limits = { weekly_credit_limit: "0.004" };

    const result = await f.quotas.applyMemberLimits(
      "admin",
      { limits },
      {},
    );

    expect(result).toEqual({
      updated_user_count: 3,
      settings: { ...defaultQuotaSettings(), ...limits },
    });
    for (const id of ["org", "disabled-org", "registered"]) {
      expect(f.user(id)).toMatchObject({
        weeklyCreditLimitMicros: 4_000n,
        creditQuotaResetAt: null,
      });
    }
    expect(f.user("external").weeklyCreditLimitMicros).toBe(1_000n);
    expect(
      (await f.usage.currentUsageForLimits("org", f.user("org"))).weekly,
    ).toMatchObject({ usedCreditMicros: 1_000n, remainingPercentage: 75 });
    expect(f.prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          settingsJson: expect.objectContaining({
            self_registration: { enabled: true },
          }),
        }),
      }),
    );
    expect(f.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "member_credit_limits_applied",
        }),
      }),
    );
  });

  it("rejects removed fields and invalid limits before making any writes", async () => {
    const f = fixture();
    await expect(
      f.quotas.resetMemberQuotas("admin", { reset_at: NOW.toISOString() }, {}),
    ).rejects.toThrow();
    await expect(
      f.quotas.applyMemberLimits(
        "admin",
        { limits: { total_credit_limit: "1" } },
        {},
      ),
    ).rejects.toThrow();
    await expect(
      f.quotas.applyMemberLimits(
        "admin",
        { limits: { weekly_credit_limit: "0" } },
        {},
      ),
    ).rejects.toThrow();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});
