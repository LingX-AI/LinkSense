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

  it("is idempotent when the natural-month statement already exists", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      billingStatement: {
        findUnique: vi.fn().mockResolvedValue({ id: statementId }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation) => operation(tx)),
    };
    const service = new BillingStatementService(prisma as never, {
      timeZone: "Asia/Shanghai",
      now: () => new Date("2026-03-02T00:00:00.000Z"),
    });

    await expect(service.generateStatement("2026-02")).resolves.toBe(false);
    expect(tx.billingStatement.findUnique).toHaveBeenCalledOnce();
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
