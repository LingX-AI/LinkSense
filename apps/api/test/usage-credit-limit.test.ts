import { describe, expect, it, vi } from "vitest"

import { CreditLimitService } from "../src/modules/usage/credit-limit.js"

const USER_ID = "00000000-0000-4000-8000-000000000010"
const NOW = new Date("2026-08-06T04:00:00.000Z")

describe("CreditLimitService", () => {
  it("shows the full current-week consumption for unlimited members after a manual reset", async () => {
    const fixture = creditLimitFixture({
      user: { status: "active", weeklyCreditLimitMicros: null },
      tokenUsageTotal: 1n,
      modelUsageTotal: 2n,
      resetAt: new Date("2026-08-05T04:00:00Z"),
    })
    expect(await fixture.service.personalOverview(USER_ID)).toEqual({
      limit: null,
      used: "0.000003",
      remaining: null,
      reset_at: "2026-08-09T16:00:00.000Z",
      time_zone: "Asia/Shanghai",
    })
    expect(fixture.prisma.tokenUsageRecord.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: USER_ID,
          observedAt: {
            gte: new Date("2026-08-02T16:00:00.000Z"),
            lt: new Date("2026-08-09T16:00:00.000Z"),
          },
        },
      })
    )
  })

  it("uses the manual reset boundary for overview and clamps overdrawn remaining credits", async () => {
    const resetAt = new Date("2026-08-05T04:00:00Z")
    const fixture = creditLimitFixture({ user: { status: "active", weeklyCreditLimitMicros: 1n }, tokenUsageTotal: 2n, resetAt })
    expect(await fixture.service.personalOverview(USER_ID)).toMatchObject({ limit: "0.000001", used: "0.000002", remaining: "0" })
    expect(fixture.prisma.tokenUsageRecord.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: USER_ID, observedAt: { gte: resetAt, lt: new Date("2026-08-09T16:00:00Z") } } }))
  })

  it("rejects inactive members from their personal overview", async () => {
    const fixture = creditLimitFixture({ user: { status: "disabled", weeklyCreditLimitMicros: null } })
    await expect(fixture.service.personalOverview(USER_ID)).rejects.toMatchObject({ code: "AUTH_REQUIRED" })
    expect(fixture.prisma.tokenUsageRecord.aggregate).not.toHaveBeenCalled()
  })
  it("does not query usage records when no credit limit is configured", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        weeklyCreditLimitMicros: null,
      },
    })

    await fixture.service.assertCanStartTask(USER_ID)

    expect(fixture.prisma.tokenUsageRecord.aggregate).not.toHaveBeenCalled()
    expect(fixture.prisma.modelUsageRecord.aggregate).not.toHaveBeenCalled()
  })

  it("allows a positive fractional balance even when the percentage rounds to zero", async () => {
    const fixture = creditLimitFixture({ user: { status: "active", weeklyCreditLimitMicros: 1_000_000_000n }, tokenUsageTotal: 999_999_999n })
    await expect(fixture.service.assertCanStartTask(USER_ID)).resolves.toBeUndefined()
    expect(fixture.prisma.tokenUsageRecord.aggregate).toHaveBeenCalledWith({ where: { ownerId: USER_ID, observedAt: { gte: new Date("2026-08-02T16:00:00.000Z"), lt: new Date("2026-08-09T16:00:00.000Z") } }, _sum: { usedCreditMicros: true } })
  })

  it("rejects disabled users before querying their consumption", async () => {
    const fixture = creditLimitFixture({ user: { status: "disabled", weeklyCreditLimitMicros: null } })
    await expect(fixture.service.assertCanStartTask(USER_ID)).rejects.toMatchObject({ code: "AUTH_REQUIRED" })
    expect(fixture.prisma.tokenUsageRecord.aggregate).not.toHaveBeenCalled()
  })

  it("blocks new tasks when the user's weekly quota has already been reached", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        weeklyCreditLimitMicros: 1_000n,
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

  it("summarizes current weekly quota usage for display", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        weeklyCreditLimitMicros: 1_000n,
      },
      tokenUsageTotal: 250n,
      modelUsageTotal: 500n,
    })

    const summary = await fixture.service.currentUsageForLimits(USER_ID, {
      creditQuotaResetAt: null,
      weeklyCreditLimitMicros: 1_000n,
    })

    expect(summary.weekly).toEqual({
      limitCreditMicros: 1_000n,
      usedCreditMicros: 750n,
      remainingCreditMicros: 250n,
      remainingPercentage: 25,
      resetAt: new Date("2026-08-09T16:00:00.000Z"),
    })
  })

  it("reports zero remaining percent after the quota is overused", async () => {
    const fixture = creditLimitFixture({
      user: {
        status: "active",
        weeklyCreditLimitMicros: 1_000n,
      },
      tokenUsageTotal: 1_100n,
      modelUsageTotal: 200n,
    })

    const summary = await fixture.service.currentUsageForLimits(USER_ID, {
      creditQuotaResetAt: null,
      weeklyCreditLimitMicros: 1_000n,
    })

    expect(summary.weekly).toMatchObject({
      usedCreditMicros: 1_300n,
      remainingCreditMicros: 0n,
      remainingPercentage: 0,
    })
  })

})

function creditLimitFixture(input: {
  user: {
    status: string
    weeklyCreditLimitMicros: bigint | null
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
