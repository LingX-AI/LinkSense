import { describe, expect, it, vi } from "vitest";
import { defaultQuotaSettings, type QuotaSettings } from "@linksense/shared";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { QuotaSettingsService } from "../src/modules/system/quota-settings.js";
import { CreditLimitService } from "../src/modules/usage/credit-limit.js";

const NOW = new Date("2026-09-10T08:00:00.000Z");
const BEFORE = new Date("2026-09-10T07:00:00.000Z");
function fixture() {
  let now = NOW;
  let settings = defaultQuotaSettings();
  const users = [
    {
      id: "org",
      accountType: "member",
      status: "active",
      selfRegisteredAt: null,
    },
    {
      id: "disabled-org",
      accountType: "member",
      status: "disabled",
      selfRegisteredAt: null,
    },
    {
      id: "registered",
      accountType: "member",
      status: "active",
      selfRegisteredAt: BEFORE,
    },
    {
      id: "external",
      accountType: "external",
      status: "active",
      selfRegisteredAt: null,
    },
  ].map((user) => ({
    ...user,
    totalCreditLimitMicros: 1_000n as bigint | null,
    weeklyCreditLimitMicros: 1_000n as bigint | null,
    monthlyCreditLimitMicros: 2_000n as bigint | null,
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
          users.find((user) => user.id === where.id) ?? null,
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            accountType: string;
            selfRegisteredAt: null | { not: null };
          };
          data: Partial<
            Pick<
              (typeof users)[number],
              | "creditQuotaResetAt"
              | "totalCreditLimitMicros"
              | "weeklyCreditLimitMicros"
              | "monthlyCreditLimitMicros"
            >
          >;
        }) => {
          const selected = users.filter(
            (user) =>
              user.accountType === where.accountType &&
              (where.selfRegisteredAt === null
                ? user.selfRegisteredAt === null
                : user.selfRegisteredAt !== null),
          );
          for (const user of selected) Object.assign(user, data);
          return { count: selected.length };
        },
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
    users,
    records,
    user,
    setNow: (value: Date) => {
      now = value;
    },
  };
}

describe("immediate quota batch actions", () => {
  it.each([
    {
      scope: "organization_members",
      target: "org",
      other: "registered",
      count: 2,
    },
    {
      scope: "self_registered_users",
      target: "registered",
      other: "org",
      count: 1,
    },
  ])(
    "immediately restores all configured quotas only for $scope without altering history",
    async ({ scope, target, other, count }) => {
      const f = fixture();
      await expect(f.usage.assertCanStartTask(target)).rejects.toMatchObject({
        code: "CREDIT_LIMIT_EXCEEDED",
      });
      const history = structuredClone(f.records);
      expect(await f.quotas.resetMemberQuotas("admin", { scope }, {})).toEqual({
        updated_user_count: count,
      });
      const remaining = await f.usage.currentUsageForLimits(
        target,
        f.user(target),
      );
      for (const period of [
        remaining.total,
        remaining.weekly,
        remaining.monthly,
      ]) {
        expect(period).toMatchObject({
          usedCreditMicros: 0n,
          remainingPercentage: 100,
        });
        expect(period?.remainingCreditMicros).toBe(period?.limitCreditMicros);
      }
      await expect(f.usage.assertCanStartTask(target)).resolves.toBeUndefined();
      await expect(f.usage.assertCanStartTask(other)).rejects.toMatchObject({
        code: "CREDIT_LIMIT_EXCEEDED",
      });
      expect(f.user("external").creditQuotaResetAt).toBeNull();
      expect(f.records).toEqual(history);
      expect(f.prisma.systemSetting.upsert).not.toHaveBeenCalled();
      expect(f.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "member_credit_quotas_reset",
            metadataJson: { scope, updated_user_count: count },
          }),
        }),
      );
    },
  );

  it("deducts subsequent usage and restores 100% again on a second immediate reset", async () => {
    const f = fixture();
    await f.quotas.resetMemberQuotas(
      "admin",
      { scope: "organization_members" },
      {},
    );
    f.records.push({
      ownerId: "org",
      observedAt: new Date(NOW.getTime() + 1),
      usedCreditMicros: 250n,
    });
    expect(
      (await f.usage.currentUsageForLimits("org", f.user("org"))).total,
    ).toMatchObject({ usedCreditMicros: 250n, remainingPercentage: 75 });
    f.setNow(new Date(NOW.getTime() + 2));
    await f.quotas.resetMemberQuotas(
      "admin",
      { scope: "organization_members" },
      {},
    );
    expect(
      (await f.usage.currentUsageForLimits("org", f.user("org"))).total,
    ).toMatchObject({ usedCreditMicros: 0n, remainingPercentage: 100 });
    expect(f.records).toHaveLength(5);
  });

  it("preserves unlimited quotas and still follows calendar boundaries after a manual reset", async () => {
    const f = fixture();
    f.user("org").totalCreditLimitMicros = null;
    f.setNow(new Date("2026-09-01T08:00:00Z"));
    await f.quotas.resetMemberQuotas(
      "admin",
      { scope: "organization_members" },
      {},
    );
    f.setNow(NOW);
    f.records.push({
      ownerId: "org",
      observedAt: new Date("2026-09-02T08:00:00Z"),
      usedCreditMicros: 300n,
    });
    const result = await f.usage.currentUsageForLimits("org", f.user("org"));
    expect(result.total).toBeNull();
    expect(result.weekly?.usedCreditMicros).toBe(1_000n);
    expect(result.monthly?.usedCreditMicros).toBe(1_300n);
    expect(result.weekly?.resetAt).toEqual(new Date("2026-09-13T16:00:00Z"));
  });

  it("saves and applies new limits to every organization member while retaining consumed credits", async () => {
    const f = fixture();
    const limits = {
      total_credit_limit: "0.002",
      weekly_credit_limit: null,
      monthly_credit_limit: "0.004",
    };
    const result = await f.quotas.applyOrganizationLimits(
      "admin",
      { limits },
      {},
    );
    expect(result).toEqual({
      updated_user_count: 2,
      settings: { ...defaultQuotaSettings(), organization_members: limits },
    });
    for (const id of ["org", "disabled-org"])
      expect(f.user(id)).toMatchObject({
        totalCreditLimitMicros: 2_000n,
        weeklyCreditLimitMicros: null,
        monthlyCreditLimitMicros: 4_000n,
        creditQuotaResetAt: null,
      });
    expect(f.user("registered").totalCreditLimitMicros).toBe(1_000n);
    expect(f.user("external").totalCreditLimitMicros).toBe(1_000n);
    expect(
      (await f.usage.currentUsageForLimits("org", f.user("org"))).total,
    ).toMatchObject({ usedCreditMicros: 1_000n, remainingPercentage: 50 });
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
          action: "organization_credit_limits_applied",
        }),
      }),
    );
  });

  it("reports an empty target group without changing other users", async () => {
    const f = fixture();
    f.users.splice(2, 1);
    expect(
      await f.quotas.resetMemberQuotas(
        "admin",
        { scope: "self_registered_users" },
        {},
      ),
    ).toEqual({ updated_user_count: 0 });
    expect(f.user("org").creditQuotaResetAt).toBeNull();
  });

  it("rejects invalid groups and limits before making any writes", async () => {
    const f = fixture();
    await expect(
      f.quotas.resetMemberQuotas("admin", { scope: "all" }, {}),
    ).rejects.toThrow();
    await expect(
      f.quotas.resetMemberQuotas(
        "admin",
        { scope: "organization_members", reset_at: NOW.toISOString() },
        {},
      ),
    ).rejects.toThrow();
    await expect(
      f.quotas.applyOrganizationLimits(
        "admin",
        { limits: { total_credit_limit: "0" } },
        {},
      ),
    ).rejects.toThrow();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});
