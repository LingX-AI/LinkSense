import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

type TokenLimitServiceOptions = {
  timeZone: string;
  now?: () => Date;
};

type DatabaseIntegerAggregate = bigint | Prisma.Decimal | number | null;
type TokenQuotaPeriod = "weekly" | "monthly";

export type CurrentTokenQuotaTotalUsage = {
  limitTokens: bigint;
  usedTokens: bigint;
  remainingTokens: bigint;
  remainingPercentage: number;
};

export type CurrentTokenQuotaPeriodUsage = CurrentTokenQuotaTotalUsage & {
  resetAt: Date;
};

export type CurrentTokenQuotaUsage = {
  total: CurrentTokenQuotaTotalUsage | null;
  weekly: CurrentTokenQuotaPeriodUsage | null;
  monthly: CurrentTokenQuotaPeriodUsage | null;
};

type TokenQuotaLimitInput = {
  totalTokenLimit: bigint | null;
  weeklyTokenLimit: bigint | null;
  monthlyTokenLimit: bigint | null;
};

type TokenQuotaCheck = {
  scope: TokenQuotaPeriod;
  limit: bigint | null;
  start: dayjs.Dayjs;
  end: dayjs.Dayjs;
};

export class TokenLimitService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: TokenLimitServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async assertCanStartTask(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        totalTokenLimit: true,
        weeklyTokenLimit: true,
        monthlyTokenLimit: true,
        status: true,
      },
    });
    if (!user || user.status !== "active") throw new AppError("AUTH_REQUIRED");

    if (
      user.totalTokenLimit === null &&
      user.weeklyTokenLimit === null &&
      user.monthlyTokenLimit === null
    ) {
      return;
    }

    const usage = await this.currentUsageForLimits(userId, {
      totalTokenLimit: user.totalTokenLimit,
      weeklyTokenLimit: user.weeklyTokenLimit,
      monthlyTokenLimit: user.monthlyTokenLimit,
    });
    if (usage.total && usage.total.usedTokens >= usage.total.limitTokens) {
      throw new AppError("TOKEN_LIMIT_EXCEEDED", {
        scope: "total",
        limit_tokens: usage.total.limitTokens.toString(),
        used_tokens: usage.total.usedTokens.toString(),
      });
    }
    for (const [scope, period] of [
      ["weekly", usage.weekly],
      ["monthly", usage.monthly],
    ] as const) {
      if (period && period.usedTokens >= period.limitTokens) {
        throw new AppError("TOKEN_LIMIT_EXCEEDED", {
          scope,
          limit_tokens: period.limitTokens.toString(),
          used_tokens: period.usedTokens.toString(),
          reset_at: period.resetAt.toISOString(),
        });
      }
    }
  }

  async currentUsageForLimits(
    userId: string,
    limits: TokenQuotaLimitInput,
  ): Promise<CurrentTokenQuotaUsage> {
    const checks = this.currentChecks(limits);
    const usage: CurrentTokenQuotaUsage = {
      total: null,
      weekly: null,
      monthly: null,
    };
    const totalLimit = limits.totalTokenLimit;
    const totalUsagePromise =
      totalLimit === null
        ? Promise.resolve()
        : this.sumUserTokens(userId).then((used) => {
            const remaining = totalLimit > used ? totalLimit - used : 0n;
            usage.total = {
              limitTokens: totalLimit,
              usedTokens: used,
              remainingTokens: remaining,
              remainingPercentage: remainingPercentage(remaining, totalLimit),
            };
          });
    await Promise.all(
      [
        totalUsagePromise,
        ...checks.map(async (check) => {
          if (check.limit === null) return;
          const used = await this.sumUserTokens(
            userId,
            check.start.toDate(),
            check.end.toDate(),
          );
          const remaining = check.limit > used ? check.limit - used : 0n;
          usage[check.scope] = {
            limitTokens: check.limit,
            usedTokens: used,
            remainingTokens: remaining,
            remainingPercentage: remainingPercentage(remaining, check.limit),
            resetAt: check.end.toDate(),
          };
        }),
      ],
    );
    return usage;
  }

  private currentChecks(limits: TokenQuotaLimitInput): TokenQuotaCheck[] {
    const now = dayjs(this.now()).tz(this.options.timeZone);
    const weekStart = now.startOf("isoWeek");
    const monthStart = now.startOf("month");
    return [
      {
        scope: "weekly",
        limit: limits.weeklyTokenLimit,
        start: weekStart,
        end: weekStart.add(1, "week"),
      },
      {
        scope: "monthly",
        limit: limits.monthlyTokenLimit,
        start: monthStart,
        end: monthStart.add(1, "month"),
      },
    ];
  }

  private async sumUserTokens(
    userId: string,
    fromInclusive?: Date,
    toExclusive?: Date,
  ): Promise<bigint> {
    const observedAt =
      fromInclusive && toExclusive
        ? { observedAt: { gte: fromInclusive, lt: toExclusive } }
        : {};
    const [conversationUsage, modelUsage] = await Promise.all([
      this.prisma.tokenUsageRecord.aggregate({
        where: {
          ownerId: userId,
          ...observedAt,
        },
        _sum: { totalTokens: true },
      }),
      this.prisma.modelUsageRecord.aggregate({
        where: {
          ownerId: userId,
          ...observedAt,
        },
        _sum: { totalTokens: true },
      }),
    ]);
    return (
      toBigIntAggregate(conversationUsage._sum.totalTokens) +
      toBigIntAggregate(modelUsage._sum.totalTokens)
    );
  }
}

function toBigIntAggregate(value: DatabaseIntegerAggregate | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt(value.toString());
}

function remainingPercentage(remaining: bigint, limit: bigint): number {
  if (limit <= 0n) return 0;
  return Number((remaining * 100n + limit / 2n) / limit);
}
