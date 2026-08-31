import {
  usageAnalyticsReportSchema,
  type UsageAnalyticsReport,
  type UsageModelBreakdown,
  type UsageWorkload,
} from "@linksense/shared";

export function usageReportFixture(): UsageAnalyticsReport {
  const firstModel = model("model-a", "模型 A", 1, "5", "0.005");
  const secondModel = model(
    "embedding-b",
    "向量模型 B",
    1,
    "7",
    "0.007",
    "embedding",
    "document_embedding",
  );
  return usageAnalyticsReportSchema.parse({
    range: "custom",
    generated_at: "2026-07-30T04:00:00.000Z",
    period: {
      from: "2026-07-28T16:00:00.000Z",
      to: "2026-07-30T15:59:59.999Z",
      time_zone: "Asia/Shanghai",
    },
    token_coverage: {
      started_at: "2026-07-27T09:08:00.000Z",
      complete_for_period: true,
    },
    group_semantics: "current_membership_coverage",
    totals: metrics(2, 2, "12", "0.012"),
    token_trend: {
      granularity: "day",
      points: [
        trendPoint("2026-07-29", "assistant_response", "5", "0.005"),
        trendPoint("2026-07-30", "document_embedding", "7", "0.007"),
      ],
    },
    workloads: [
      workload("assistant_response", "5", "0.005"),
      workload("document_embedding", "7", "0.007"),
    ],
    models: [firstModel, secondModel],
    applications: [
      {
        application_id: "50000000-0000-4000-8000-000000000001",
        application_name: "知识助手",
        is_unattributed: false,
        metrics: metrics(1, 1, "5", "0.005"),
        models: [firstModel],
      },
      {
        application_id: null,
        application_name: "Unattributed",
        is_unattributed: true,
        metrics: metrics(1, 1, "7", "0.007"),
        models: [secondModel],
      },
    ],
    groups: [
      {
        group_id: "40000000-0000-4000-8000-000000000001",
        group_name: "研发组",
        is_ungrouped: false,
        member_count: 2,
        metrics: metrics(2, 2, "12", "0.012"),
        models: [firstModel, secondModel],
      },
    ],
    users: [
      user(
        "10000000-0000-4000-8000-000000000001",
        "林一",
        "lin@example.test",
        firstModel,
        "5",
        "0.005",
      ),
      user(
        "10000000-0000-4000-8000-000000000002",
        "王二",
        "wang@example.test",
        secondModel,
        "7",
        "0.007",
      ),
    ],
  });
}

function metrics(
  taskCount: number,
  turnCount: number,
  totalTokens: string,
  totalCost: string,
) {
  return {
    task_count: taskCount,
    turn_count: turnCount,
    request_count: turnCount,
    token_usage: tokens(totalTokens),
    cost: cost(totalCost),
  };
}

function tokens(totalTokens: string) {
  const total = BigInt(totalTokens);
  return {
    total_tokens: total.toString(),
    input_tokens: (total - 2n).toString(),
    cached_input_tokens: total > 5n ? "3" : "1",
    output_tokens: "2",
    reasoning_output_tokens: "1",
  };
}

function cost(totalCost: string) {
  return {
    currency: "CNY" as const,
    total_cost: totalCost,
    input_cost: totalCost,
    cached_input_cost: "0",
    output_cost: "0",
    unpriced_tokens: "0",
  };
}

function trendPoint(
  periodStart: string,
  workloadType: UsageWorkload,
  totalTokens: string,
  totalCost: string,
) {
  return {
    period_start: periodStart,
    token_usage: tokens(totalTokens),
    cost: cost(totalCost),
    workloads: [workload(workloadType, totalTokens, totalCost)],
  };
}

function workload(
  workloadType: UsageWorkload,
  totalTokens: string,
  totalCost: string,
) {
  return {
    workload: workloadType,
    request_count: 1,
    measurement_methods: ["provider" as const],
    token_usage: tokens(totalTokens),
    cost: cost(totalCost),
  };
}

function model(
  modelId: string,
  displayName: string,
  requestCount: number,
  totalTokens: string,
  totalCost: string,
  modelKind: "generation" | "embedding" | "rerank" = "generation",
  workloadType: UsageWorkload = "assistant_response",
): UsageModelBreakdown {
  return {
    model_id: modelId,
    display_name: displayName,
    model_kind: modelKind,
    workload_types: [workloadType],
    measurement_methods: ["provider"],
    request_count: requestCount,
    turn_count: modelKind === "generation" ? requestCount : 0,
    token_usage: tokens(totalTokens),
    cost: cost(totalCost),
  };
}

function user(
  userId: string,
  name: string,
  email: string,
  usageModel: UsageModelBreakdown,
  totalTokens: string,
  totalCost: string,
) {
  return {
    user_id: userId,
    name,
    email,
    role: "user" as const,
    status: "active" as const,
    groups: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        name: "研发组",
      },
    ],
    metrics: metrics(1, usageModel.turn_count, totalTokens, totalCost),
    models: [usageModel],
  };
}
