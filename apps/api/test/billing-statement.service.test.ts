import { describe, expect, it, vi } from "vitest";

import { BillingStatementService } from "../src/modules/usage/billing-service.js";

describe("BillingStatementService", () => {
  it("creates one immutable monthly line per model from both usage ledgers", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      billingStatement: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: statementId }),
      },
      tokenUsageRecord: {
        findMany: vi.fn().mockResolvedValue([
          usageFact({
            model: "gpt-5",
            inputTokens: 100n,
            totalTokens: 150n,
            outputTokens: 50n,
            inputCostPicoUsd: 100_000_000_000n,
            outputCostPicoUsd: 200_000_000_000n,
            totalCostPicoUsd: 300_000_000_000n,
          }),
        ]),
      },
      modelUsageRecord: {
        findMany: vi.fn().mockResolvedValue([
          usageFact({
            model: "gpt-5",
            inputTokens: 20n,
            totalTokens: 20n,
            inputCostPicoUsd: 20_000_000_000n,
            totalCostPicoUsd: 20_000_000_000n,
          }),
          usageFact({
            model: "text-embedding-3-large",
            inputTokens: 300n,
            totalTokens: 300n,
            unpricedTokens: 300n,
          }),
        ]),
      },
      billingStatementLine: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation) => operation(tx)),
    };
    const service = new BillingStatementService(prisma as never, {
      timeZone: "Asia/Shanghai",
      now: () => new Date("2026-03-02T00:00:00.000Z"),
    });

    await expect(service.generateStatement("2026-02")).resolves.toBe(true);

    expect(tx.billingStatement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        statementNumber: "LS-202602",
        currency: "USD",
        totalCostPicoUsd: 320_000_000_000n,
        unpricedTokens: 300n,
      }),
    });
    expect(tx.billingStatementLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          model: "gpt-5",
          totalTokens: 170n,
          inputTokens: 120n,
          outputTokens: 50n,
          totalCostPicoUsd: 320_000_000_000n,
          mixedPricing: false,
          sortOrder: 0,
        }),
        expect.objectContaining({
          model: "text-embedding-3-large",
          totalTokens: 300n,
          unpricedTokens: 300n,
          sortOrder: 1,
        }),
      ],
    });
  });

  it.each([
    {
      month: "2026-03",
      from: "2026-03-01T05:00:00.000Z",
      to: "2026-04-01T04:00:00.000Z",
      generationAt: "2026-04-01T04:05:00.000Z",
    },
    {
      month: "2026-11",
      from: "2026-11-01T04:00:00.000Z",
      to: "2026-12-01T05:00:00.000Z",
      generationAt: "2026-12-01T05:05:00.000Z",
    },
  ])("uses the same local boundaries for preview and generation in $month", async ({
    month, from, to, generationAt,
  }) => {
    let now = new Date(`${month}-15T12:00:00.000Z`);
    const { service, prisma } = newYorkBillingFixture(() => now);

    const preview = await service.list();
    now = new Date(generationAt);
    const generated = await service.generateMissingStatements();
    const next = await service.list();

    expect.soft(preview.current_period).toEqual({
      period: { month, from, to_exclusive: to, time_zone: "America/New_York" },
      expected_generation_at: generationAt,
    });
    expect.soft(generated).toBe(1);
    expect.soft(prisma.billingStatement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        periodStart: new Date(from),
        periodEndExclusive: new Date(to),
      }),
    });
    for (const ledger of [prisma.tokenUsageRecord, prisma.modelUsageRecord]) {
      expect.soft(ledger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { observedAt: { gte: new Date(from), lt: new Date(to) } },
        }),
      );
    }
    expect(next.current_period.period.from).toBe(to);
  });

  it("does not regenerate or reinterpret a statement issued before the DST fix", async () => {
    const { service, prisma } = newYorkBillingFixture(
      () => new Date("2026-04-01T04:05:00.000Z"),
    );
    const saved = {
      id: statementId,
      statementNumber: "LS-202603",
      periodStart: new Date("2026-03-01T05:00:00.000Z"),
      periodEndExclusive: new Date("2026-04-01T05:00:00.000Z"),
      timeZone: "America/New_York",
      totalCostPicoUsd: 320_000_000_000n,
      unpricedTokens: 0n,
      generatedAt: new Date("2026-04-01T05:05:00.000Z"),
    };
    prisma.billingStatement.findUnique.mockResolvedValue(saved);
    prisma.billingStatement.findMany.mockResolvedValue([saved]);

    await expect(service.generateStatement("2026-03")).resolves.toBe(false);
    expect(prisma.billingStatement.findUnique).toHaveBeenCalledWith({
      where: {
        periodStart_timeZone: {
          periodStart: saved.periodStart,
          timeZone: saved.timeZone,
        },
      },
      select: { id: true },
    });
    expect(prisma.billingStatement.create).not.toHaveBeenCalled();

    const persisted = {
      id: statementId,
      period: { to_exclusive: "2026-04-01T05:00:00.000Z" },
      total_cost: "0.32",
    };
    expect((await service.list()).statements[0]).toMatchObject(persisted);
    await expect(service.detail(statementId)).resolves.toMatchObject(persisted);
  });

  it("does not finalize the current calendar month", async () => {
    const prisma = { $transaction: vi.fn() };
    const service = new BillingStatementService(prisma as never, {
      timeZone: "Asia/Shanghai",
      now: () => new Date("2026-03-15T00:00:00.000Z"),
    });

    await expect(service.generateStatement("2026-03")).resolves.toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

const statementId = "00000000-0000-4000-8000-000000000901";

function newYorkBillingFixture(now: () => Date) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    billingStatement: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: statementId }),
    },
    tokenUsageRecord: {
      aggregate: vi.fn().mockResolvedValue({ _min: { observedAt: null } }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    modelUsageRecord: {
      aggregate: vi.fn().mockResolvedValue({ _min: { observedAt: null } }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    ...tx,
    billingStatementLine: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (operation) => operation(tx)),
  };
  return {
    prisma,
    service: new BillingStatementService(prisma as never, {
      timeZone: "America/New_York",
      now,
    }),
  };
}

function usageFact(
  overrides: Partial<{
    model: string;
    totalTokens: bigint;
    inputTokens: bigint;
    cachedInputTokens: bigint;
    outputTokens: bigint;
    reasoningOutputTokens: bigint;
    inputPriceMicrosPerMillion: bigint;
    cachedInputPriceMicrosPerMillion: bigint;
    outputPriceMicrosPerMillion: bigint;
    inputCostPicoUsd: bigint;
    cachedInputCostPicoUsd: bigint;
    outputCostPicoUsd: bigint;
    totalCostPicoUsd: bigint;
    unpricedTokens: bigint;
  }> = {},
) {
  return {
    model: "gpt-5",
    totalTokens: 0n,
    inputTokens: 0n,
    cachedInputTokens: 0n,
    outputTokens: 0n,
    reasoningOutputTokens: 0n,
    inputPriceMicrosPerMillion: 1_000_000n,
    cachedInputPriceMicrosPerMillion: 500_000n,
    outputPriceMicrosPerMillion: 2_000_000n,
    inputCostPicoUsd: 0n,
    cachedInputCostPicoUsd: 0n,
    outputCostPicoUsd: 0n,
    totalCostPicoUsd: 0n,
    unpricedTokens: 0n,
    ...overrides,
  };
}
