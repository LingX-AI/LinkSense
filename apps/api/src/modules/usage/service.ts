import { createHash } from "node:crypto";

import {
  applicationUsageReportSchema,
  modelTokenPricingSchema,
  personalUsageProfileQuerySchema,
  personalUsageProfileSchema,
  runnerCodexTokenUsageParamsSchema,
  usageAnalyticsReportQuerySchema,
  usageAnalyticsReportSchema,
  usageMeasurementMethodSchema,
  usageModelKindSchema,
  usageWorkloadSchema,
  type ModelProviderSettings,
  type ModelTokenPricing,
  type ApplicationUsageReport,
  type PersonalUsageProfile,
  type UsageAnalyticsReport,
  type UsageAnalyticsReportQuery,
  type UsageApplicationBreakdown,
  type UsageCostBreakdown,
  type UsageGroupBreakdown,
  type UsageMeasurementMethod,
  type UsageMetrics,
  type UsageModelBreakdown,
  type UsageModelKind,
  type UsageTokenBreakdown,
  type UsageTokenTrendGranularity,
  type UsageWorkload,
  type UsageWorkloadBreakdown,
} from "@linksense/shared";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import {
  calculatePriceAndCostSnapshot,
  modelUsageCaptureSchema,
  type ModelUsageCapture,
  type ModelUsageRecorder,
} from "./model-usage.js";

const USAGE_ANALYTICS_STATE_ID = "00000000-0000-4000-8000-000000000001";
const UNKNOWN_USAGE_MODEL_ID = "__unknown__";
const UNATTRIBUTED_APPLICATION_KEY = "__unattributed__";
const PICO_CNY_PER_CNY = 1_000_000_000_000n;

dayjs.extend(utc);
dayjs.extend(timezone);

type TokenFields = {
  totalTokens: bigint;
  inputTokens: bigint;
  cachedInputTokens: bigint;
  outputTokens: bigint;
  reasoningOutputTokens: bigint;
};

type CostFields = {
  inputCostPicoCny: bigint;
  cachedInputCostPicoCny: bigint;
  outputCostPicoCny: bigint;
  totalCostPicoCny: bigint;
  unpricedTokens: bigint;
};

type MutableModelUsage = {
  modelId: string;
  modelKind: UsageModelKind;
  turnCount: number;
  requestCount: number;
  workloadTypes: Set<UsageWorkload>;
  measurementMethods: Set<UsageMeasurementMethod>;
  tokens: TokenFields;
  cost: CostFields;
};

type MutableWorkloadUsage = {
  requestCount: number;
  measurementMethods: Set<UsageMeasurementMethod>;
  tokens: TokenFields;
  cost: CostFields;
};

type MutableSkillUsage = {
  skillId: string;
  name: string;
  usageCount: number;
  preferredNameCount: number;
};

type MutableUsage = {
  taskCount: number;
  turnCount: number;
  requestCount: number;
  tokens: TokenFields;
  cost: CostFields;
  models: Map<string, MutableModelUsage>;
  workloads: Map<UsageWorkload, MutableWorkloadUsage>;
};

type MutableApplicationUsage = {
  applicationId: string | null;
  applicationName: string;
  preferredNameCount: number;
  usage: MutableUsage;
};

type ModelCatalogReader = {
  getAdminSettings(): Promise<ModelProviderSettings>;
};

type UsageAnalyticsOptions = {
  now?: () => Date;
  modelCatalog?: ModelCatalogReader;
};

type UsageReportPeriod = {
  from: Date | null;
  to: Date;
  upperBoundExclusive: Date;
  timeZone: string;
};

type DatabaseIntegerAggregate = bigint | Prisma.Decimal | null;

type TokenTrendAggregateRow = {
  totalTokens: DatabaseIntegerAggregate;
  inputTokens: DatabaseIntegerAggregate;
  cachedInputTokens: DatabaseIntegerAggregate;
  outputTokens: DatabaseIntegerAggregate;
  reasoningOutputTokens: DatabaseIntegerAggregate;
  inputCostPicoCny: DatabaseIntegerAggregate;
  cachedInputCostPicoCny: DatabaseIntegerAggregate;
  outputCostPicoCny: DatabaseIntegerAggregate;
  totalCostPicoCny: DatabaseIntegerAggregate;
  unpricedTokens: DatabaseIntegerAggregate;
  periodStart: string;
  workload: string;
  measurementMethod: string;
  requestCount: bigint | null;
};

type PersonalDailyTokenAggregateRow = {
  periodStart: string;
  totalTokens: DatabaseIntegerAggregate;
};

type ModelCatalogSnapshot = {
  displayNames: Map<string, string>;
  pricing: Map<string, ModelTokenPricing>;
};

export class UsageAnalyticsService implements ModelUsageRecorder {
  private readonly now: () => Date;
  private readonly modelCatalog: ModelCatalogReader | undefined;

  constructor(
    private readonly prisma: PrismaClient,
    options: UsageAnalyticsOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.modelCatalog = options.modelCatalog;
  }

  async captureTokenUsage(
    conversationId: string,
    rawParams: unknown,
  ): Promise<{
    accepted: boolean;
    ignored?: boolean;
    reason_code?: string;
  }> {
    const params = runnerCodexTokenUsageParamsSchema.parse(rawParams);
    const observedAt = this.now();
    const catalog = await this.loadModelCatalog();

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`linksense-token-usage:${params.threadId}`}, 0)
        )
      `;

      const conversation = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: {
          ownerId: true,
          codexThreadId: true,
          applicationId: true,
          applicationNameSnapshot: true,
        },
      });
      if (!conversation || conversation.codexThreadId !== params.threadId) {
        return {
          accepted: true,
          ignored: true,
          reason_code: "STALE_BRANCH",
        };
      }

      const turn = await tx.conversationTurn.findFirst({
        where: {
          conversationId,
          codexThreadId: params.threadId,
          codexTurnId: params.turnId,
        },
        select: { id: true, model: true, startedAt: true },
      });
      if (!turn) {
        return {
          accepted: false,
          reason_code: "TURN_PROJECTION_PENDING",
        };
      }

      const existingState = await tx.usageAnalyticsState.findUnique({
        where: { id: USAGE_ANALYTICS_STATE_ID },
      });
      const state =
        existingState ??
        (await tx.usageAnalyticsState.upsert({
          where: { id: USAGE_ANALYTICS_STATE_ID },
          create: {
            id: USAGE_ANALYTICS_STATE_ID,
            tokenMeasurementStartedAt: observedAt,
            createdAt: observedAt,
            updatedAt: observedAt,
          },
          update: {},
        }));
      const cursor = await tx.codexThreadTokenUsageCursor.findUnique({
        where: { codexThreadId: params.threadId },
      });
      const total = toBigIntTokens(params.tokenUsage.total);
      const last = toBigIntTokens(params.tokenUsage.last);

      if (
        !isValidTokenSubset(total) ||
        !isValidTokenSubset(last) ||
        !isComponentwiseAtMost(last, total)
      ) {
        return {
          accepted: true,
          ignored: true,
          reason_code: "TOKEN_USAGE_INVALID",
        };
      }

      if (cursor && !isMonotonicSnapshot(cursor, total)) {
        return {
          accepted: true,
          ignored: true,
          reason_code: "TOKEN_USAGE_REGRESSION",
        };
      }

      const delta = cursor
        ? subtractTokens(total, cursor)
        : turn.startedAt >= state.tokenMeasurementStartedAt
          ? last
          : emptyTokens();
      if (!isValidTokenSubset(delta)) {
        return {
          accepted: true,
          ignored: true,
          reason_code: "TOKEN_USAGE_INVALID",
        };
      }
      const snapshotKey = tokenUsageSnapshotKey(params.turnId, total);
      const model = turn.model ?? UNKNOWN_USAGE_MODEL_ID;

      let recorded = false;
      if (!isZeroTokens(delta)) {
        const costSnapshot = calculatePriceAndCostSnapshot(
          delta,
          catalog.pricing.get(model) ?? null,
        );
        const inserted = await tx.tokenUsageRecord.createMany({
          data: [
            {
              snapshotKey,
              ownerId: conversation.ownerId,
              conversationId,
              applicationId: conversation.applicationId,
              applicationNameSnapshot: conversation.applicationNameSnapshot,
              turnId: turn.id,
              codexThreadId: params.threadId,
              codexTurnId: params.turnId,
              model,
              ...delta,
              ...costSnapshot,
              observedAt,
              createdAt: observedAt,
            },
          ],
          skipDuplicates: true,
        });
        recorded = inserted.count === 1;
      }

      await tx.codexThreadTokenUsageCursor.upsert({
        where: { codexThreadId: params.threadId },
        create: {
          codexThreadId: params.threadId,
          ownerId: conversation.ownerId,
          conversationId,
          lastCodexTurnId: params.turnId,
          ...total,
          lastTotalTokens: last.totalTokens,
          modelContextWindow:
            params.tokenUsage.modelContextWindow === null
              ? null
              : BigInt(params.tokenUsage.modelContextWindow),
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          createdAt: observedAt,
          updatedAt: observedAt,
        },
        update: {
          ownerId: conversation.ownerId,
          conversationId,
          lastCodexTurnId: params.turnId,
          ...total,
          lastTotalTokens: last.totalTokens,
          modelContextWindow:
            params.tokenUsage.modelContextWindow === null
              ? null
              : BigInt(params.tokenUsage.modelContextWindow),
          lastObservedAt: observedAt,
          updatedAt: observedAt,
        },
      });

      return {
        accepted: true,
        ...(!recorded ? { ignored: true } : {}),
      };
    });
  }

  async recordModelUsage(
    rawInput: ModelUsageCapture,
  ): Promise<{ recorded: boolean }> {
    const input = modelUsageCaptureSchema.parse(rawInput);
    const observedAt = input.observedAt ?? this.now();
    const tokens = toBigIntTokens(input.tokenUsage);
    const costSnapshot = calculatePriceAndCostSnapshot(tokens, input.pricing);
    const application = input.conversationId
      ? await this.prisma.conversation.findUnique({
          where: { id: input.conversationId },
          select: {
            applicationId: true,
            applicationNameSnapshot: true,
          },
        })
      : null;
    const inserted = await this.prisma.modelUsageRecord.createMany({
      data: [
        {
          requestId: input.requestId,
          ownerId: input.ownerId,
          ...(input.conversationId
            ? { conversationId: input.conversationId }
            : {}),
          ...(application?.applicationId && application.applicationNameSnapshot
            ? {
                applicationId: application.applicationId,
                applicationNameSnapshot: application.applicationNameSnapshot,
              }
            : {}),
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.knowledgeBaseId
            ? { knowledgeBaseId: input.knowledgeBaseId }
            : {}),
          ...(input.documentId ? { documentId: input.documentId } : {}),
          ...(input.documentVersionId
            ? { documentVersionId: input.documentVersionId }
            : {}),
          ...(input.processingGeneration
            ? { processingGeneration: input.processingGeneration }
            : {}),
          ...(input.operation ? { operation: input.operation } : {}),
          workload: input.workload,
          modelKind: input.modelKind,
          model: input.model,
          measurementMethod: input.measurementMethod,
          ...tokens,
          ...costSnapshot,
          observedAt,
          createdAt: observedAt,
        },
      ],
      skipDuplicates: true,
    });
    return { recorded: inserted.count === 1 };
  }

  async personalProfile(
    userId: string,
    rawQuery: unknown,
  ): Promise<PersonalUsageProfile> {
    const query = personalUsageProfileQuerySchema.parse(rawQuery);
    const generatedAt = this.now();
    const today = dayjs(generatedAt).tz(query.time_zone).startOf("day");
    const activityFrom = today.subtract(364, "day");
    const activityUpperBoundExclusive = today.add(1, "day").toDate();

    const [
      state,
      catalog,
      taskCount,
      turnRows,
      skillRows,
      tokenRows,
      modelUsageRows,
      dailyRows,
    ] = await Promise.all([
      this.prisma.usageAnalyticsState.findUnique({
        where: { id: USAGE_ANALYTICS_STATE_ID },
      }),
      this.loadModelCatalog(),
      this.prisma.usageActivityRecord.count({
        where: { ownerId: userId, activityType: "task_created" },
      }),
      this.prisma.usageActivityRecord.groupBy({
        by: ["model"],
        where: { ownerId: userId, activityType: "turn_started" },
        _count: { _all: true },
      }),
      this.prisma.usageActivityRecord.groupBy({
        by: ["capabilityId", "capabilityName"],
        where: {
          ownerId: userId,
          activityType: "skill_used",
          capabilityId: { not: null },
          capabilityName: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.tokenUsageRecord.groupBy({
        by: ["model"],
        where: { ownerId: userId },
        _sum: {
          totalTokens: true,
          inputTokens: true,
          cachedInputTokens: true,
          outputTokens: true,
          reasoningOutputTokens: true,
          inputCostPicoCny: true,
          cachedInputCostPicoCny: true,
          outputCostPicoCny: true,
          totalCostPicoCny: true,
          unpricedTokens: true,
        },
      }),
      this.prisma.modelUsageRecord.groupBy({
        by: ["model", "modelKind", "workload", "measurementMethod"],
        where: { ownerId: userId },
        _sum: {
          requestCount: true,
          totalTokens: true,
          inputTokens: true,
          cachedInputTokens: true,
          outputTokens: true,
          reasoningOutputTokens: true,
          inputCostPicoCny: true,
          cachedInputCostPicoCny: true,
          outputCostPicoCny: true,
          totalCostPicoCny: true,
          unpricedTokens: true,
        },
      }),
      this.loadPersonalDailyTokenActivity({
        userId,
        upperBoundExclusive: activityUpperBoundExclusive,
        timeZone: query.time_zone,
      }),
    ]);

    const usage = emptyUsage();
    usage.taskCount = taskCount;
    for (const row of turnRows) {
      applyGenerationTurns(
        usage,
        row.model ?? UNKNOWN_USAGE_MODEL_ID,
        row._count._all,
      );
    }
    for (const row of tokenRows) {
      applyGenerationUsage(
        usage,
        row.model,
        nullableTokenSum(row._sum),
        nullableCostSum(row._sum),
      );
    }
    for (const row of modelUsageRows) {
      applyModelUsage(usage, {
        modelId: row.model,
        modelKind: usageModelKindSchema.parse(row.modelKind),
        workload: usageWorkloadSchema.parse(row.workload),
        measurementMethod: usageMeasurementMethodSchema.parse(
          row.measurementMethod,
        ),
        requestCount: toSafeCount(row._sum.requestCount),
        tokens: nullableTokenSum(row._sum),
        cost: nullableCostSum(row._sum),
      });
    }
    const skills = projectSkills(skillRows);
    const skillUsageCount = skills.reduce(
      (total, skill) => total + skill.usage_count,
      0,
    );

    const dailyTotals = new Map<string, bigint>();
    let peakDailyTokens = 0n;
    for (const row of dailyRows) {
      const totalTokens = normalizeDatabaseIntegerAggregate(row.totalTokens);
      dailyTotals.set(row.periodStart, totalTokens);
      if (totalTokens > peakDailyTokens) peakDailyTokens = totalTokens;
    }
    const activeDates = new Set(
      [...dailyTotals]
        .filter(([, totalTokens]) => totalTokens > 0n)
        .map(([date]) => date),
    );
    const streaks = usageActivityStreaks(activeDates, today, query.time_zone);
    const dailyActivity = [];
    let cursor = activityFrom;
    while (!cursor.isAfter(today, "day")) {
      const date = cursor.format("YYYY-MM-DD");
      dailyActivity.push({
        date,
        total_tokens: (dailyTotals.get(date) ?? 0n).toString(),
      });
      cursor = cursor.add(1, "day");
    }

    return personalUsageProfileSchema.parse({
      generated_at: generatedAt.toISOString(),
      activity_period: {
        from: activityFrom.format("YYYY-MM-DD"),
        to: today.format("YYYY-MM-DD"),
        time_zone: query.time_zone,
      },
      token_coverage: {
        started_at: (
          state?.tokenMeasurementStartedAt ?? generatedAt
        ).toISOString(),
      },
      metrics: {
        task_count: usage.taskCount,
        turn_count: usage.turnCount,
        request_count: usage.requestCount,
        skill_usage_count: skillUsageCount,
        token_usage: projectTokens(usage.tokens),
      },
      peak_daily_tokens: peakDailyTokens.toString(),
      active_days: activeDates.size,
      current_streak_days: streaks.current,
      longest_streak_days: streaks.longest,
      daily_activity: dailyActivity,
      models: projectModels(usage.models, catalog.displayNames).map(
        (model) => ({
          model_id: model.model_id,
          display_name: model.display_name,
          model_kind: model.model_kind,
          request_count: model.request_count,
          turn_count: model.turn_count,
          token_usage: model.token_usage,
        }),
      ),
      skills,
    });
  }

  async report(rawQuery: unknown): Promise<UsageAnalyticsReport> {
    const query = usageAnalyticsReportQuerySchema.parse(rawQuery);
    const range = query.range;
    const generatedAt = this.now();
    const period = reportPeriod(query, generatedAt);
    const from = period.from;
    const dateWindow = from
      ? { gte: from, lt: period.upperBoundExclusive }
      : { lt: period.upperBoundExclusive };

    const [state, catalog, tokenUsageBounds, modelUsageBounds] =
      await Promise.all([
        this.prisma.usageAnalyticsState.findUnique({
          where: { id: USAGE_ANALYTICS_STATE_ID },
        }),
        this.loadModelCatalog(),
        this.prisma.tokenUsageRecord.aggregate({
          _min: { observedAt: true },
        }),
        this.prisma.modelUsageRecord.aggregate({
          _min: { observedAt: true },
        }),
      ]);
    const measurementStartedAt =
      state?.tokenMeasurementStartedAt ?? generatedAt;
    const earliestUsageAt = earliestDefinedDate(
      tokenUsageBounds._min.observedAt,
      modelUsageBounds._min.observedAt,
    );
    const tokenTrendFrom = period.from ?? earliestUsageAt ?? generatedAt;
    const tokenTrendTo = earlierDate(period.to, generatedAt);
    const tokenTrendUpperBoundExclusive = earlierDate(
      period.upperBoundExclusive,
      nextMillisecond(generatedAt),
    );

    const [
      users,
      applications,
      groups,
      memberships,
      taskRows,
      turnRows,
      tokenRows,
      modelUsageRows,
      tokenTrend,
    ] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: [{ name: "asc" }, { email: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
        },
      }),
      this.prisma.application.findMany({
        select: { id: true, name: true },
      }),
      this.prisma.userGroup.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true },
      }),
      this.prisma.userGroupMember.findMany({
        where: { status: "active" },
        select: { userId: true, userGroupId: true },
      }),
      this.prisma.usageActivityRecord.groupBy({
        by: ["ownerId", "applicationId", "applicationNameSnapshot"],
        where: {
          activityType: "task_created",
          occurredAt: dateWindow,
        },
        _count: { _all: true },
      }),
      this.prisma.usageActivityRecord.groupBy({
        by: ["ownerId", "model", "applicationId", "applicationNameSnapshot"],
        where: {
          activityType: "turn_started",
          occurredAt: dateWindow,
        },
        _count: { _all: true },
      }),
      this.prisma.tokenUsageRecord.groupBy({
        by: ["ownerId", "model", "applicationId", "applicationNameSnapshot"],
        where: { observedAt: dateWindow },
        _sum: {
          totalTokens: true,
          inputTokens: true,
          cachedInputTokens: true,
          outputTokens: true,
          reasoningOutputTokens: true,
          inputCostPicoCny: true,
          cachedInputCostPicoCny: true,
          outputCostPicoCny: true,
          totalCostPicoCny: true,
          unpricedTokens: true,
        },
      }),
      this.prisma.modelUsageRecord.groupBy({
        by: [
          "ownerId",
          "model",
          "modelKind",
          "workload",
          "measurementMethod",
          "applicationId",
          "applicationNameSnapshot",
        ],
        where: { observedAt: dateWindow },
        _sum: {
          requestCount: true,
          totalTokens: true,
          inputTokens: true,
          cachedInputTokens: true,
          outputTokens: true,
          reasoningOutputTokens: true,
          inputCostPicoCny: true,
          cachedInputCostPicoCny: true,
          outputCostPicoCny: true,
          totalCostPicoCny: true,
          unpricedTokens: true,
        },
      }),
      this.loadTokenTrend({
        from: tokenTrendFrom,
        to: tokenTrendTo,
        upperBoundExclusive: tokenTrendUpperBoundExclusive,
        timeZone: period.timeZone,
      }),
    ]);

    const userUsage = new Map(users.map((user) => [user.id, emptyUsage()]));
    const applicationUsage = new Map<string, MutableApplicationUsage>();
    const globalUsage = emptyUsage();
    for (const row of taskRows) {
      globalUsage.taskCount += row._count._all;
      const usage = userUsage.get(row.ownerId);
      if (usage) usage.taskCount += row._count._all;
      applicationUsageFor(
        applicationUsage,
        row.applicationId ?? null,
        row.applicationNameSnapshot ?? null,
        row._count._all,
      ).usage.taskCount += row._count._all;
    }
    for (const row of turnRows) {
      const modelId = row.model ?? UNKNOWN_USAGE_MODEL_ID;
      applyGenerationTurns(globalUsage, modelId, row._count._all);
      const usage = userUsage.get(row.ownerId);
      if (usage) applyGenerationTurns(usage, modelId, row._count._all);
      applyGenerationTurns(
        applicationUsageFor(
          applicationUsage,
          row.applicationId ?? null,
          row.applicationNameSnapshot ?? null,
          row._count._all,
        ).usage,
        modelId,
        row._count._all,
      );
    }
    for (const row of tokenRows) {
      const tokens = nullableTokenSum(row._sum);
      const cost = nullableCostSum(row._sum);
      applyGenerationUsage(globalUsage, row.model, tokens, cost);
      const usage = userUsage.get(row.ownerId);
      if (usage) applyGenerationUsage(usage, row.model, tokens, cost);
      applyGenerationUsage(
        applicationUsageFor(
          applicationUsage,
          row.applicationId ?? null,
          row.applicationNameSnapshot ?? null,
          1,
        ).usage,
        row.model,
        tokens,
        cost,
      );
    }
    for (const row of modelUsageRows) {
      const modelKind = usageModelKindSchema.parse(row.modelKind);
      const workload = usageWorkloadSchema.parse(row.workload);
      const measurementMethod = usageMeasurementMethodSchema.parse(
        row.measurementMethod,
      );
      const requestCount = toSafeCount(row._sum.requestCount);
      const tokens = nullableTokenSum(row._sum);
      const cost = nullableCostSum(row._sum);
      applyModelUsage(globalUsage, {
        modelId: row.model,
        modelKind,
        workload,
        measurementMethod,
        requestCount,
        tokens,
        cost,
      });
      const usage = userUsage.get(row.ownerId);
      if (usage) {
        applyModelUsage(usage, {
          modelId: row.model,
          modelKind,
          workload,
          measurementMethod,
          requestCount,
          tokens,
          cost,
        });
      }
      applyModelUsage(
        applicationUsageFor(
          applicationUsage,
          row.applicationId ?? null,
          row.applicationNameSnapshot ?? null,
          requestCount,
        ).usage,
        {
          modelId: row.model,
          modelKind,
          workload,
          measurementMethod,
          requestCount,
          tokens,
          cost,
        },
      );
    }

    const currentApplicationNames = new Map(
      applications.map((application) => [application.id, application.name]),
    );
    const applicationRows: UsageApplicationBreakdown[] = [
      ...applicationUsage.values(),
    ]
      .sort((left, right) => compareUsage(left.usage, right.usage))
      .map((application) => ({
        application_id: application.applicationId,
        application_name:
          application.applicationId === null
            ? "Unattributed"
            : (currentApplicationNames.get(application.applicationId) ??
              application.applicationName),
        is_unattributed: application.applicationId === null,
        metrics: projectMetrics(application.usage),
        models: projectModels(application.usage.models, catalog.displayNames),
      }));

    const groupById = new Map(groups.map((group) => [group.id, group]));
    const groupIdsByUser = new Map<string, Set<string>>();
    const memberIdsByGroup = new Map<string, Set<string>>();
    for (const membership of memberships) {
      if (
        !groupById.has(membership.userGroupId) ||
        !userUsage.has(membership.userId)
      ) {
        continue;
      }
      const userGroups = groupIdsByUser.get(membership.userId) ?? new Set();
      userGroups.add(membership.userGroupId);
      groupIdsByUser.set(membership.userId, userGroups);
      const groupMembers =
        memberIdsByGroup.get(membership.userGroupId) ?? new Set();
      groupMembers.add(membership.userId);
      memberIdsByGroup.set(membership.userGroupId, groupMembers);
    }

    const userRows = users.map((user) => {
      const usage = userUsage.get(user.id) ?? emptyUsage();
      const userGroups = [...(groupIdsByUser.get(user.id) ?? [])]
        .flatMap((groupId) => {
          const group = groupById.get(groupId);
          return group ? [group] : [];
        })
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
      return {
        user_id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        groups: userGroups,
        metrics: projectMetrics(usage),
        models: projectModels(usage.models, catalog.displayNames),
      };
    });

    const groupRows: UsageGroupBreakdown[] = groups.map((group) => {
      const memberIds = [...(memberIdsByGroup.get(group.id) ?? [])];
      const usage = combineUsage(
        memberIds.map((userId) => userUsage.get(userId) ?? emptyUsage()),
      );
      return {
        group_id: group.id,
        group_name: group.name,
        is_ungrouped: false,
        member_count: memberIds.length,
        metrics: projectMetrics(usage),
        models: projectModels(usage.models, catalog.displayNames),
      };
    });
    const ungroupedUserIds = users
      .filter((user) => (groupIdsByUser.get(user.id)?.size ?? 0) === 0)
      .map((user) => user.id);
    const ungroupedUsage = combineUsage(
      ungroupedUserIds.map((userId) => userUsage.get(userId) ?? emptyUsage()),
    );
    groupRows.push({
      group_id: null,
      group_name: "Ungrouped",
      is_ungrouped: true,
      member_count: ungroupedUserIds.length,
      metrics: projectMetrics(ungroupedUsage),
      models: projectModels(ungroupedUsage.models, catalog.displayNames),
    });

    return usageAnalyticsReportSchema.parse({
      range,
      generated_at: generatedAt.toISOString(),
      period: {
        from: from?.toISOString() ?? null,
        to: period.to.toISOString(),
        time_zone: period.timeZone,
      },
      token_coverage: {
        started_at: measurementStartedAt.toISOString(),
        complete_for_period: from !== null && from >= measurementStartedAt,
      },
      group_semantics: "current_membership_coverage",
      totals: projectMetrics(globalUsage),
      token_trend: tokenTrend,
      workloads: projectWorkloads(globalUsage.workloads),
      models: projectModels(globalUsage.models, catalog.displayNames),
      applications: applicationRows,
      groups: groupRows,
      users: userRows,
    });
  }

  async applicationReport(
    ownerId: string,
    applicationId: string,
    rawQuery: unknown,
  ): Promise<ApplicationUsageReport> {
    const query = usageAnalyticsReportQuerySchema.parse(rawQuery);
    const application = await this.prisma.application.findFirst({
      where: {
        id: applicationId,
        ownerId,
        status: { in: ["active", "disabled"] },
      },
      select: { id: true, name: true },
    });
    if (!application) throw new AppError("APPLICATION_NOT_FOUND");

    const generatedAt = this.now();
    const period = reportPeriod(query, generatedAt);
    const dateWindow = period.from
      ? { gte: period.from, lt: period.upperBoundExclusive }
      : { lt: period.upperBoundExclusive };
    const [state, catalog, tokenUsageBounds, modelUsageBounds] =
      await Promise.all([
        this.prisma.usageAnalyticsState.findUnique({
          where: { id: USAGE_ANALYTICS_STATE_ID },
        }),
        this.loadModelCatalog(),
        this.prisma.tokenUsageRecord.aggregate({
          where: { applicationId },
          _min: { observedAt: true },
        }),
        this.prisma.modelUsageRecord.aggregate({
          where: { applicationId },
          _min: { observedAt: true },
        }),
      ]);
    const measurementStartedAt =
      state?.tokenMeasurementStartedAt ?? generatedAt;
    const earliestUsageAt = earliestDefinedDate(
      tokenUsageBounds._min.observedAt,
      modelUsageBounds._min.observedAt,
    );
    const tokenTrendFrom = period.from ?? earliestUsageAt ?? generatedAt;
    const tokenTrendTo = earlierDate(period.to, generatedAt);
    const tokenTrendUpperBoundExclusive = earlierDate(
      period.upperBoundExclusive,
      nextMillisecond(generatedAt),
    );

    const [taskRows, turnRows, tokenRows, modelUsageRows, tokenTrend] =
      await Promise.all([
        this.prisma.usageActivityRecord.groupBy({
          by: ["ownerId"],
          where: {
            applicationId,
            activityType: "task_created",
            occurredAt: dateWindow,
          },
          _count: { _all: true },
        }),
        this.prisma.usageActivityRecord.groupBy({
          by: ["ownerId", "model"],
          where: {
            applicationId,
            activityType: "turn_started",
            occurredAt: dateWindow,
          },
          _count: { _all: true },
        }),
        this.prisma.tokenUsageRecord.groupBy({
          by: ["ownerId", "model"],
          where: { applicationId, observedAt: dateWindow },
          _sum: {
            totalTokens: true,
            inputTokens: true,
            cachedInputTokens: true,
            outputTokens: true,
            reasoningOutputTokens: true,
            inputCostPicoCny: true,
            cachedInputCostPicoCny: true,
            outputCostPicoCny: true,
            totalCostPicoCny: true,
            unpricedTokens: true,
          },
        }),
        this.prisma.modelUsageRecord.groupBy({
          by: [
            "ownerId",
            "model",
            "modelKind",
            "workload",
            "measurementMethod",
          ],
          where: { applicationId, observedAt: dateWindow },
          _sum: {
            requestCount: true,
            totalTokens: true,
            inputTokens: true,
            cachedInputTokens: true,
            outputTokens: true,
            reasoningOutputTokens: true,
            inputCostPicoCny: true,
            cachedInputCostPicoCny: true,
            outputCostPicoCny: true,
            totalCostPicoCny: true,
            unpricedTokens: true,
          },
        }),
        this.loadTokenTrend({
          from: tokenTrendFrom,
          to: tokenTrendTo,
          upperBoundExclusive: tokenTrendUpperBoundExclusive,
          timeZone: period.timeZone,
          applicationId,
        }),
      ]);

    const usage = emptyUsage();
    const activeUserIds = new Set<string>();
    for (const row of taskRows) {
      usage.taskCount += row._count._all;
      activeUserIds.add(row.ownerId);
    }
    for (const row of turnRows) {
      applyGenerationTurns(
        usage,
        row.model ?? UNKNOWN_USAGE_MODEL_ID,
        row._count._all,
      );
      activeUserIds.add(row.ownerId);
    }
    for (const row of tokenRows) {
      applyGenerationUsage(
        usage,
        row.model,
        nullableTokenSum(row._sum),
        nullableCostSum(row._sum),
      );
    }
    for (const row of modelUsageRows) {
      applyModelUsage(usage, {
        modelId: row.model,
        modelKind: usageModelKindSchema.parse(row.modelKind),
        workload: usageWorkloadSchema.parse(row.workload),
        measurementMethod: usageMeasurementMethodSchema.parse(
          row.measurementMethod,
        ),
        requestCount: toSafeCount(row._sum.requestCount),
        tokens: nullableTokenSum(row._sum),
        cost: nullableCostSum(row._sum),
      });
    }

    return applicationUsageReportSchema.parse({
      application,
      range: query.range,
      generated_at: generatedAt.toISOString(),
      period: {
        from: period.from?.toISOString() ?? null,
        to: period.to.toISOString(),
        time_zone: period.timeZone,
      },
      token_coverage: {
        started_at: measurementStartedAt.toISOString(),
        complete_for_period:
          period.from !== null && period.from >= measurementStartedAt,
      },
      active_user_count: activeUserIds.size,
      totals: projectMetrics(usage),
      token_trend: tokenTrend,
      workloads: projectWorkloads(usage.workloads),
      models: projectModels(usage.models, catalog.displayNames),
    });
  }

  private async loadTokenTrend(input: {
    from: Date;
    to: Date;
    upperBoundExclusive: Date;
    timeZone: string;
    applicationId?: string;
  }): Promise<{
    granularity: UsageTokenTrendGranularity;
    points: Array<{
      period_start: string;
      token_usage: UsageTokenBreakdown;
      cost: UsageCostBreakdown;
      workloads: UsageWorkloadBreakdown[];
    }>;
  }> {
    const granularity = tokenTrendGranularity(
      input.from,
      input.to,
      input.timeZone,
    );
    if (input.from > input.to) return { granularity, points: [] };

    const rows = await this.prisma.$queryRaw<TokenTrendAggregateRow[]>`
      WITH "all_usage" AS (
        SELECT
          "observed_at",
          "application_id" AS "applicationId",
          'assistant_response'::text AS "workload",
          'provider'::text AS "measurementMethod",
          "turn_id"::text AS "requestId",
          "total_tokens",
          "input_tokens",
          "cached_input_tokens",
          "output_tokens",
          "reasoning_output_tokens",
          "input_cost_pico_cny",
          "cached_input_cost_pico_cny",
          "output_cost_pico_cny",
          "total_cost_pico_cny",
          "unpriced_tokens"
        FROM "token_usage_records"
        UNION ALL
        SELECT
          "observed_at",
          "application_id" AS "applicationId",
          "workload",
          "measurement_method" AS "measurementMethod",
          "request_id"::text AS "requestId",
          "total_tokens",
          "input_tokens",
          "cached_input_tokens",
          "output_tokens",
          "reasoning_output_tokens",
          "input_cost_pico_cny",
          "cached_input_cost_pico_cny",
          "output_cost_pico_cny",
          "total_cost_pico_cny",
          "unpriced_tokens"
        FROM "model_usage_records"
      )
      SELECT
        TO_CHAR(
          DATE_TRUNC(${granularity}, "observed_at" AT TIME ZONE ${input.timeZone}),
          'YYYY-MM-DD'
        ) AS "periodStart",
        "workload",
        "measurementMethod",
        COUNT(DISTINCT "requestId") AS "requestCount",
        SUM("total_tokens") AS "totalTokens",
        SUM("input_tokens") AS "inputTokens",
        SUM("cached_input_tokens") AS "cachedInputTokens",
        SUM("output_tokens") AS "outputTokens",
        SUM("reasoning_output_tokens") AS "reasoningOutputTokens",
        SUM("input_cost_pico_cny") AS "inputCostPicoCny",
        SUM("cached_input_cost_pico_cny") AS "cachedInputCostPicoCny",
        SUM("output_cost_pico_cny") AS "outputCostPicoCny",
        SUM("total_cost_pico_cny") AS "totalCostPicoCny",
        SUM("unpriced_tokens") AS "unpricedTokens"
      FROM "all_usage"
      WHERE "observed_at" >= ${input.from}
        AND "observed_at" < ${input.upperBoundExclusive}
        AND (
          ${input.applicationId ?? null}::uuid IS NULL
          OR "applicationId" = ${input.applicationId ?? null}::uuid
        )
      GROUP BY 1, 2, 3
      ORDER BY 1 ASC, 2 ASC, 3 ASC
    `;
    if (rows.length === 0) return { granularity, points: [] };

    const rowsByPeriod = new Map<string, MutableUsage>();
    for (const row of rows) {
      const workload = usageWorkloadSchema.parse(row.workload);
      const measurementMethod = usageMeasurementMethodSchema.parse(
        row.measurementMethod,
      );
      const usage = rowsByPeriod.get(row.periodStart) ?? emptyUsage();
      const requestCount = toSafeCount(row.requestCount);
      const tokens = nullableTokenSum(row);
      const cost = nullableCostSum(row);
      usage.requestCount += requestCount;
      addTokens(usage.tokens, tokens);
      addCost(usage.cost, cost);
      const workloadUsage = workloadUsageFor(usage.workloads, workload);
      workloadUsage.requestCount += requestCount;
      workloadUsage.measurementMethods.add(measurementMethod);
      addTokens(workloadUsage.tokens, tokens);
      addCost(workloadUsage.cost, cost);
      rowsByPeriod.set(row.periodStart, usage);
    }

    const points = [];
    let cursor = dayjs(input.from).tz(input.timeZone).startOf(granularity);
    const last = dayjs(input.to).tz(input.timeZone).startOf(granularity);
    while (!cursor.isAfter(last)) {
      const periodStart = cursor.format("YYYY-MM-DD");
      const usage = rowsByPeriod.get(periodStart) ?? emptyUsage();
      points.push({
        period_start: periodStart,
        token_usage: projectTokens(usage.tokens),
        cost: projectCost(usage.cost),
        workloads: projectWorkloads(usage.workloads),
      });
      cursor = cursor.add(1, granularity);
    }
    return { granularity, points };
  }

  private async loadPersonalDailyTokenActivity(input: {
    userId: string;
    upperBoundExclusive: Date;
    timeZone: string;
  }): Promise<PersonalDailyTokenAggregateRow[]> {
    return this.prisma.$queryRaw<PersonalDailyTokenAggregateRow[]>`
      WITH "personal_usage" AS (
        SELECT
          "observed_at",
          "total_tokens"
        FROM "token_usage_records"
        WHERE "owner_id" = ${input.userId}::uuid
        UNION ALL
        SELECT
          "observed_at",
          "total_tokens"
        FROM "model_usage_records"
        WHERE "owner_id" = ${input.userId}::uuid
      )
      SELECT
        TO_CHAR(
          DATE_TRUNC('day', "observed_at" AT TIME ZONE ${input.timeZone}),
          'YYYY-MM-DD'
        ) AS "periodStart",
        SUM("total_tokens") AS "totalTokens"
      FROM "personal_usage"
      WHERE "observed_at" < ${input.upperBoundExclusive}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
  }

  private async loadModelCatalog(): Promise<ModelCatalogSnapshot> {
    if (!this.modelCatalog) {
      return { displayNames: new Map(), pricing: new Map() };
    }
    try {
      const settings = await this.modelCatalog.getAdminSettings();
      const displayNames = new Map<string, string>();
      const pricing = new Map<string, ModelTokenPricing>();
      for (const provider of settings.providers) {
        for (const model of provider.models) {
          displayNames.set(model.id, model.display_name);
          const parsedPricing = modelTokenPricingSchema.safeParse({
            input_price_per_million: model.input_price_per_million,
            cached_input_price_per_million:
              model.kind === "chat"
                ? model.cached_input_price_per_million
                : model.input_price_per_million,
            output_price_per_million:
              model.kind === "chat" ? model.output_price_per_million : "0",
          });
          if (parsedPricing.success) pricing.set(model.id, parsedPricing.data);
        }
      }
      return { displayNames, pricing };
    } catch {
      return { displayNames: new Map(), pricing: new Map() };
    }
  }
}

function reportPeriod(
  query: UsageAnalyticsReportQuery,
  generatedAt: Date,
): UsageReportPeriod {
  if (query.range === "all") {
    return {
      from: null,
      to: generatedAt,
      upperBoundExclusive: nextMillisecond(generatedAt),
      timeZone: query.time_zone,
    };
  }
  if (query.range === "custom") {
    if (!query.date_from || !query.date_to) {
      throw new Error("validated custom usage period is incomplete");
    }
    return {
      from: dayjs.tz(query.date_from, query.time_zone).startOf("day").toDate(),
      to: dayjs.tz(query.date_to, query.time_zone).endOf("day").toDate(),
      upperBoundExclusive: dayjs
        .tz(query.date_to, query.time_zone)
        .add(1, "day")
        .startOf("day")
        .toDate(),
      timeZone: query.time_zone,
    };
  }

  const numberOfDays = query.range === "7d" ? 7 : 30;
  return {
    from: dayjs(generatedAt)
      .tz(query.time_zone)
      .subtract(numberOfDays - 1, "day")
      .startOf("day")
      .toDate(),
    to: generatedAt,
    upperBoundExclusive: nextMillisecond(generatedAt),
    timeZone: query.time_zone,
  };
}

function tokenTrendGranularity(
  from: Date,
  to: Date,
  timeZone: string,
): UsageTokenTrendGranularity {
  const startDay = dayjs(from).tz(timeZone).startOf("day");
  const endDay = dayjs(to).tz(timeZone).startOf("day");
  const daySpan = Math.max(0, endDay.diff(startDay, "day"));
  if (daySpan <= 90) return "day";
  if (daySpan <= 1_460) return "month";
  return "year";
}

function usageActivityStreaks(
  activeDates: Set<string>,
  today: ReturnType<typeof dayjs>,
  timeZone: string,
): { current: number; longest: number } {
  let longest = 0;
  let running = 0;
  let previous: ReturnType<typeof dayjs> | null = null;
  for (const date of [...activeDates].sort()) {
    const current = dayjs.tz(date, timeZone);
    if (!current.isValid()) continue;
    running =
      previous !== null && current.diff(previous, "day") === 1
        ? running + 1
        : 1;
    longest = Math.max(longest, running);
    previous = current;
  }

  let current = 0;
  let cursor = activeDates.has(today.format("YYYY-MM-DD"))
    ? today
    : today.subtract(1, "day");
  while (activeDates.has(cursor.format("YYYY-MM-DD"))) {
    current += 1;
    cursor = cursor.subtract(1, "day");
  }
  return { current, longest };
}

function earliestDefinedDate(
  left: Date | null,
  right: Date | null,
): Date | null {
  if (left === null) return right;
  if (right === null) return left;
  return left <= right ? left : right;
}

function earlierDate(left: Date, right: Date): Date {
  return left <= right ? left : right;
}

function nextMillisecond(value: Date): Date {
  return new Date(value.getTime() + 1);
}

function toBigIntTokens(value: {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}): TokenFields {
  return {
    totalTokens: BigInt(value.totalTokens),
    inputTokens: BigInt(value.inputTokens),
    cachedInputTokens: BigInt(value.cachedInputTokens),
    outputTokens: BigInt(value.outputTokens),
    reasoningOutputTokens: BigInt(value.reasoningOutputTokens),
  };
}

function nullableTokenSum(value: {
  totalTokens: DatabaseIntegerAggregate;
  inputTokens: DatabaseIntegerAggregate;
  cachedInputTokens: DatabaseIntegerAggregate;
  outputTokens: DatabaseIntegerAggregate;
  reasoningOutputTokens: DatabaseIntegerAggregate;
}): TokenFields {
  return {
    totalTokens: normalizeDatabaseIntegerAggregate(value.totalTokens),
    inputTokens: normalizeDatabaseIntegerAggregate(value.inputTokens),
    cachedInputTokens: normalizeDatabaseIntegerAggregate(
      value.cachedInputTokens,
    ),
    outputTokens: normalizeDatabaseIntegerAggregate(value.outputTokens),
    reasoningOutputTokens: normalizeDatabaseIntegerAggregate(
      value.reasoningOutputTokens,
    ),
  };
}

function nullableCostSum(value: {
  inputCostPicoCny: DatabaseIntegerAggregate;
  cachedInputCostPicoCny: DatabaseIntegerAggregate;
  outputCostPicoCny: DatabaseIntegerAggregate;
  totalCostPicoCny: DatabaseIntegerAggregate;
  unpricedTokens: DatabaseIntegerAggregate;
}): CostFields {
  return {
    inputCostPicoCny: normalizeDatabaseIntegerAggregate(value.inputCostPicoCny),
    cachedInputCostPicoCny: normalizeDatabaseIntegerAggregate(
      value.cachedInputCostPicoCny,
    ),
    outputCostPicoCny: normalizeDatabaseIntegerAggregate(
      value.outputCostPicoCny,
    ),
    totalCostPicoCny: normalizeDatabaseIntegerAggregate(value.totalCostPicoCny),
    unpricedTokens: normalizeDatabaseIntegerAggregate(value.unpricedTokens),
  };
}

function normalizeDatabaseIntegerAggregate(
  value: DatabaseIntegerAggregate,
): bigint {
  if (value === null) return 0n;
  if (typeof value === "bigint") return value;
  if (!value.isInteger() || value.isNegative()) {
    throw new TypeError("usage aggregate must be a non-negative integer");
  }
  return BigInt(value.toFixed(0));
}

function emptyTokens(): TokenFields {
  return {
    totalTokens: 0n,
    inputTokens: 0n,
    cachedInputTokens: 0n,
    outputTokens: 0n,
    reasoningOutputTokens: 0n,
  };
}

function emptyCost(): CostFields {
  return {
    inputCostPicoCny: 0n,
    cachedInputCostPicoCny: 0n,
    outputCostPicoCny: 0n,
    totalCostPicoCny: 0n,
    unpricedTokens: 0n,
  };
}

function emptyUsage(): MutableUsage {
  return {
    taskCount: 0,
    turnCount: 0,
    requestCount: 0,
    tokens: emptyTokens(),
    cost: emptyCost(),
    models: new Map(),
    workloads: new Map(),
  };
}

function applicationUsageFor(
  applications: Map<string, MutableApplicationUsage>,
  applicationId: string | null,
  applicationName: string | null,
  namePreferenceCount: number,
): MutableApplicationUsage {
  const key = applicationId ?? UNATTRIBUTED_APPLICATION_KEY;
  const current = applications.get(key);
  const candidateName =
    applicationId === null
      ? "Unattributed"
      : (applicationName ?? applicationId);
  if (current) {
    if (
      applicationName !== null &&
      namePreferenceCount > current.preferredNameCount
    ) {
      current.applicationName = candidateName;
      current.preferredNameCount = namePreferenceCount;
    }
    return current;
  }
  const created: MutableApplicationUsage = {
    applicationId,
    applicationName: candidateName,
    preferredNameCount: applicationName === null ? 0 : namePreferenceCount,
    usage: emptyUsage(),
  };
  applications.set(key, created);
  return created;
}

function compareUsage(left: MutableUsage, right: MutableUsage): number {
  if (left.tokens.totalTokens !== right.tokens.totalTokens) {
    return left.tokens.totalTokens > right.tokens.totalTokens ? -1 : 1;
  }
  if (left.requestCount !== right.requestCount) {
    return right.requestCount - left.requestCount;
  }
  if (left.turnCount !== right.turnCount) {
    return right.turnCount - left.turnCount;
  }
  return right.taskCount - left.taskCount;
}

function modelUsageFor(
  models: Map<string, MutableModelUsage>,
  modelId: string,
  modelKind: UsageModelKind,
): MutableModelUsage {
  const key = `${modelKind}\u0000${modelId}`;
  const current = models.get(key);
  if (current) return current;
  const created: MutableModelUsage = {
    modelId,
    modelKind,
    turnCount: 0,
    requestCount: 0,
    workloadTypes: new Set(),
    measurementMethods: new Set(),
    tokens: emptyTokens(),
    cost: emptyCost(),
  };
  models.set(key, created);
  return created;
}

function workloadUsageFor(
  workloads: Map<UsageWorkload, MutableWorkloadUsage>,
  workload: UsageWorkload,
): MutableWorkloadUsage {
  const current = workloads.get(workload);
  if (current) return current;
  const created: MutableWorkloadUsage = {
    requestCount: 0,
    measurementMethods: new Set(),
    tokens: emptyTokens(),
    cost: emptyCost(),
  };
  workloads.set(workload, created);
  return created;
}

function applyGenerationTurns(
  usage: MutableUsage,
  modelId: string,
  count: number,
): void {
  usage.turnCount += count;
  usage.requestCount += count;
  const model = modelUsageFor(usage.models, modelId, "generation");
  model.turnCount += count;
  model.requestCount += count;
  model.workloadTypes.add("assistant_response");
  model.measurementMethods.add("provider");
  const workload = workloadUsageFor(usage.workloads, "assistant_response");
  workload.requestCount += count;
  workload.measurementMethods.add("provider");
}

function applyGenerationUsage(
  usage: MutableUsage,
  modelId: string,
  tokens: TokenFields,
  cost: CostFields,
): void {
  addTokens(usage.tokens, tokens);
  addCost(usage.cost, cost);
  const model = modelUsageFor(usage.models, modelId, "generation");
  model.workloadTypes.add("assistant_response");
  model.measurementMethods.add("provider");
  addTokens(model.tokens, tokens);
  addCost(model.cost, cost);
  const workload = workloadUsageFor(usage.workloads, "assistant_response");
  workload.measurementMethods.add("provider");
  addTokens(workload.tokens, tokens);
  addCost(workload.cost, cost);
}

function applyModelUsage(
  usage: MutableUsage,
  input: {
    modelId: string;
    modelKind: UsageModelKind;
    workload: UsageWorkload;
    measurementMethod: UsageMeasurementMethod;
    requestCount: number;
    tokens: TokenFields;
    cost: CostFields;
  },
): void {
  usage.requestCount += input.requestCount;
  addTokens(usage.tokens, input.tokens);
  addCost(usage.cost, input.cost);
  const model = modelUsageFor(usage.models, input.modelId, input.modelKind);
  model.requestCount += input.requestCount;
  model.workloadTypes.add(input.workload);
  model.measurementMethods.add(input.measurementMethod);
  addTokens(model.tokens, input.tokens);
  addCost(model.cost, input.cost);
  const workload = workloadUsageFor(usage.workloads, input.workload);
  workload.requestCount += input.requestCount;
  workload.measurementMethods.add(input.measurementMethod);
  addTokens(workload.tokens, input.tokens);
  addCost(workload.cost, input.cost);
}

function combineUsage(items: MutableUsage[]): MutableUsage {
  const combined = emptyUsage();
  for (const item of items) {
    combined.taskCount += item.taskCount;
    combined.turnCount += item.turnCount;
    combined.requestCount += item.requestCount;
    addTokens(combined.tokens, item.tokens);
    addCost(combined.cost, item.cost);
    for (const model of item.models.values()) {
      const target = modelUsageFor(
        combined.models,
        model.modelId,
        model.modelKind,
      );
      target.turnCount += model.turnCount;
      target.requestCount += model.requestCount;
      for (const workload of model.workloadTypes) {
        target.workloadTypes.add(workload);
      }
      for (const method of model.measurementMethods) {
        target.measurementMethods.add(method);
      }
      addTokens(target.tokens, model.tokens);
      addCost(target.cost, model.cost);
    }
    for (const [workload, workloadUsage] of item.workloads) {
      const target = workloadUsageFor(combined.workloads, workload);
      target.requestCount += workloadUsage.requestCount;
      for (const method of workloadUsage.measurementMethods) {
        target.measurementMethods.add(method);
      }
      addTokens(target.tokens, workloadUsage.tokens);
      addCost(target.cost, workloadUsage.cost);
    }
  }
  return combined;
}

function addTokens(target: TokenFields, source: TokenFields): void {
  target.totalTokens += source.totalTokens;
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
}

function addCost(target: CostFields, source: CostFields): void {
  target.inputCostPicoCny += source.inputCostPicoCny;
  target.cachedInputCostPicoCny += source.cachedInputCostPicoCny;
  target.outputCostPicoCny += source.outputCostPicoCny;
  target.totalCostPicoCny += source.totalCostPicoCny;
  target.unpricedTokens += source.unpricedTokens;
}

function subtractTokens(
  total: TokenFields,
  previous: TokenFields,
): TokenFields {
  return {
    totalTokens: total.totalTokens - previous.totalTokens,
    inputTokens: total.inputTokens - previous.inputTokens,
    cachedInputTokens: total.cachedInputTokens - previous.cachedInputTokens,
    outputTokens: total.outputTokens - previous.outputTokens,
    reasoningOutputTokens:
      total.reasoningOutputTokens - previous.reasoningOutputTokens,
  };
}

function isMonotonicSnapshot(
  previous: TokenFields,
  total: TokenFields,
): boolean {
  return (
    total.totalTokens >= previous.totalTokens &&
    total.inputTokens >= previous.inputTokens &&
    total.cachedInputTokens >= previous.cachedInputTokens &&
    total.outputTokens >= previous.outputTokens &&
    total.reasoningOutputTokens >= previous.reasoningOutputTokens
  );
}

function isValidTokenSubset(tokens: TokenFields): boolean {
  return (
    tokens.cachedInputTokens <= tokens.inputTokens &&
    tokens.reasoningOutputTokens <= tokens.outputTokens
  );
}

function isComponentwiseAtMost(
  lower: TokenFields,
  upper: TokenFields,
): boolean {
  return (
    lower.totalTokens <= upper.totalTokens &&
    lower.inputTokens <= upper.inputTokens &&
    lower.cachedInputTokens <= upper.cachedInputTokens &&
    lower.outputTokens <= upper.outputTokens &&
    lower.reasoningOutputTokens <= upper.reasoningOutputTokens
  );
}

function isZeroTokens(tokens: TokenFields): boolean {
  return Object.values(tokens).every((value) => value === 0n);
}

function tokenUsageSnapshotKey(
  codexTurnId: string,
  total: TokenFields,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        codexTurnId,
        total.totalTokens.toString(),
        total.inputTokens.toString(),
        total.cachedInputTokens.toString(),
        total.outputTokens.toString(),
        total.reasoningOutputTokens.toString(),
      ]),
    )
    .digest("hex");
}

function projectMetrics(usage: MutableUsage): UsageMetrics {
  return {
    task_count: usage.taskCount,
    turn_count: usage.turnCount,
    request_count: usage.requestCount,
    token_usage: projectTokens(usage.tokens),
    cost: projectCost(usage.cost),
  };
}

function projectModels(
  models: Map<string, MutableModelUsage>,
  displayNames: Map<string, string>,
): UsageModelBreakdown[] {
  return [...models.values()]
    .sort((left, right) => {
      if (left.tokens.totalTokens !== right.tokens.totalTokens) {
        return left.tokens.totalTokens > right.tokens.totalTokens ? -1 : 1;
      }
      if (left.requestCount !== right.requestCount) {
        return right.requestCount - left.requestCount;
      }
      if (left.modelKind !== right.modelKind) {
        return left.modelKind.localeCompare(right.modelKind, "en-US");
      }
      return left.modelId.localeCompare(right.modelId, "en-US");
    })
    .map((usage) => ({
      model_id: usage.modelId,
      display_name: displayNames.get(usage.modelId) ?? null,
      model_kind: usage.modelKind,
      workload_types: sortedWorkloads(usage.workloadTypes),
      measurement_methods: sortedMeasurementMethods(usage.measurementMethods),
      request_count: usage.requestCount,
      turn_count: usage.turnCount,
      token_usage: projectTokens(usage.tokens),
      cost: projectCost(usage.cost),
    }));
}

function projectSkills(
  rows: Array<{
    capabilityId: string | null;
    capabilityName: string | null;
    _count: { _all: number };
  }>,
): Array<{ skill_id: string; name: string; usage_count: number }> {
  const skills = new Map<string, MutableSkillUsage>();
  for (const row of rows) {
    if (!row.capabilityId || !row.capabilityName) continue;
    const usageCount = row._count._all;
    const existing = skills.get(row.capabilityId);
    if (!existing) {
      skills.set(row.capabilityId, {
        skillId: row.capabilityId,
        name: row.capabilityName,
        usageCount,
        preferredNameCount: usageCount,
      });
      continue;
    }
    existing.usageCount += usageCount;
    if (usageCount > existing.preferredNameCount) {
      existing.name = row.capabilityName;
      existing.preferredNameCount = usageCount;
    }
  }

  return [...skills.values()]
    .sort((left, right) => {
      if (left.usageCount !== right.usageCount) {
        return right.usageCount - left.usageCount;
      }
      const nameOrder = left.name.localeCompare(right.name, "zh-CN");
      if (nameOrder !== 0) return nameOrder;
      return left.skillId.localeCompare(right.skillId, "en-US");
    })
    .map((skill) => ({
      skill_id: skill.skillId,
      name: skill.name,
      usage_count: skill.usageCount,
    }));
}

function projectWorkloads(
  workloads: Map<UsageWorkload, MutableWorkloadUsage>,
): UsageWorkloadBreakdown[] {
  return [...workloads.entries()]
    .sort(([left], [right]) => workloadOrder(left) - workloadOrder(right))
    .map(([workload, usage]) => ({
      workload,
      request_count: usage.requestCount,
      measurement_methods: sortedMeasurementMethods(usage.measurementMethods),
      token_usage: projectTokens(usage.tokens),
      cost: projectCost(usage.cost),
    }));
}

function projectTokens(tokens: TokenFields): UsageTokenBreakdown {
  return {
    total_tokens: tokens.totalTokens.toString(),
    input_tokens: tokens.inputTokens.toString(),
    cached_input_tokens: tokens.cachedInputTokens.toString(),
    output_tokens: tokens.outputTokens.toString(),
    reasoning_output_tokens: tokens.reasoningOutputTokens.toString(),
  };
}

function projectCost(cost: CostFields): UsageCostBreakdown {
  return {
    currency: "CNY",
    total_cost: picoCnyToDecimal(cost.totalCostPicoCny),
    input_cost: picoCnyToDecimal(cost.inputCostPicoCny),
    cached_input_cost: picoCnyToDecimal(cost.cachedInputCostPicoCny),
    output_cost: picoCnyToDecimal(cost.outputCostPicoCny),
    unpriced_tokens: cost.unpricedTokens.toString(),
  };
}

function picoCnyToDecimal(value: bigint): string {
  const whole = value / PICO_CNY_PER_CNY;
  const fraction = (value % PICO_CNY_PER_CNY)
    .toString()
    .padStart(12, "0")
    .replace(/0+$/u, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

function sortedWorkloads(values: Set<UsageWorkload>): UsageWorkload[] {
  return [...values].sort(
    (left, right) => workloadOrder(left) - workloadOrder(right),
  );
}

function workloadOrder(value: UsageWorkload): number {
  return [
    "assistant_response",
    "memory_generation",
    "document_embedding",
    "query_embedding",
    "rerank",
    "image_generation",
  ].indexOf(value);
}

function sortedMeasurementMethods(
  values: Set<UsageMeasurementMethod>,
): UsageMeasurementMethod[] {
  return [...values].sort((left, right) =>
    left === right ? 0 : left === "provider" ? -1 : 1,
  );
}

function toSafeCount(value: bigint | number | null): number {
  const count = typeof value === "bigint" ? Number(value) : (value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("usage request count exceeds safe integer range");
  }
  return count;
}
