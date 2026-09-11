import { creditMicrosToDecimal } from "@linksense/shared";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

type CreditLimitServiceOptions = {
  timeZone: string;
  now?: () => Date;
};

type DatabaseIntegerAggregate = bigint | Prisma.Decimal | number | null;
type CreditQuotaPeriod = "weekly" | "monthly";

export type CurrentCreditQuotaTotalUsage = {
  limitCreditMicros: bigint;
  usedCreditMicros: bigint;
  remainingCreditMicros: bigint;
  remainingPercentage: number;
};

export type CurrentCreditQuotaPeriodUsage = CurrentCreditQuotaTotalUsage & {
  resetAt: Date;
};

export type CurrentCreditQuotaUsage = {
  total: CurrentCreditQuotaTotalUsage | null;
  weekly: CurrentCreditQuotaPeriodUsage | null;
  monthly: CurrentCreditQuotaPeriodUsage | null;
};

type CreditQuotaLimitInput = {
  totalCreditLimitMicros: bigint | null;
  weeklyCreditLimitMicros: bigint | null;
  monthlyCreditLimitMicros: bigint | null;
  creditQuotaResetAt: Date | null;
};

type CreditQuotaCheck = {
  scope: CreditQuotaPeriod;
  limit: bigint | null;
  start: dayjs.Dayjs;
  end: dayjs.Dayjs;
};

export class CreditLimitService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: CreditLimitServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async assertCanStartTask(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        totalCreditLimitMicros: true,
        weeklyCreditLimitMicros: true,
        monthlyCreditLimitMicros: true,
        creditQuotaResetAt: true,
        status: true,
      },
    });
    if (!user || user.status !== "active") throw new AppError("AUTH_REQUIRED");

    if (
      user.totalCreditLimitMicros === null &&
      user.weeklyCreditLimitMicros === null &&
      user.monthlyCreditLimitMicros === null
    ) {
      return;
    }

    const usage = await this.currentUsageForLimits(userId, {
      totalCreditLimitMicros: user.totalCreditLimitMicros,
      weeklyCreditLimitMicros: user.weeklyCreditLimitMicros,
      monthlyCreditLimitMicros: user.monthlyCreditLimitMicros,
      creditQuotaResetAt: user.creditQuotaResetAt,
    });
    if (
      usage.total &&
      usage.total.usedCreditMicros >= usage.total.limitCreditMicros
    ) {
      throw new AppError("CREDIT_LIMIT_EXCEEDED", {
        scope: "total",
        limit_credits: creditMicrosToDecimal(usage.total.limitCreditMicros),
        used_credits: creditMicrosToDecimal(usage.total.usedCreditMicros),
      });
    }
    for (const [scope, period] of [
      ["weekly", usage.weekly],
      ["monthly", usage.monthly],
    ] as const) {
      if (period && period.usedCreditMicros >= period.limitCreditMicros) {
        throw new AppError("CREDIT_LIMIT_EXCEEDED", {
          scope,
          limit_credits: creditMicrosToDecimal(period.limitCreditMicros),
          used_credits: creditMicrosToDecimal(period.usedCreditMicros),
          reset_at: period.resetAt.toISOString(),
        });
      }
    }
  }

  async currentUsageForLimits(
    userId: string,
    limits: CreditQuotaLimitInput,
  ): Promise<CurrentCreditQuotaUsage> {
    const checks = this.currentChecks(limits);
    const usage: CurrentCreditQuotaUsage = {
      total: null,
      weekly: null,
      monthly: null,
    };
    const totalLimit = limits.totalCreditLimitMicros;
    const totalUsagePromise =
      totalLimit === null
        ? Promise.resolve()
        : this.sumUserCredits(
            userId,
            limits.creditQuotaResetAt ?? undefined,
          ).then((used) => {
            const remaining = totalLimit > used ? totalLimit - used : 0n;
            usage.total = {
              limitCreditMicros: totalLimit,
              usedCreditMicros: used,
              remainingCreditMicros: remaining,
              remainingPercentage: remainingPercentage(remaining, totalLimit),
            };
          });
    await Promise.all([
      totalUsagePromise,
      ...checks.map(async (check) => {
        if (check.limit === null) return;
        const used = await this.sumUserCredits(
          userId,
          limits.creditQuotaResetAt &&
            limits.creditQuotaResetAt > check.start.toDate()
            ? limits.creditQuotaResetAt
            : check.start.toDate(),
          check.end.toDate(),
        );
        const remaining = check.limit > used ? check.limit - used : 0n;
        usage[check.scope] = {
          limitCreditMicros: check.limit,
          usedCreditMicros: used,
          remainingCreditMicros: remaining,
          remainingPercentage: remainingPercentage(remaining, check.limit),
          resetAt: check.end.toDate(),
        };
      }),
    ]);
    return usage;
  }

  private currentChecks(limits: CreditQuotaLimitInput): CreditQuotaCheck[] {
    const now = dayjs(this.now()).tz(this.options.timeZone);
    const weekStart = now.startOf("isoWeek");
    const monthStart = now.startOf("month");
    return [
      {
        scope: "weekly",
        limit: limits.weeklyCreditLimitMicros,
        start: weekStart,
        end: weekStart.add(1, "week"),
      },
      {
        scope: "monthly",
        limit: limits.monthlyCreditLimitMicros,
        start: monthStart,
        end: monthStart.add(1, "month"),
      },
    ];
  }

  private async sumUserCredits(
    userId: string,
    fromInclusive?: Date,
    toExclusive?: Date,
  ): Promise<bigint> {
    const observedAt =
      fromInclusive || toExclusive
        ? {
            observedAt: {
              ...(fromInclusive ? { gte: fromInclusive } : {}),
              ...(toExclusive ? { lt: toExclusive } : {}),
            },
          }
        : {};
    const [conversationUsage, modelUsage] = await Promise.all([
      this.prisma.tokenUsageRecord.aggregate({
        where: {
          ownerId: userId,
          ...observedAt,
        },
        _sum: { usedCreditMicros: true },
      }),
      this.prisma.modelUsageRecord.aggregate({
        where: {
          ownerId: userId,
          ...observedAt,
        },
        _sum: { usedCreditMicros: true },
      }),
    ]);
    return (
      toBigIntAggregate(conversationUsage._sum.usedCreditMicros) +
      toBigIntAggregate(modelUsage._sum.usedCreditMicros)
    );
  }
}

function toBigIntAggregate(
  value: DatabaseIntegerAggregate | undefined,
): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt(value.toString());
}

function remainingPercentage(remaining: bigint, limit: bigint): number {
  if (limit <= 0n) return 0;
  return Number((remaining * 100n + limit / 2n) / limit);
}
