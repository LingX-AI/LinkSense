import { assertExecutionPrincipalActive } from "../../lib/execution-principal.js";
import { creditMicrosToDecimal, type PersonalQuotaOverview } from "@linksense/shared";
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
type CreditQuotaPeriod = "weekly";

export type CurrentCreditQuotaPeriodUsage = {
  limitCreditMicros: bigint;
  usedCreditMicros: bigint;
  remainingCreditMicros: bigint;
  remainingPercentage: number;
  resetAt: Date;
};

export type CurrentCreditQuotaUsage = {
  weekly: CurrentCreditQuotaPeriodUsage | null;
};

type CreditQuotaLimitInput = {
  weeklyCreditLimitMicros: bigint | null;
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
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        weeklyCreditLimitMicros: true,
        creditQuotaResetAt: true,
        status: true,
      },
    });
    if (!user) {
      await assertExecutionPrincipalActive(this.prisma, userId);
      user = await this.prisma.applicationExternalSession.findUnique({ where: { runtimePrincipalId: userId }, select: {
        weeklyCreditLimitMicros: true, creditQuotaResetAt: true, status: true,
      } });
    }
    if (!user || user.status !== "active") throw new AppError("AUTH_REQUIRED");

    if (user.weeklyCreditLimitMicros === null) {
      return;
    }

    const usage = await this.currentUsageForLimits(userId, {
      weeklyCreditLimitMicros: user.weeklyCreditLimitMicros,
      creditQuotaResetAt: user.creditQuotaResetAt,
    });
    for (const [scope, period] of [
      ["weekly", usage.weekly],
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

  async personalOverview(userId: string): Promise<PersonalQuotaOverview> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { weeklyCreditLimitMicros: true, creditQuotaResetAt: true, status: true },
    });
    if (!user || user.status !== "active") throw new AppError("AUTH_REQUIRED");
    const [week] = this.currentChecks(user);
    if (!week) throw new Error("Missing weekly credit period");
    const from =
      user.weeklyCreditLimitMicros !== null &&
      user.creditQuotaResetAt &&
      user.creditQuotaResetAt > week.start.toDate()
        ? user.creditQuotaResetAt
        : week.start.toDate();
    const used = await this.sumUserCredits(userId, from, week.end.toDate());
    const limit = user.weeklyCreditLimitMicros;
    return {
      limit: limit === null ? null : creditMicrosToDecimal(limit),
      used: creditMicrosToDecimal(used),
      remaining: limit === null ? null : creditMicrosToDecimal(limit > used ? limit - used : 0n),
      reset_at: week.end.toISOString(),
      time_zone: this.options.timeZone,
    };
  }

  async currentUsageForLimits(
    userId: string,
    limits: CreditQuotaLimitInput,
  ): Promise<CurrentCreditQuotaUsage> {
    const checks = this.currentChecks(limits);
    const usage: CurrentCreditQuotaUsage = {
      weekly: null,
    };
    await Promise.all(
      checks.map(async (check) => {
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
    );
    return usage;
  }

  private currentChecks(limits: CreditQuotaLimitInput): CreditQuotaCheck[] {
    const now = dayjs(this.now()).tz(this.options.timeZone);
    const weekStart = now.startOf("isoWeek");
    return [
      {
        scope: "weekly",
        limit: limits.weeklyCreditLimitMicros,
        start: weekStart,
        end: weekStart.add(1, "week"),
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
