import { describe, expect, it, vi } from "vitest";
import { defaultQuotaSettings } from "@linksense/shared";

import { Prisma } from "../src/generated/prisma/client.js";
import { UsageAnalyticsService } from "../src/modules/usage/service.js";

const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const TURN_ID = "30000000-0000-4000-8000-000000000001";
const USER_1 = "10000000-0000-4000-8000-000000000001";
const USER_2 = "10000000-0000-4000-8000-000000000002";
const GROUP_1 = "40000000-0000-4000-8000-000000000001";
const GROUP_2 = "40000000-0000-4000-8000-000000000002";
const APPLICATION_1 = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-27T12:00:00.000Z");
const MEASUREMENT_STARTED_AT = new Date("2026-07-27T00:00:00.000Z");

describe("UsageAnalyticsService token capture", () => {
  it("acknowledges an unprojected native-history snapshot on a fork", async () => {
    const fixture = captureFixture({ forkRootId: CONVERSATION_ID });
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(null);
    const service = new UsageAnalyticsService(fixture.prisma as never, {
      now: () => NOW,
    });

    await expect(
      service.captureTokenUsage(
        CONVERSATION_ID,
        tokenParams({
          totalTokens: 180,
          inputTokens: 120,
          cachedInputTokens: 40,
          outputTokens: 60,
          reasoningOutputTokens: 20,
        }),
      ),
    ).resolves.toEqual({
      accepted: true,
      ignored: true,
      reason_code: "UNPROJECTED_FORK_HISTORY",
    });
    expect(fixture.tx.usageAnalyticsState.findUnique).not.toHaveBeenCalled();
    expect(fixture.tx.tokenUsageRecord.createMany).not.toHaveBeenCalled();
    expect(
      fixture.tx.codexThreadTokenUsageCursor.upsert,
    ).not.toHaveBeenCalled();
  });

  it("keeps an unprojected snapshot pending for a non-fork conversation", async () => {
    const fixture = captureFixture();
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(null);
    const service = new UsageAnalyticsService(fixture.prisma as never, {
      now: () => NOW,
    });

    await expect(
      service.captureTokenUsage(
        CONVERSATION_ID,
        tokenParams({
          totalTokens: 180,
          inputTokens: 120,
          cachedInputTokens: 40,
          outputTokens: 60,
          reasoningOutputTokens: 20,
        }),
      ),
    ).resolves.toEqual({
      accepted: false,
      reason_code: "TURN_PROJECTION_PENDING",
    });
  });

  it("records the native last-response usage for the first observed new turn", async () => {
    const fixture = captureFixture();
    const service = new UsageAnalyticsService(fixture.prisma as never, {
      now: () => NOW,
    });

    const result = await service.captureTokenUsage(
      CONVERSATION_ID,
      tokenParams({
        totalTokens: 180,
        inputTokens: 120,
        cachedInputTokens: 40,
        outputTokens: 60,
        reasoningOutputTokens: 20,
      }),
    );

    expect(result).toEqual({ accepted: true });
    expect(fixture.tx.tokenUsageRecord.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          ownerId: USER_1,
          conversationId: CONVERSATION_ID,
          applicationId: APPLICATION_1,
          applicationNameSnapshot: "知识助手",
          turnId: TURN_ID,
          codexThreadId: "codex-thread-1",
          codexTurnId: "codex-turn-1",
          model: "gpt-5.6-sol",
          totalTokens: 80n,
          inputTokens: 50n,
          cachedInputTokens: 10n,
          outputTokens: 30n,
          reasoningOutputTokens: 8n,
          totalCostPicoCny: 0n,
          creditPriceMicrosCny: 10_000n,
          usedCreditMicros: 0n,
          unpricedTokens: 80n,
          observedAt: NOW,
        }),
      ],
      skipDuplicates: true,
    });
    expect(fixture.tx.codexThreadTokenUsageCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          totalTokens: 180n,
          lastTotalTokens: 80n,
          inputTokens: 120n,
        }),
        update: expect.objectContaining({ lastTotalTokens: 80n }),
      }),
    );
  });

  it.each([
    {
      creditPrice: "0.01",
      creditPriceMicrosCny: 10_000n,
      usedCreditMicros: 102_000n,
    },
    {
      creditPrice: "0.02",
      creditPriceMicrosCny: 20_000n,
      usedCreditMicros: 51_000n,
    },
  ])(
    "freezes prices, cost, and credits at CNY $creditPrice per credit on native usage",
    async ({ creditPrice, creditPriceMicrosCny, usedCreditMicros }) => {
      const fixture = captureFixture({ creditPrice });
      const modelCatalog = {
        getAdminSettings: vi.fn(async () => ({
          providers: [
            {
              models: [
                {
                  id: "gpt-5.6-sol",
                  display_name: "GPT 5.6 Sol",
                  kind: "chat",
                  input_price_per_million: "10",
                  cached_input_price_per_million: "2",
                  output_price_per_million: "20",
                },
              ],
            },
          ],
        })),
      };
      const service = new UsageAnalyticsService(fixture.prisma as never, {
        now: () => NOW,
        modelCatalog: modelCatalog as never,
      });

      await service.captureTokenUsage(
        CONVERSATION_ID,
        tokenParams({
          totalTokens: 180,
          inputTokens: 120,
          cachedInputTokens: 40,
          outputTokens: 60,
          reasoningOutputTokens: 20,
        }),
      );

      expect(fixture.tx.tokenUsageRecord.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            inputPriceMicrosPerMillion: 10_000_000n,
            cachedInputPriceMicrosPerMillion: 2_000_000n,
            outputPriceMicrosPerMillion: 20_000_000n,
            inputCostPicoCny: 400_000_000n,
            cachedInputCostPicoCny: 20_000_000n,
            outputCostPicoCny: 600_000_000n,
            totalCostPicoCny: 1_020_000_000n,
            creditPriceMicrosCny,
            usedCreditMicros,
            unpricedTokens: 0n,
          }),
        ],
        skipDuplicates: true,
      });
    },
  );

  it("uses the absolute thread cursor delta after the first observation", async () => {
    const fixture = captureFixture({
      cursor: {
        totalTokens: 180n,
        inputTokens: 120n,
        cachedInputTokens: 40n,
        outputTokens: 60n,
        reasoningOutputTokens: 20n,
      },
    });
    const service = new UsageAnalyticsService(fixture.prisma as never, {
      now: () => NOW,
    });

    await service.captureTokenUsage(
      CONVERSATION_ID,
      tokenParams({
        totalTokens: 255,
        inputTokens: 170,
        cachedInputTokens: 50,
        outputTokens: 85,
        reasoningOutputTokens: 25,
      }),
    );

    expect(fixture.tx.tokenUsageRecord.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          totalTokens: 75n,
          inputTokens: 50n,
          cachedInputTokens: 10n,
          outputTokens: 25n,
          reasoningOutputTokens: 5n,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("establishes a cursor without backfilling a turn that started before measurement", async () => {
    const fixture = captureFixture({
      turnStartedAt: new Date("2026-07-26T23:59:59.000Z"),
    });
    const service = new UsageAnalyticsService(fixture.prisma as never, {
      now: () => NOW,
    });

    const result = await service.captureTokenUsage(
      CONVERSATION_ID,
      tokenParams({
        totalTokens: 180,
        inputTokens: 120,
        cachedInputTokens: 40,
        outputTokens: 60,
        reasoningOutputTokens: 20,
      }),
    );

    expect(result).toEqual({ accepted: true, ignored: true });
    expect(fixture.tx.tokenUsageRecord.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.codexThreadTokenUsageCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ totalTokens: 180n }),
      }),
    );
  });

  it("does not regress a cursor when an older snapshot is replayed", async () => {
    const fixture = captureFixture({
      cursor: {
        totalTokens: 180n,
        inputTokens: 120n,
        cachedInputTokens: 40n,
        outputTokens: 60n,
        reasoningOutputTokens: 20n,
      },
    });
    const service = new UsageAnalyticsService(fixture.prisma as never, {
      now: () => NOW,
    });

    const result = await service.captureTokenUsage(
      CONVERSATION_ID,
      tokenParams({
        totalTokens: 100,
        inputTokens: 70,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningOutputTokens: 10,
      }),
    );

    expect(result).toEqual({
      accepted: true,
      ignored: true,
      reason_code: "TOKEN_USAGE_REGRESSION",
    });
    expect(fixture.tx.tokenUsageRecord.createMany).not.toHaveBeenCalled();
    expect(
      fixture.tx.codexThreadTokenUsageCursor.upsert,
    ).not.toHaveBeenCalled();
  });

  it("rejects a malformed last-response breakdown without advancing the cursor", async () => {
    const fixture = captureFixture();
    const service = new UsageAnalyticsService(fixture.prisma as never, {
      now: () => NOW,
    });
    const params = tokenParams({
      totalTokens: 70,
      inputTokens: 40,
      cachedInputTokens: 10,
      outputTokens: 30,
      reasoningOutputTokens: 8,
    });

    const result = await service.captureTokenUsage(CONVERSATION_ID, params);

    expect(result).toEqual({
      accepted: true,
      ignored: true,
      reason_code: "TOKEN_USAGE_INVALID",
    });
    expect(fixture.tx.tokenUsageRecord.createMany).not.toHaveBeenCalled();
    expect(
      fixture.tx.codexThreadTokenUsageCursor.upsert,
    ).not.toHaveBeenCalled();
  });

  it("uses the globally unique snapshot key to suppress fork or delivery replay", async () => {
    const fixture = captureFixture({ insertedCount: 0 });
    const service = new UsageAnalyticsService(fixture.prisma as never, {
      now: () => NOW,
    });

    const result = await service.captureTokenUsage(
      CONVERSATION_ID,
      tokenParams({
        totalTokens: 180,
        inputTokens: 120,
        cachedInputTokens: 40,
        outputTokens: 60,
        reasoningOutputTokens: 20,
      }),
    );

    expect(result).toEqual({ accepted: true, ignored: true });
    expect(
      fixture.tx.codexThreadTokenUsageCursor.upsert,
    ).toHaveBeenCalledOnce();
  });
});

describe("UsageAnalyticsService reporting", () => {
  it("reports immutable task and turn activities even without operational task rows", async () => {
    const prisma = reportPrisma();
    const modelCatalog = {
      getAdminSettings: vi.fn(async () => ({
        configured: true,
        revision: 1,
        default_model: "model-a",
        providers: [
          {
            id: "provider-a",
            name: "Provider A",
            base_url: "https://models.example.test/v1",
            protocol_mode: "native_responses",
            api_key_configured: true,
            models: [
              {
                id: "model-a",
                display_name: "Model A",
                enabled: true,
                supported_reasoning_efforts: ["medium"],
                default_reasoning_effort: "medium",
              },
              {
                id: "model-b",
                display_name: "Model B",
                enabled: true,
                supported_reasoning_efforts: ["medium"],
                default_reasoning_effort: "medium",
              },
            ],
          },
        ],
      })),
    };
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
      modelCatalog: modelCatalog as never,
    });

    const report = await service.report({ range: "all", time_zone: "UTC" });

    expect(report.totals).toEqual({
      task_count: 3,
      turn_count: 6,
      request_count: 10,
      token_usage: {
        total_tokens: "750",
        input_tokens: "540",
        cached_input_tokens: "90",
        output_tokens: "210",
        reasoning_output_tokens: "60",
      },
      cost: {
        currency: "CNY",
        total_cost: "0.00813",
        input_cost: "0.00375",
        cached_input_cost: "0.00018",
        output_cost: "0.0042",
        unpriced_tokens: "0",
      },
    });
    expect(report.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model_id: "model-a",
          display_name: "Model A",
          model_kind: "generation",
          turn_count: 5,
          token_usage: expect.objectContaining({ total_tokens: "500" }),
        }),
        expect.objectContaining({
          model_id: "model-b",
          display_name: "Model B",
          model_kind: "generation",
          turn_count: 1,
          token_usage: expect.objectContaining({ total_tokens: "100" }),
        }),
        expect.objectContaining({
          model_id: "embedding-v1",
          model_kind: "embedding",
          request_count: 3,
          token_usage: expect.objectContaining({ total_tokens: "120" }),
        }),
        expect.objectContaining({
          model_id: "rerank-v1",
          model_kind: "rerank",
          request_count: 1,
          token_usage: expect.objectContaining({ total_tokens: "30" }),
        }),
      ]),
    );
    expect(report.workloads).toMatchObject([
      { workload: "assistant_response", request_count: 6 },
      { workload: "document_embedding", request_count: 2 },
      { workload: "query_embedding", request_count: 1 },
      {
        workload: "rerank",
        request_count: 1,
        measurement_methods: ["estimated"],
      },
    ]);
    expect(report.applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          application_id: APPLICATION_1,
          application_name: "知识助手",
          is_unattributed: false,
          metrics: expect.objectContaining({
            task_count: 2,
            turn_count: 4,
            token_usage: expect.objectContaining({ total_tokens: "400" }),
          }),
        }),
        expect.objectContaining({
          application_id: null,
          is_unattributed: true,
          metrics: expect.objectContaining({
            task_count: 1,
            turn_count: 2,
            token_usage: expect.objectContaining({ total_tokens: "350" }),
          }),
        }),
      ]),
    );

    const groupOne = report.groups.find((group) => group.group_id === GROUP_1);
    const groupTwo = report.groups.find((group) => group.group_id === GROUP_2);
    expect(groupOne?.metrics).toMatchObject({
      task_count: 2,
      turn_count: 4,
      request_count: 8,
      token_usage: { total_tokens: "550" },
      cost: { total_cost: "0.00567" },
    });
    expect(groupTwo?.metrics).toEqual(groupOne?.metrics);
    expect(report.groups.find((group) => group.is_ungrouped)).toMatchObject({
      member_count: 1,
      metrics: {
        task_count: 1,
        turn_count: 2,
        request_count: 2,
        token_usage: { total_tokens: "200" },
      },
    });
    const userOneGroups = report.users.find(
      (user) => user.user_id === USER_1,
    )?.groups;
    expect(userOneGroups).toHaveLength(2);
    expect(userOneGroups).toEqual(
      expect.arrayContaining([
        { id: GROUP_1, name: "研发组" },
        { id: GROUP_2, name: "试点组" },
      ]),
    );
    expect(report.group_semantics).toBe("current_membership_coverage");
    expect(report.token_coverage).toEqual({
      started_at: MEASUREMENT_STARTED_AT.toISOString(),
      complete_for_period: false,
    });
    expect(report.token_trend).toEqual({
      granularity: "day",
      points: [
        {
          period_start: "2026-07-27",
          token_usage: {
            total_tokens: "750",
            input_tokens: "540",
            cached_input_tokens: "90",
            output_tokens: "210",
            reasoning_output_tokens: "60",
          },
          cost: {
            currency: "CNY",
            total_cost: "0.00813",
            input_cost: "0.00375",
            cached_input_cost: "0.00018",
            output_cost: "0.0042",
            unpriced_tokens: "0",
          },
          workloads: [
            expect.objectContaining({
              workload: "assistant_response",
              request_count: 6,
              token_usage: expect.objectContaining({ total_tokens: "600" }),
            }),
            expect.objectContaining({
              workload: "document_embedding",
              request_count: 2,
              token_usage: expect.objectContaining({ total_tokens: "100" }),
            }),
            expect.objectContaining({
              workload: "query_embedding",
              request_count: 1,
              token_usage: expect.objectContaining({ total_tokens: "20" }),
            }),
            expect.objectContaining({
              workload: "rerank",
              request_count: 1,
              token_usage: expect.objectContaining({ total_tokens: "30" }),
            }),
          ],
        },
      ],
    });
  });

  it("uses complete calendar days in the requested time zone and fills empty trend days", async () => {
    const prisma = reportPrisma({
      measurementStartedAt: new Date("2026-07-24T16:00:00.000Z"),
      trendRows: [
        trendSumRow("2026-07-25", 100n, 70n, 10n, 30n, 5n),
        trendSumRow("2026-07-27", 500n, 320n, 80n, 180n, 55n),
      ],
    });
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
    });

    const report = await service.report({
      range: "custom",
      date_from: "2026-07-25",
      date_to: "2026-07-27",
      time_zone: "Asia/Shanghai",
    });

    expect(report.period).toEqual({
      from: "2026-07-24T16:00:00.000Z",
      to: "2026-07-27T15:59:59.999Z",
      time_zone: "Asia/Shanghai",
    });
    expect(prisma.usageActivityRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          activityType: "task_created",
          occurredAt: {
            gte: new Date("2026-07-24T16:00:00.000Z"),
            lt: new Date("2026-07-27T16:00:00.000Z"),
          },
        },
      }),
    );
    expect(report.token_trend).toMatchObject({
      granularity: "day",
      points: [
        {
          period_start: "2026-07-25",
          token_usage: { total_tokens: "100" },
        },
        {
          period_start: "2026-07-26",
          token_usage: { total_tokens: "0" },
        },
        {
          period_start: "2026-07-27",
          token_usage: { total_tokens: "500" },
        },
      ],
    });
  });

  it("adds memory generation to requests, tokens, costs, and trends without adding tasks or turns", async () => {
    const memoryUsage = modelUsageSumRow(
      USER_1,
      "model-memory",
      "generation",
      "memory_generation",
      "provider",
      2n,
      50n,
    );
    const prisma = reportPrisma({
      modelUsageRows: [memoryUsage],
      trendRows: [
        trendSumRow("2026-07-27", 600n, 390n, 90n, 210n, 60n, {
          requestCount: 6n,
        }),
        trendSumRow("2026-07-27", 50n, 50n, 0n, 0n, 0n, {
          workload: "memory_generation",
          requestCount: 2n,
          inputPrice: 5_000_000n,
          cachedInputPrice: 0n,
          outputPrice: 0n,
        }),
      ],
    });
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
    });

    const report = await service.report({ range: "all", time_zone: "UTC" });

    expect(report.totals).toMatchObject({
      task_count: 3,
      turn_count: 6,
      request_count: 8,
      token_usage: { total_tokens: "650" },
    });
    expect(report.models).toContainEqual(
      expect.objectContaining({
        model_id: "model-memory",
        model_kind: "generation",
        request_count: 2,
        turn_count: 0,
        workload_types: ["memory_generation"],
        token_usage: expect.objectContaining({ total_tokens: "50" }),
      }),
    );
    expect(report.workloads).toContainEqual(
      expect.objectContaining({
        workload: "memory_generation",
        request_count: 2,
        token_usage: expect.objectContaining({ total_tokens: "50" }),
      }),
    );
    expect(report.token_trend.points[0]?.workloads).toContainEqual(
      expect.objectContaining({
        workload: "memory_generation",
        request_count: 2,
        token_usage: expect.objectContaining({ total_tokens: "50" }),
      }),
    );
  });

  it("includes task auto-naming usage in the selected model's report row", async () => {
    const prisma = reportPrisma({
      modelUsageRows: [
        modelUsageSumRow(
          USER_1,
          "qwen3.7-plus",
          "generation",
          "task_title_generation",
          "provider",
          1n,
          21n,
        ),
      ],
      trendRows: [
        trendSumRow("2026-07-27", 600n, 390n, 90n, 210n, 60n, {
          requestCount: 6n,
        }),
        trendSumRow("2026-07-27", 21n, 16n, 4n, 5n, 0n, {
          workload: "task_title_generation",
          requestCount: 1n,
          inputPrice: 5_000_000n,
          cachedInputPrice: 1_000_000n,
          outputPrice: 8_000_000n,
        }),
      ],
    });
    const modelCatalog = {
      getAdminSettings: vi.fn(async () => ({
        providers: [
          {
            models: [
              {
                id: "qwen3.7-plus",
                display_name: "Qwen3.7 Plus",
              },
            ],
          },
        ],
      })),
    };
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
      modelCatalog: modelCatalog as never,
    });

    const report = await service.report({ range: "all", time_zone: "UTC" });

    expect(report.totals).toMatchObject({
      task_count: 3,
      turn_count: 6,
      request_count: 7,
      token_usage: { total_tokens: "621" },
    });
    expect(report.models).toContainEqual(
      expect.objectContaining({
        model_id: "qwen3.7-plus",
        display_name: "Qwen3.7 Plus",
        model_kind: "generation",
        request_count: 1,
        turn_count: 0,
        workload_types: ["task_title_generation"],
        token_usage: expect.objectContaining({ total_tokens: "21" }),
      }),
    );
    expect(report.workloads).toContainEqual(
      expect.objectContaining({
        workload: "task_title_generation",
        request_count: 1,
        token_usage: expect.objectContaining({ total_tokens: "21" }),
      }),
    );
  });

  it("never reprices persisted history with the current model catalog", async () => {
    const prisma = reportPrisma();
    const modelCatalog = {
      getAdminSettings: vi.fn(async () => ({
        configured: true,
        revision: 99,
        default_model: "model-a",
        providers: [
          {
            id: "provider-a",
            name: "Provider A",
            base_url: "https://models.example.test/v1",
            protocol_mode: "native_responses",
            api_key_configured: true,
            models: [
              {
                id: "model-a",
                display_name: "Model A",
                enabled: true,
                supported_reasoning_efforts: ["medium"],
                default_reasoning_effort: "medium",
                input_price_per_million: "9999999999.999999",
                cached_input_price_per_million: "9999999999.999999",
                output_price_per_million: "9999999999.999999",
              },
            ],
          },
        ],
      })),
    };
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
      modelCatalog: modelCatalog as never,
    });

    const report = await service.report({ range: "all", time_zone: "UTC" });

    expect(report.totals.cost).toMatchObject({
      total_cost: "0.00813",
      input_cost: "0.00375",
      cached_input_cost: "0.00018",
      output_cost: "0.0042",
    });
  });

  it("includes knowledge-model history that predates native response measurement in the all-time trend", async () => {
    const knowledgeUsageStartedAt = new Date("2026-07-25T08:00:00.000Z");
    const prisma = reportPrisma({
      earliestTokenUsageAt: MEASUREMENT_STARTED_AT,
      earliestModelUsageAt: knowledgeUsageStartedAt,
      trendRows: [
        trendSumRow("2026-07-25", 20n, 20n, 0n, 0n, 0n, {
          workload: "document_embedding",
        }),
      ],
    });
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
    });

    const report = await service.report({ range: "all", time_zone: "UTC" });

    expect(report.token_trend.points[0]?.period_start).toBe("2026-07-25");
    expect(report.token_trend.points[0]?.workloads).toEqual([
      expect.objectContaining({
        workload: "document_embedding",
        token_usage: expect.objectContaining({ total_tokens: "20" }),
      }),
    ]);
  });

  it("normalizes PostgreSQL numeric aggregates before bigint arithmetic", async () => {
    const prisma = reportPrisma({
      trendRows: [
        postgresNumericTrendSumRow("2026-07-27", 100n, 70n, 10n, 30n, 5n),
      ],
    });
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
    });

    const report = await service.report({ range: "all", time_zone: "UTC" });

    expect(report.token_trend.points[0]).toMatchObject({
      token_usage: {
        total_tokens: "100",
        input_tokens: "70",
        cached_input_tokens: "10",
        output_tokens: "30",
        reasoning_output_tokens: "5",
      },
      cost: {
        total_cost: "0.00122",
      },
    });
  });

  it.each([
    {
      dateFrom: "2026-01-01",
      measurementStartedAt: "2026-01-01T00:00:00.000Z",
      firstPeriod: "2026-01-01",
      lastPeriod: "2026-07-01",
      granularity: "month" as const,
    },
    {
      dateFrom: "2020-01-01",
      measurementStartedAt: "2020-01-01T00:00:00.000Z",
      firstPeriod: "2020-01-01",
      lastPeriod: "2026-01-01",
      granularity: "year" as const,
    },
  ])(
    "uses $granularity buckets for longer custom ranges",
    async ({
      dateFrom,
      measurementStartedAt,
      firstPeriod,
      lastPeriod,
      granularity,
    }) => {
      const prisma = reportPrisma({
        measurementStartedAt: new Date(measurementStartedAt),
        trendRows: [trendSumRow(firstPeriod, 100n, 70n, 10n, 30n, 5n)],
      });
      const service = new UsageAnalyticsService(prisma as never, {
        now: () => NOW,
      });

      const report = await service.report({
        range: "custom",
        date_from: dateFrom,
        date_to: "2026-07-27",
        time_zone: "UTC",
      });

      expect(report.token_trend.granularity).toBe(granularity);
      expect(report.token_trend.points[0]?.period_start).toBe(firstPeriod);
      expect(report.token_trend.points.at(-1)?.period_start).toBe(lastPeriod);
    },
  );
});

describe("UsageAnalyticsService application reporting", () => {
  it("aggregates only one owned application's usage and distinct active users", async () => {
    const prisma = applicationReportPrisma();
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
    });

    const report = await service.applicationReport(USER_1, APPLICATION_1, {
      range: "7d",
      time_zone: "UTC",
    });

    expect(report).toMatchObject({
      application: { id: APPLICATION_1, name: "知识助手" },
      range: "7d",
      active_user_count: 2,
      totals: {
        task_count: 3,
        turn_count: 4,
        request_count: 5,
        token_usage: { total_tokens: "420" },
      },
    });
    expect(report.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model_id: "model-a",
          turn_count: 4,
          token_usage: expect.objectContaining({ total_tokens: "400" }),
        }),
        expect.objectContaining({
          model_id: "title-model",
          turn_count: 0,
          request_count: 1,
          workload_types: ["task_title_generation"],
        }),
      ]),
    );
    expect(prisma.application.findFirst).toHaveBeenCalledWith({
      where: {
        id: APPLICATION_1,
        ownerId: USER_1,
        status: { in: ["active", "disabled"] },
      },
      select: { id: true, name: true },
    });
    expect(prisma.usageActivityRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ applicationId: APPLICATION_1 }),
      }),
    );
    expect(prisma.tokenUsageRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ applicationId: APPLICATION_1 }),
      }),
    );
  });

  it("does not expose usage for a shared or missing application", async () => {
    const prisma = applicationReportPrisma({ owned: false });
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
    });

    await expect(
      service.applicationReport(USER_1, APPLICATION_1, {
        range: "all",
        time_zone: "UTC",
      }),
    ).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(prisma.usageActivityRecord.groupBy).not.toHaveBeenCalled();
  });
});

describe("UsageAnalyticsService personal profiles", () => {
  it("returns only the requested owner's all-time metrics and 365-day activity", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [
        { periodStart: "2026-07-24", totalTokens: 100n },
        { periodStart: "2026-07-26", totalTokens: 200n },
        { periodStart: "2026-07-27", totalTokens: 300n },
      ]),
      usageAnalyticsState: {
        findUnique: vi.fn(async () => ({
          tokenMeasurementStartedAt: MEASUREMENT_STARTED_AT,
        })),
      },
      usageActivityRecord: {
        count: vi.fn(async () => 2),
        groupBy: vi.fn(
          async (input: {
            by?: string[];
            where?: { activityType?: string };
          }) =>
            input.by?.includes("capabilityId")
              ? [
                  {
                    capabilityId: "builtin:capability:linksense-browser",
                    capabilityName: "linksense-browser",
                    _count: { _all: 2 },
                  },
                  {
                    capabilityId: "40000000-0000-4000-8000-000000000001",
                    capabilityName: "dashi-ppt",
                    _count: { _all: 1 },
                  },
                ]
              : [{ model: "model-a", _count: { _all: 3 } }],
        ),
      },
      tokenUsageRecord: {
        groupBy: vi.fn(async () => [
          tokenSumRow(USER_1, "model-a", 600n, 390n, 90n, 210n, 60n),
        ]),
      },
      modelUsageRecord: {
        groupBy: vi.fn(async () => []),
      },
    };
    const modelCatalog = {
      getAdminSettings: vi.fn(async () => ({
        providers: [
          {
            models: [
              {
                id: "model-a",
                display_name: "Model A",
              },
            ],
          },
        ],
      })),
    };
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
      modelCatalog: modelCatalog as never,
    });

    const profile = await service.personalProfile(USER_1, {
      time_zone: "Asia/Shanghai",
    });

    expect(profile.metrics).toMatchObject({
      task_count: 2,
      turn_count: 3,
      request_count: 3,
      skill_usage_count: 3,
      token_usage: { total_tokens: "600" },
    });
    expect(profile.metrics).not.toHaveProperty("cost");
    expect(profile.activity_period).toEqual({
      from: "2025-07-28",
      to: "2026-07-27",
      time_zone: "Asia/Shanghai",
    });
    expect(profile.daily_activity).toHaveLength(365);
    expect(profile.daily_activity.slice(-4)).toEqual([
      { date: "2026-07-24", total_tokens: "100" },
      { date: "2026-07-25", total_tokens: "0" },
      { date: "2026-07-26", total_tokens: "200" },
      { date: "2026-07-27", total_tokens: "300" },
    ]);
    expect(profile).toMatchObject({
      peak_daily_tokens: "300",
      active_days: 3,
      current_streak_days: 2,
      longest_streak_days: 2,
      models: [
        {
          model_id: "model-a",
          display_name: "Model A",
          turn_count: 3,
          token_usage: { total_tokens: "600" },
        },
      ],
      skills: [
        {
          skill_id: "builtin:capability:linksense-browser",
          name: "linksense-browser",
          usage_count: 2,
        },
        {
          skill_id: "40000000-0000-4000-8000-000000000001",
          name: "dashi-ppt",
          usage_count: 1,
        },
      ],
    });
    expect(profile.models[0]).not.toHaveProperty("cost");
    expect(profile.models[0]).not.toHaveProperty("measurement_methods");
    expect(prisma.usageActivityRecord.count).toHaveBeenCalledWith({
      where: { ownerId: USER_1, activityType: "task_created" },
    });
    expect(prisma.usageActivityRecord.groupBy).toHaveBeenCalledWith({
      by: ["capabilityId", "capabilityName"],
      where: {
        ownerId: USER_1,
        activityType: "skill_used",
        capabilityId: { not: null },
        capabilityName: { not: null },
      },
      _count: { _all: true },
    });
    expect(prisma.tokenUsageRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: USER_1 } }),
    );
    expect(prisma.modelUsageRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: USER_1 } }),
    );
  });

  it("keeps yesterday's streak current when today has no activity yet", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [
        { periodStart: "2026-07-25", totalTokens: 10n },
        { periodStart: "2026-07-26", totalTokens: 20n },
      ]),
      usageAnalyticsState: {
        findUnique: vi.fn(async () => null),
      },
      usageActivityRecord: {
        count: vi.fn(async () => 0),
        groupBy: vi.fn(async () => []),
      },
      tokenUsageRecord: {
        groupBy: vi.fn(async () => []),
      },
      modelUsageRecord: {
        groupBy: vi.fn(async () => []),
      },
    };
    const service = new UsageAnalyticsService(prisma as never, {
      now: () => NOW,
    });

    const profile = await service.personalProfile(USER_1, {
      time_zone: "Asia/Shanghai",
    });

    expect(profile.current_streak_days).toBe(2);
    expect(profile.longest_streak_days).toBe(2);
  });
});

describe("UsageAnalyticsService knowledge model capture", () => {
  it.each([
    {
      creditPrice: "0.01",
      creditPriceMicrosCny: 10_000n,
      usedCreditMicros: 6_600n,
    },
    {
      creditPrice: "0.02",
      creditPriceMicrosCny: 20_000n,
      usedCreditMicros: 3_300n,
    },
  ])(
    "persists idempotent model cost and credits at CNY $creditPrice per credit",
    async ({ creditPrice, creditPriceMicrosCny, usedCreditMicros }) => {
      const createMany = vi.fn(async () => ({ count: 1 }));
      const service = new UsageAnalyticsService(
        {
          systemSetting: {
            findUnique: vi.fn(async () => ({
              settingsJson: {
                quota_settings: {
                  ...defaultQuotaSettings(),
                  credit_price_cny: creditPrice,
                },
              },
            })),
          },
          modelUsageRecord: { createMany },
        } as never,
        { now: () => NOW },
      );

      await expect(
        service.recordModelUsage({
          requestId: "50000000-0000-4000-8000-000000000001",
          ownerId: USER_1,
          knowledgeBaseId: "60000000-0000-4000-8000-000000000001",
          workload: "query_embedding",
          modelKind: "embedding",
          model: "embedding-v1",
          measurementMethod: "provider",
          tokenUsage: {
            totalTokens: 13,
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 3,
            reasoningOutputTokens: 0,
          },
          pricing: {
            input_price_per_million: "5",
            cached_input_price_per_million: "1",
            output_price_per_million: "8",
          },
        }),
      ).resolves.toEqual({ recorded: true });
      expect(createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            inputPriceMicrosPerMillion: 5_000_000n,
            cachedInputPriceMicrosPerMillion: 1_000_000n,
            outputPriceMicrosPerMillion: 8_000_000n,
            inputCostPicoCny: 40_000_000n,
            cachedInputCostPicoCny: 2_000_000n,
            outputCostPicoCny: 24_000_000n,
            totalCostPicoCny: 66_000_000n,
            creditPriceMicrosCny,
            usedCreditMicros,
            unpricedTokens: 0n,
            observedAt: NOW,
          }),
        ],
        skipDuplicates: true,
      });
    },
  );

  it("persists task auto-naming usage as a generation workload", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const service = new UsageAnalyticsService(
      {
        conversation: {
          findUnique: vi.fn(async () => ({
            applicationId: APPLICATION_1,
            applicationNameSnapshot: "知识助手",
          })),
        },
        systemSetting: { findUnique: vi.fn(async () => null) },
        modelUsageRecord: { createMany },
      } as never,
      { now: () => NOW },
    );

    await expect(
      service.recordModelUsage({
        requestId: "50000000-0000-4000-8000-000000000002",
        ownerId: USER_1,
        conversationId: CONVERSATION_ID,
        operation: "task_auto_naming",
        workload: "task_title_generation",
        modelKind: "generation",
        model: "title-model",
        measurementMethod: "provider",
        tokenUsage: {
          totalTokens: 21,
          inputTokens: 16,
          cachedInputTokens: 4,
          outputTokens: 5,
          reasoningOutputTokens: 0,
        },
        pricing: {
          input_price_per_million: "5",
          cached_input_price_per_million: "1",
          output_price_per_million: "8",
        },
      }),
    ).resolves.toEqual({ recorded: true });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          conversationId: CONVERSATION_ID,
          applicationId: APPLICATION_1,
          applicationNameSnapshot: "知识助手",
          operation: "task_auto_naming",
          workload: "task_title_generation",
          modelKind: "generation",
          model: "title-model",
          totalTokens: 21n,
          totalCostPicoCny: 104_000_000n,
        }),
      ],
      skipDuplicates: true,
    });
  });
});

function captureFixture(options?: {
  creditPrice?: string;
  cursor?: {
    totalTokens: bigint;
    inputTokens: bigint;
    cachedInputTokens: bigint;
    outputTokens: bigint;
    reasoningOutputTokens: bigint;
  };
  insertedCount?: number;
  turnStartedAt?: Date;
  forkRootId?: string | null;
}) {
  const tx = {
    systemSetting: {
      findUnique: vi.fn(async () =>
        options?.creditPrice
          ? {
              settingsJson: {
                quota_settings: {
                  ...defaultQuotaSettings(),
                  credit_price_cny: options.creditPrice,
                },
              },
            }
          : null,
      ),
    },
    $executeRaw: vi.fn(async () => 1),
    conversation: {
      findUnique: vi.fn(async () => ({
        ownerId: USER_1,
        codexThreadId: "codex-thread-1",
        forkRootId: options?.forkRootId ?? null,
        applicationId: APPLICATION_1,
        applicationNameSnapshot: "知识助手",
      })),
    },
    conversationTurn: {
      findFirst: vi.fn<
        () => Promise<{
          id: string;
          model: string;
          startedAt: Date;
        } | null>
      >(async () => ({
        id: TURN_ID,
        model: "gpt-5.6-sol",
        startedAt:
          options?.turnStartedAt ?? new Date("2026-07-27T01:00:00.000Z"),
      })),
    },
    usageAnalyticsState: {
      findUnique: vi.fn(async () => ({
        tokenMeasurementStartedAt: MEASUREMENT_STARTED_AT,
      })),
      upsert: vi.fn(),
    },
    codexThreadTokenUsageCursor: {
      findUnique: vi.fn(async () => options?.cursor ?? null),
      upsert: vi.fn(async () => ({})),
    },
    tokenUsageRecord: {
      createMany: vi.fn(async () => ({
        count: options?.insertedCount ?? 1,
      })),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(
        async (action: (transaction: typeof tx) => Promise<unknown>) =>
          action(tx),
      ),
    },
  };
}

function tokenParams(total: {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}) {
  return {
    threadId: "codex-thread-1",
    turnId: "codex-turn-1",
    tokenUsage: {
      total,
      last: {
        totalTokens: 80,
        inputTokens: 50,
        cachedInputTokens: 10,
        outputTokens: 30,
        reasoningOutputTokens: 8,
      },
      modelContextWindow: 200_000,
    },
  };
}

function reportPrisma(options?: {
  measurementStartedAt?: Date;
  earliestTokenUsageAt?: Date | null;
  earliestModelUsageAt?: Date | null;
  trendRows?: Array<
    | ReturnType<typeof trendSumRow>
    | ReturnType<typeof postgresNumericTrendSumRow>
  >;
  modelUsageRows?: Array<ReturnType<typeof modelUsageSumRow>>;
}) {
  return {
    $queryRaw: vi.fn(async () =>
      options?.trendRows
        ? options.trendRows
        : [
            trendSumRow("2026-07-27", 600n, 390n, 90n, 210n, 60n, {
              requestCount: 6n,
            }),
            trendSumRow("2026-07-27", 100n, 100n, 0n, 0n, 0n, {
              workload: "document_embedding",
              requestCount: 2n,
              inputPrice: 5_000_000n,
              cachedInputPrice: 0n,
              outputPrice: 0n,
            }),
            trendSumRow("2026-07-27", 20n, 20n, 0n, 0n, 0n, {
              workload: "query_embedding",
              inputPrice: 5_000_000n,
              cachedInputPrice: 0n,
              outputPrice: 0n,
            }),
            trendSumRow("2026-07-27", 30n, 30n, 0n, 0n, 0n, {
              workload: "rerank",
              measurementMethod: "estimated",
              inputPrice: 5_000_000n,
              cachedInputPrice: 0n,
              outputPrice: 0n,
            }),
          ],
    ),
    usageAnalyticsState: {
      findUnique: vi.fn(async () => ({
        tokenMeasurementStartedAt:
          options?.measurementStartedAt ?? MEASUREMENT_STARTED_AT,
      })),
    },
    user: {
      findMany: vi.fn(async () => [
        {
          id: USER_1,
          name: "林一",
          email: "lin@example.test",
          role: "user",
          status: "active",
        },
        {
          id: USER_2,
          name: "王二",
          email: "wang@example.test",
          role: "admin",
          status: "disabled",
        },
      ]),
    },
    application: {
      findMany: vi.fn(async () => [{ id: APPLICATION_1, name: "知识助手" }]),
    },
    userGroup: {
      findMany: vi.fn(async () => [
        { id: GROUP_1, name: "研发组" },
        { id: GROUP_2, name: "试点组" },
      ]),
    },
    userGroupMember: {
      findMany: vi.fn(async () => [
        { userId: USER_1, userGroupId: GROUP_1 },
        { userId: USER_1, userGroupId: GROUP_2 },
      ]),
    },
    usageActivityRecord: {
      groupBy: vi.fn(async (input: { where: { activityType: string } }) =>
        input.where.activityType === "task_created"
          ? [
              {
                ownerId: USER_1,
                applicationId: APPLICATION_1,
                applicationNameSnapshot: "知识助手",
                _count: { _all: 2 },
              },
              {
                ownerId: USER_2,
                applicationId: null,
                applicationNameSnapshot: null,
                _count: { _all: 1 },
              },
            ]
          : [
              {
                ownerId: USER_1,
                model: "model-a",
                applicationId: APPLICATION_1,
                applicationNameSnapshot: "知识助手",
                _count: { _all: 3 },
              },
              {
                ownerId: USER_1,
                model: "model-b",
                applicationId: APPLICATION_1,
                applicationNameSnapshot: "知识助手",
                _count: { _all: 1 },
              },
              {
                ownerId: USER_2,
                model: "model-a",
                applicationId: null,
                applicationNameSnapshot: null,
                _count: { _all: 2 },
              },
            ],
      ),
    },
    tokenUsageRecord: {
      aggregate: vi.fn(async () => ({
        _min: {
          observedAt:
            options?.earliestTokenUsageAt === undefined
              ? MEASUREMENT_STARTED_AT
              : options.earliestTokenUsageAt,
        },
      })),
      groupBy: vi.fn(async () => [
        tokenSumRow(
          USER_1,
          "model-a",
          300n,
          190n,
          40n,
          110n,
          30n,
          APPLICATION_1,
          "知识助手",
        ),
        tokenSumRow(
          USER_1,
          "model-b",
          100n,
          70n,
          20n,
          30n,
          10n,
          APPLICATION_1,
          "知识助手",
        ),
        tokenSumRow(USER_2, "model-a", 200n, 130n, 30n, 70n, 20n),
      ]),
    },
    modelUsageRecord: {
      aggregate: vi.fn(async () => ({
        _min: {
          observedAt:
            options?.earliestModelUsageAt === undefined
              ? MEASUREMENT_STARTED_AT
              : options.earliestModelUsageAt,
        },
      })),
      groupBy: vi.fn(
        async () =>
          options?.modelUsageRows ?? [
            modelUsageSumRow(
              USER_1,
              "embedding-v1",
              "embedding",
              "document_embedding",
              "provider",
              2n,
              100n,
            ),
            modelUsageSumRow(
              USER_1,
              "embedding-v1",
              "embedding",
              "query_embedding",
              "provider",
              1n,
              20n,
            ),
            modelUsageSumRow(
              USER_1,
              "rerank-v1",
              "rerank",
              "rerank",
              "estimated",
              1n,
              30n,
            ),
          ],
      ),
    },
  };
}

function applicationReportPrisma(options?: { owned?: boolean }) {
  return {
    $queryRaw: vi.fn(async () => [
      trendSumRow("2026-07-27", 420n, 290n, 60n, 130n, 40n, {
        requestCount: 5n,
      }),
    ]),
    application: {
      findFirst: vi.fn(async () =>
        options?.owned === false
          ? null
          : { id: APPLICATION_1, name: "知识助手" },
      ),
    },
    usageAnalyticsState: {
      findUnique: vi.fn(async () => ({
        tokenMeasurementStartedAt: MEASUREMENT_STARTED_AT,
      })),
    },
    usageActivityRecord: {
      groupBy: vi.fn(async (input: { where: { activityType: string } }) =>
        input.where.activityType === "task_created"
          ? [
              { ownerId: USER_1, _count: { _all: 2 } },
              { ownerId: USER_2, _count: { _all: 1 } },
            ]
          : [
              { ownerId: USER_1, model: "model-a", _count: { _all: 3 } },
              { ownerId: USER_2, model: "model-a", _count: { _all: 1 } },
            ],
      ),
    },
    tokenUsageRecord: {
      aggregate: vi.fn(async () => ({
        _min: { observedAt: MEASUREMENT_STARTED_AT },
      })),
      groupBy: vi.fn(async () => [
        tokenSumRow(
          USER_1,
          "model-a",
          400n,
          280n,
          60n,
          120n,
          40n,
          APPLICATION_1,
          "知识助手",
        ),
      ]),
    },
    modelUsageRecord: {
      aggregate: vi.fn(async () => ({
        _min: { observedAt: MEASUREMENT_STARTED_AT },
      })),
      groupBy: vi.fn(async () => [
        modelUsageSumRow(
          USER_1,
          "title-model",
          "generation",
          "task_title_generation",
          "provider",
          1n,
          20n,
        ),
      ]),
    },
  };
}

function tokenSumRow(
  ownerId: string,
  model: string,
  totalTokens: bigint,
  inputTokens: bigint,
  cachedInputTokens: bigint,
  outputTokens: bigint,
  reasoningOutputTokens: bigint,
  applicationId: string | null = null,
  applicationNameSnapshot: string | null = null,
) {
  return {
    ownerId,
    model,
    applicationId,
    applicationNameSnapshot,
    _sum: {
      totalTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      ...usageCost(
        inputTokens,
        cachedInputTokens,
        outputTokens,
        10_000_000n,
        2_000_000n,
        20_000_000n,
      ),
    },
  };
}

function modelUsageSumRow(
  ownerId: string,
  model: string,
  modelKind: "generation" | "embedding" | "rerank",
  workload:
    | "document_embedding"
    | "query_embedding"
    | "rerank"
    | "memory_generation"
    | "task_title_generation",
  measurementMethod: "provider" | "estimated",
  requestCount: bigint,
  totalTokens: bigint,
) {
  return {
    ownerId,
    model,
    applicationId: null,
    applicationNameSnapshot: null,
    modelKind,
    workload,
    measurementMethod,
    _sum: {
      requestCount,
      totalTokens,
      inputTokens: totalTokens,
      cachedInputTokens: 0n,
      outputTokens: 0n,
      reasoningOutputTokens: 0n,
      ...usageCost(totalTokens, 0n, 0n, 5_000_000n, 0n, 0n),
    },
  };
}

function trendSumRow(
  periodStart: string,
  totalTokens: bigint,
  inputTokens: bigint,
  cachedInputTokens: bigint,
  outputTokens: bigint,
  reasoningOutputTokens: bigint,
  options: {
    workload?:
      | "assistant_response"
      | "memory_generation"
      | "task_title_generation"
      | "document_embedding"
      | "query_embedding"
      | "rerank";
    measurementMethod?: "provider" | "estimated";
    requestCount?: bigint;
    inputPrice?: bigint;
    cachedInputPrice?: bigint;
    outputPrice?: bigint;
  } = {},
) {
  return {
    periodStart,
    workload: options.workload ?? "assistant_response",
    measurementMethod: options.measurementMethod ?? "provider",
    requestCount: options.requestCount ?? 1n,
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    ...usageCost(
      inputTokens,
      cachedInputTokens,
      outputTokens,
      options.inputPrice ?? 10_000_000n,
      options.cachedInputPrice ?? 2_000_000n,
      options.outputPrice ?? 20_000_000n,
    ),
  };
}

function postgresNumericTrendSumRow(
  periodStart: string,
  totalTokens: bigint,
  inputTokens: bigint,
  cachedInputTokens: bigint,
  outputTokens: bigint,
  reasoningOutputTokens: bigint,
) {
  const row = trendSumRow(
    periodStart,
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  );
  return {
    ...row,
    totalTokens: new Prisma.Decimal(row.totalTokens.toString()),
    inputTokens: new Prisma.Decimal(row.inputTokens.toString()),
    cachedInputTokens: new Prisma.Decimal(row.cachedInputTokens.toString()),
    outputTokens: new Prisma.Decimal(row.outputTokens.toString()),
    reasoningOutputTokens: new Prisma.Decimal(
      row.reasoningOutputTokens.toString(),
    ),
    inputCostPicoCny: new Prisma.Decimal(row.inputCostPicoCny.toString()),
    cachedInputCostPicoCny: new Prisma.Decimal(
      row.cachedInputCostPicoCny.toString(),
    ),
    outputCostPicoCny: new Prisma.Decimal(row.outputCostPicoCny.toString()),
    totalCostPicoCny: new Prisma.Decimal(row.totalCostPicoCny.toString()),
    unpricedTokens: new Prisma.Decimal(row.unpricedTokens.toString()),
  };
}

function usageCost(
  inputTokens: bigint,
  cachedInputTokens: bigint,
  outputTokens: bigint,
  inputPrice: bigint,
  cachedInputPrice: bigint,
  outputPrice: bigint,
) {
  const inputCostPicoCny = (inputTokens - cachedInputTokens) * inputPrice;
  const cachedInputCostPicoCny = cachedInputTokens * cachedInputPrice;
  const outputCostPicoCny = outputTokens * outputPrice;
  return {
    inputCostPicoCny,
    cachedInputCostPicoCny,
    outputCostPicoCny,
    totalCostPicoCny:
      inputCostPicoCny + cachedInputCostPicoCny + outputCostPicoCny,
    unpricedTokens: 0n,
  };
}
