import { describe, expect, it, vi } from "vitest"

import { TokenLimitService } from "../src/modules/usage/token-limit.js"

const USER_ID = "00000000-0000-4000-8000-000000000010"
const NOW = new Date("2026-08-06T04:00:00.000Z")

describe("TokenLimitService", () => {
  it("does not query usage records when no token limit is configured", async () => {
    const fixture = tokenLimitFixture({
      user: {
        status: "active",
        totalTokenLimit: null,
        weeklyTokenLimit: null,
        monthlyTokenLimit: null,
      },
    })

    await fixture.service.assertCanStartTask(USER_ID)

    expect(fixture.prisma.tokenUsageRecord.aggregate).not.toHaveBeenCalled()
    expect(fixture.prisma.modelUsageRecord.aggregate).not.toHaveBeenCalled()
  })

  it("blocks new tasks when the user's weekly quota has already been reached", async () => {
    const fixture = tokenLimitFixture({
      user: {
        status: "active",
        totalTokenLimit: null,
        weeklyTokenLimit: 1_000n,
        monthlyTokenLimit: null,
      },
      tokenUsageTotal: 600n,
      modelUsageTotal: 400n,
    })

    await expect(fixture.service.assertCanStartTask(USER_ID)).rejects.toMatchObject({
      code: "TOKEN_LIMIT_EXCEEDED",
      params: {
        scope: "weekly",
        limit_tokens: "1000",
        used_tokens: "1000",
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
    const fixture = tokenLimitFixture({
      user: {
        status: "active",
        totalTokenLimit: null,
        weeklyTokenLimit: null,
        monthlyTokenLimit: 2_000n,
      },
      tokenUsageTotal: 1_500n,
      modelUsageTotal: 500n,
    })

    await expect(fixture.service.assertCanStartTask(USER_ID)).rejects.toMatchObject({
      code: "TOKEN_LIMIT_EXCEEDED",
      params: {
        scope: "monthly",
        limit_tokens: "2000",
        used_tokens: "2000",
        reset_at: "2026-08-31T16:00:00.000Z",
      },
    })
  })

  it("summarizes current weekly and monthly quota usage for display", async () => {
    const fixture = tokenLimitFixture({
      user: {
        status: "active",
        totalTokenLimit: null,
        weeklyTokenLimit: 1_000n,
        monthlyTokenLimit: 2_000n,
      },
      tokenUsageTotal: 250n,
      modelUsageTotal: 500n,
    })

    const summary = await fixture.service.currentUsageForLimits(USER_ID, {
      totalTokenLimit: null,
      weeklyTokenLimit: 1_000n,
      monthlyTokenLimit: 2_000n,
    })

    expect(summary.weekly).toEqual({
      limitTokens: 1_000n,
      usedTokens: 750n,
      remainingTokens: 250n,
      remainingPercentage: 25,
      resetAt: new Date("2026-08-09T16:00:00.000Z"),
    })
    expect(summary.monthly).toEqual({
      limitTokens: 2_000n,
      usedTokens: 750n,
      remainingTokens: 1_250n,
      remainingPercentage: 63,
      resetAt: new Date("2026-08-31T16:00:00.000Z"),
    })
  })

  it("reports zero remaining percent after the quota is overused", async () => {
    const fixture = tokenLimitFixture({
      user: {
        status: "active",
        totalTokenLimit: null,
        weeklyTokenLimit: 1_000n,
        monthlyTokenLimit: null,
      },
      tokenUsageTotal: 1_100n,
      modelUsageTotal: 200n,
    })

    const summary = await fixture.service.currentUsageForLimits(USER_ID, {
      totalTokenLimit: null,
      weeklyTokenLimit: 1_000n,
      monthlyTokenLimit: null,
    })

    expect(summary.weekly).toMatchObject({
      usedTokens: 1_300n,
      remainingTokens: 0n,
      remainingPercentage: 0,
    })
    expect(summary.monthly).toBeNull()
  })

  it("blocks on the lifetime total quota before a larger periodic quota", async () => {
    const fixture = tokenLimitFixture({
      user: {
        status: "active",
        totalTokenLimit: 1_000n,
        weeklyTokenLimit: 5_000n,
        monthlyTokenLimit: null,
      },
      tokenUsageTotal: 600n,
      modelUsageTotal: 400n,
    })

    await expect(fixture.service.assertCanStartTask(USER_ID)).rejects.toMatchObject({
      code: "TOKEN_LIMIT_EXCEEDED",
      params: {
        scope: "total",
        limit_tokens: "1000",
        used_tokens: "1000",
      },
    })
    expect(fixture.prisma.tokenUsageRecord.aggregate).toHaveBeenCalledWith({
      where: { ownerId: USER_ID },
      _sum: { totalTokens: true },
    })
  })
})

function tokenLimitFixture(input: {
  user: {
    status: string
    totalTokenLimit: bigint | null
    weeklyTokenLimit: bigint | null
    monthlyTokenLimit: bigint | null
  }
  tokenUsageTotal?: bigint
  modelUsageTotal?: bigint
}) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => input.user),
    },
    tokenUsageRecord: {
      aggregate: vi.fn(async () => ({
        _sum: { totalTokens: input.tokenUsageTotal ?? null },
      })),
    },
    modelUsageRecord: {
      aggregate: vi.fn(async () => ({
        _sum: { totalTokens: input.modelUsageTotal ?? null },
      })),
    },
  }
  return {
    prisma,
    service: new TokenLimitService(prisma as never, {
      timeZone: "Asia/Shanghai",
      now: () => new Date(NOW),
    }),
  }
}
