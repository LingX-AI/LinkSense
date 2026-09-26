import {
  billingStatementDetailSchema,
  billingStatementListSchema,
  pricingCurrency,
  type BillingStatementDetail,
  type BillingStatementList,
  type ModelProviderSettings,
} from "@linksense/shared";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

import type {
  BillingStatement,
  BillingStatementLine,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const PICO_USD_PER_USD = 1_000_000_000_000n;
const MICROS_PER_USD = 1_000_000n;

type ModelCatalogReader = {
  getAdminSettings(): Promise<ModelProviderSettings>;
};

type BillingServiceOptions = {
  timeZone: string;
  now?: () => Date;
  modelCatalog?: ModelCatalogReader;
};

type UsageFact = {
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
};

type MutableLine = Omit<UsageFact, "model"> & {
  model: string;
  inputPrices: Set<string>;
  cachedInputPrices: Set<string>;
  outputPrices: Set<string>;
};

export class BillingStatementService {
  readonly timeZone: string;
  private readonly now: () => Date;
  private readonly modelCatalog: ModelCatalogReader | undefined;

  constructor(
    private readonly prisma: PrismaClient,
    options: BillingServiceOptions,
  ) {
    this.timeZone = options.timeZone;
    this.now = options.now ?? (() => new Date());
    this.modelCatalog = options.modelCatalog;
  }

  async generateMissingStatements(): Promise<number> {
    const lastClosedMonth = dayjs(this.now())
      .tz(this.timeZone)
      .startOf("month")
      .subtract(1, "month");
    const earliest = await this.earliestObservedAt();
    const earliestMonth = earliest
      ? dayjs(earliest).tz(this.timeZone).startOf("month")
      : null;
    const firstMonth =
      earliestMonth?.isBefore(lastClosedMonth, "month") === true
        ? earliestMonth
        : lastClosedMonth;
    let generated = 0;

    for (
      let month = firstMonth;
      !month.isAfter(lastClosedMonth, "month");
      month = month.add(1, "month")
    ) {
      if (await this.generateStatement(month.format("YYYY-MM"))) {
        generated += 1;
      }
    }
    return generated;
  }

  async generateStatement(month: string): Promise<boolean> {
    const periodStart = dayjs.tz(`${month}-01T00:00:00`, this.timeZone);
    if (!periodStart.isValid() || periodStart.format("YYYY-MM") !== month) {
      throw new AppError("VALIDATION_ERROR");
    }
    const currentMonth = dayjs(this.now()).tz(this.timeZone).startOf("month");
    if (!periodStart.isBefore(currentMonth)) {
      return false;
    }
    const periodEnd = periodStart.add(1, "month");
    const periodStartDate = periodStart.toDate();
    const periodEndDate = periodEnd.toDate();
    const displayNames = await this.loadDisplayNames();

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`linksense-billing:${this.timeZone}:${month}`}, 0)
        )
      `;
      const existing = await tx.billingStatement.findUnique({
        where: {
          periodStart_timeZone: {
            periodStart: periodStartDate,
            timeZone: this.timeZone,
          },
        },
        select: { id: true },
      });
      if (existing) return false;

      const [tokenFacts, modelFacts] = await Promise.all([
        tx.tokenUsageRecord.findMany({
          where: {
            observedAt: { gte: periodStartDate, lt: periodEndDate },
          },
          select: usageFactSelect,
        }),
        tx.modelUsageRecord.findMany({
          where: {
            observedAt: { gte: periodStartDate, lt: periodEndDate },
          },
          select: usageFactSelect,
        }),
      ]);
      const lines = aggregateUsageFacts([...tokenFacts, ...modelFacts]);
      const generatedAt = this.now();
      const totalCostPicoUsd = lines.reduce(
        (sum, line) => sum + line.totalCostPicoUsd,
        0n,
      );
      const unpricedTokens = lines.reduce(
        (sum, line) => sum + line.unpricedTokens,
        0n,
      );
      const statement = await tx.billingStatement.create({
        data: {
          statementNumber: `LS-${periodStart.format("YYYYMM")}`,
          periodStart: periodStartDate,
          periodEndExclusive: periodEndDate,
          timeZone: this.timeZone,
          currency: pricingCurrency,
          status: "generated",
          totalCostPicoUsd,
          unpricedTokens,
          generatedAt,
        },
      });
      if (lines.length > 0) {
        await tx.billingStatementLine.createMany({
          data: lines.map((line, index) => ({
            statementId: statement.id,
            model: line.model,
            displayName: displayNames.get(line.model) ?? null,
            totalTokens: line.totalTokens,
            inputTokens: line.inputTokens,
            cachedInputTokens: line.cachedInputTokens,
            outputTokens: line.outputTokens,
            reasoningOutputTokens: line.reasoningOutputTokens,
            inputPriceMicrosPerMillion: uniformPrice(line.inputPrices),
            cachedInputPriceMicrosPerMillion: uniformPrice(
              line.cachedInputPrices,
            ),
            outputPriceMicrosPerMillion: uniformPrice(line.outputPrices),
            mixedPricing:
              line.inputPrices.size > 1 ||
              line.cachedInputPrices.size > 1 ||
              line.outputPrices.size > 1,
            inputCostPicoUsd: line.inputCostPicoUsd,
            cachedInputCostPicoUsd: line.cachedInputCostPicoUsd,
            outputCostPicoUsd: line.outputCostPicoUsd,
            totalCostPicoUsd: line.totalCostPicoUsd,
            unpricedTokens: line.unpricedTokens,
            sortOrder: index,
          })),
        });
      }
      return true;
    });
  }

  async list(): Promise<BillingStatementList> {
    const now = dayjs(this.now()).tz(this.timeZone);
    const periodStart = now.startOf("month");
    const periodEnd = periodStart.add(1, "month");
    const statements = await this.prisma.billingStatement.findMany({
      orderBy: [{ periodStart: "desc" }],
    });
    return billingStatementListSchema.parse({
      generated_at: this.now().toISOString(),
      current_period: {
        period: {
          month: periodStart.format("YYYY-MM"),
          from: periodStart.toISOString(),
          to_exclusive: periodEnd.toISOString(),
          time_zone: this.timeZone,
        },
        expected_generation_at: periodEnd.add(5, "minute").toISOString(),
      },
      statements: statements.map(projectSummary),
    });
  }

  async detail(id: string): Promise<BillingStatementDetail> {
    const statement = await this.prisma.billingStatement.findUnique({
      where: { id },
    });
    if (!statement) throw new AppError("NOT_FOUND");
    const lines = await this.prisma.billingStatementLine.findMany({
      where: { statementId: id },
      orderBy: [{ sortOrder: "asc" }],
    });
    return billingStatementDetailSchema.parse({
      ...projectSummary(statement),
      models: lines.map(projectLine),
    });
  }

  private async earliestObservedAt(): Promise<Date | null> {
    const [tokens, models] = await Promise.all([
      this.prisma.tokenUsageRecord.aggregate({ _min: { observedAt: true } }),
      this.prisma.modelUsageRecord.aggregate({ _min: { observedAt: true } }),
    ]);
    const candidates = [tokens._min.observedAt, models._min.observedAt].filter(
      (value): value is Date => value instanceof Date,
    );
    return (
      candidates.sort((left, right) => left.getTime() - right.getTime())[0] ??
      null
    );
  }

  private async loadDisplayNames(): Promise<Map<string, string>> {
    if (!this.modelCatalog) return new Map();
    try {
      const settings = await this.modelCatalog.getAdminSettings();
      return new Map(
        settings.providers.flatMap((provider) =>
          provider.models.flatMap((model) =>
            model.display_name ? [[model.id, model.display_name] as const] : [],
          ),
        ),
      );
    } catch {
      return new Map();
    }
  }
}

const usageFactSelect = {
  model: true,
  totalTokens: true,
  inputTokens: true,
  cachedInputTokens: true,
  outputTokens: true,
  reasoningOutputTokens: true,
  inputPriceMicrosPerMillion: true,
  cachedInputPriceMicrosPerMillion: true,
  outputPriceMicrosPerMillion: true,
  inputCostPicoUsd: true,
  cachedInputCostPicoUsd: true,
  outputCostPicoUsd: true,
  totalCostPicoUsd: true,
  unpricedTokens: true,
} satisfies Prisma.TokenUsageRecordSelect & Prisma.ModelUsageRecordSelect;

function aggregateUsageFacts(facts: UsageFact[]): MutableLine[] {
  const lines = new Map<string, MutableLine>();
  for (const fact of facts) {
    const line = lines.get(fact.model) ?? emptyLine(fact.model);
    line.totalTokens += fact.totalTokens;
    line.inputTokens += fact.inputTokens;
    line.cachedInputTokens += fact.cachedInputTokens;
    line.outputTokens += fact.outputTokens;
    line.reasoningOutputTokens += fact.reasoningOutputTokens;
    line.inputCostPicoUsd += fact.inputCostPicoUsd;
    line.cachedInputCostPicoUsd += fact.cachedInputCostPicoUsd;
    line.outputCostPicoUsd += fact.outputCostPicoUsd;
    line.totalCostPicoUsd += fact.totalCostPicoUsd;
    line.unpricedTokens += fact.unpricedTokens;
    line.inputPrices.add(fact.inputPriceMicrosPerMillion.toString());
    line.cachedInputPrices.add(
      fact.cachedInputPriceMicrosPerMillion.toString(),
    );
    line.outputPrices.add(fact.outputPriceMicrosPerMillion.toString());
    lines.set(fact.model, line);
  }
  return [...lines.values()].sort(
    (left, right) =>
      compareBigIntDescending(left.totalCostPicoUsd, right.totalCostPicoUsd) ||
      left.model.localeCompare(right.model),
  );
}

function emptyLine(model: string): MutableLine {
  return {
    model,
    totalTokens: 0n,
    inputTokens: 0n,
    cachedInputTokens: 0n,
    outputTokens: 0n,
    reasoningOutputTokens: 0n,
    inputPriceMicrosPerMillion: 0n,
    cachedInputPriceMicrosPerMillion: 0n,
    outputPriceMicrosPerMillion: 0n,
    inputCostPicoUsd: 0n,
    cachedInputCostPicoUsd: 0n,
    outputCostPicoUsd: 0n,
    totalCostPicoUsd: 0n,
    unpricedTokens: 0n,
    inputPrices: new Set(),
    cachedInputPrices: new Set(),
    outputPrices: new Set(),
  };
}

function uniformPrice(prices: Set<string>): bigint | null {
  return prices.size === 1 ? BigInt([...prices][0]!) : null;
}

function compareBigIntDescending(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function projectSummary(statement: BillingStatement) {
  return {
    id: statement.id,
    statement_number: statement.statementNumber,
    period: {
      month: dayjs(statement.periodStart)
        .tz(statement.timeZone)
        .format("YYYY-MM"),
      from: statement.periodStart.toISOString(),
      to_exclusive: statement.periodEndExclusive.toISOString(),
      time_zone: statement.timeZone,
    },
    currency: pricingCurrency,
    status: "generated" as const,
    total_cost: picoUsdToDecimal(statement.totalCostPicoUsd),
    unpriced_tokens: statement.unpricedTokens.toString(),
    generated_at: statement.generatedAt.toISOString(),
  };
}

function projectLine(line: BillingStatementLine) {
  return {
    model_id: line.model,
    display_name: line.displayName,
    token_usage: {
      total_tokens: line.totalTokens.toString(),
      input_tokens: line.inputTokens.toString(),
      cached_input_tokens: line.cachedInputTokens.toString(),
      output_tokens: line.outputTokens.toString(),
      reasoning_output_tokens: line.reasoningOutputTokens.toString(),
    },
    cost: {
      currency: pricingCurrency,
      total_cost: picoUsdToDecimal(line.totalCostPicoUsd),
      input_cost: picoUsdToDecimal(line.inputCostPicoUsd),
      cached_input_cost: picoUsdToDecimal(line.cachedInputCostPicoUsd),
      output_cost: picoUsdToDecimal(line.outputCostPicoUsd),
      unpriced_tokens: line.unpricedTokens.toString(),
    },
    pricing: {
      mode: line.mixedPricing ? ("mixed" as const) : ("uniform" as const),
      input_price_per_million: microsToDecimal(line.inputPriceMicrosPerMillion),
      cached_input_price_per_million: microsToDecimal(
        line.cachedInputPriceMicrosPerMillion,
      ),
      output_price_per_million: microsToDecimal(
        line.outputPriceMicrosPerMillion,
      ),
    },
  };
}

function picoUsdToDecimal(value: bigint): string {
  return integerToDecimal(value, PICO_USD_PER_USD, 12);
}

function microsToDecimal(value: bigint | null): string | null {
  return value === null ? null : integerToDecimal(value, MICROS_PER_USD, 6);
}

function integerToDecimal(
  value: bigint,
  divisor: bigint,
  decimalPlaces: number,
): string {
  const whole = value / divisor;
  const fraction = (value % divisor)
    .toString()
    .padStart(decimalPlaces, "0")
    .replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
