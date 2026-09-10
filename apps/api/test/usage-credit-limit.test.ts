import { describe, expect, it, vi } from "vitest"

import { CreditLimitService } from "../src/modules/usage/credit-limit.js"

const USER_ID = "00000000-0000-4000-8000-000000000010"
const NOW = new Date("2026-08-06T04:00:00.000Z")

describe("CreditLimitService", () => {
  it("does not query usage records when no credit limit is configured", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        totalCreditLimitMicros: null,
        weeklyCreditLimitMicros: null,
        monthlyCreditLimitMicros: null,
      },
    })

    await fixture.service.assertCanStartTask(USER_ID)

    expect(fixture.prisma.tokenUsageRecord.aggregate).not.toHaveBeenCalled()
    expect(fixture.prisma.modelUsageRecord.aggregate).not.toHaveBeenCalled()
  })

  it("allows a positive fractional balance even when the percentage rounds to zero", async () => {
    const fixture = creditLimitFixture({ user: { status: "active", totalCreditLimitMicros: 1_000_000_000n, weeklyCreditLimitMicros: null, monthlyCreditLimitMicros: null }, tokenUsageTotal: 999_999_999n })
    await expect(fixture.service.assertCanStartTask(USER_ID)).resolves.toBeUndefined()
    expect(fixture.prisma.tokenUsageRecord.aggregate).toHaveBeenCalledWith({ where: { ownerId: USER_ID }, _sum: { usedCreditMicros: true } })
  })

  it("rejects disabled users before querying their consumption", async () => {
    const fixture = creditLimitFixture({ user: { status: "disabled", totalCreditLimitMicros: null, weeklyCreditLimitMicros: null, monthlyCreditLimitMicros: null } })
    await expect(fixture.service.assertCanStartTask(USER_ID)).rejects.toMatchObject({ code: "AUTH_REQUIRED" })
    expect(fixture.prisma.tokenUsageRecord.aggregate).not.toHaveBeenCalled()
  })

  it("blocks new tasks when the user's weekly quota has already been reached", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        totalCreditLimitMicros: null,
        weeklyCreditLimitMicros: 1_000n,
        monthlyCreditLimitMicros: null,
      },
      tokenUsageTotal: 600n,
      modelUsageTotal: 400n,
    })

    await expect(fixture.service.assertCanStartTask(USER_ID)).rejects.toMatchObject({
      code: "CREDIT_LIMIT_EXCEEDED",
      params: {
        scope: "weekly",
        limit_credits: "0.001",
        used_credits: "0.001",
        reset_at: "2026-08-09T16:00:00.000Z",
      },
    })
    expect(fixture.prisma.tokenUsageRecord.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          observedAt: {
            gte: new Date("2026-08-02T16:00:00.000Z"),
            lt: new Date("2026-08-09T16:00:00.000Z"),
          },
        }),
      }),
    )
  })

  it("blocks new tasks when the user's monthly quota has already been reached", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        totalCreditLimitMicros: null,
        weeklyCreditLimitMicros: null,
        monthlyCreditLimitMicros: 2_000n,
      },
      tokenUsageTotal: 1_500n,
      modelUsageTotal: 500n,
    })

    await expect(fixture.service.assertCanStartTask(USER_ID)).rejects.toMatchObject({
      code: "CREDIT_LIMIT_EXCEEDED",
      params: {
        scope: "monthly",
        limit_credits: "0.002",
        used_credits: "0.002",
        reset_at: "2026-08-31T16:00:00.000Z",
      },
    })
  })

  it("summarizes current weekly and monthly quota usage for display", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        totalCreditLimitMicros: null,
        weeklyCreditLimitMicros: 1_000n,
        monthlyCreditLimitMicros: 2_000n,
      },
      tokenUsageTotal: 250n,
      modelUsageTotal: 500n,
    })

    const summary = await fixture.service.currentUsageForLimits(USER_ID, {
      creditQuotaResetAt: null,      totalCreditLimitMicros: null,
      weeklyCreditLimitMicros: 1_000n,
      monthlyCreditLimitMicros: 2_000n,
    })

    expect(summary.weekly).toEqual({
      limitCreditMicros: 1_000n,
      usedCreditMicros: 750n,
      remainingCreditMicros: 250n,
      remainingPercentage: 25,
      resetAt: new Date("2026-08-09T16:00:00.000Z"),
    })
    expect(summary.monthly).toEqual({
      limitCreditMicros: 2_000n,
      usedCreditMicros: 750n,
      remainingCreditMicros: 1_250n,
      remainingPercentage: 63,
      resetAt: new Date("2026-08-31T16:00:00.000Z"),
    })
  })

  it("reports zero remaining percent after the quota is overused", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        totalCreditLimitMicros: null,
        weeklyCreditLimitMicros: 1_000n,
        monthlyCreditLimitMicros: null,
      },
      tokenUsageTotal: 1_100n,
      modelUsageTotal: 200n,
    })

    const summary = await fixture.service.currentUsageForLimits(USER_ID, {
      creditQuotaResetAt: null,      totalCreditLimitMicros: null,
      weeklyCreditLimitMicros: 1_000n,
      monthlyCreditLimitMicros: null,
    })

    expect(summary.weekly).toMatchObject({
      usedCreditMicros: 1_300n,
      remainingCreditMicros: 0n,
      remainingPercentage: 0,
    })
    expect(summary.monthly).toBeNull()
  })

  it("blocks on the lifetime total quota before a larger periodic quota", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        totalCreditLimitMicros: 1_000n,
        weeklyCreditLimitMicros: 5_000n,
        monthlyCreditLimitMicros: null,
      },
      tokenUsageTotal: 600n,
      modelUsageTotal: 400n,
    })

    await expect(fixture.service.assertCanStartTask(USER_ID)).rejects.toMatchObject({
      code: "CREDIT_LIMIT_EXCEEDED",
      params: {
        scope: "total",
        limit_credits: "0.001",
        used_credits: "0.001",
      },
    })
    expect(fixture.prisma.tokenUsageRecord.aggregate).toHaveBeenCalledWith({
      where: { ownerId: USER_ID },
      _sum: { usedCreditMicros: true },
    })
  })
})

function creditLimitFixture(input: {
  user: {
    status: string
    totalCreditLimitMicros: bigint | null
    weeklyCreditLimitMicros: bigint | null
    monthlyCreditLimitMicros: bigint | null
  }
  resetAt?: Date
  tokenUsageTotal?: bigint
  modelUsageTotal?: bigint
}) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({ ...input.user, creditQuotaResetAt: input.resetAt ?? null })),
    },
    tokenUsageRecord: {
      aggregate: vi.fn(async () => ({
        _sum: { usedCreditMicros: input.tokenUsageTotal ?? null },
      })),
    },
    modelUsageRecord: {
      aggregate: vi.fn(async () => ({
        _sum: { usedCreditMicros: input.modelUsageTotal ?? null },
      })),
    },
  }
  return {
    prisma,
    service: new CreditLimitService(prisma as never, {
      timeZone: "Asia/Shanghai",
      now: () => new Date(NOW),
    }),
  }
}
