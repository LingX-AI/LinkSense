import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const usageAnalyticsRangeValues = [
  "all",
  "7d",
  "30d",
  "custom",
] as const;
export const usageAnalyticsRangeSchema = z.enum(usageAnalyticsRangeValues);

export const usageAnalyticsTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(isSupportedTimeZone, "unsupported_time_zone");

export const personalUsageProfileQuerySchema = z.strictObject({
  time_zone: usageAnalyticsTimeZoneSchema.default("UTC"),
});

export const usageAnalyticsReportQuerySchema = z
  .strictObject({
    range: usageAnalyticsRangeSchema.default("all"),
    date_from: z.iso.date().optional(),
    date_to: z.iso.date().optional(),
    time_zone: usageAnalyticsTimeZoneSchema.default("UTC"),
  })
  .superRefine((query, context) => {
    if (query.range === "custom") {
      if (!query.date_from) {
        context.addIssue({
          code: "custom",
          path: ["date_from"],
          message: "date_from_required_for_custom_range",
        });
      }
      if (!query.date_to) {
        context.addIssue({
          code: "custom",
          path: ["date_to"],
          message: "date_to_required_for_custom_range",
        });
      }
      if (query.date_from && query.date_to && query.date_from > query.date_to) {
        context.addIssue({
          code: "custom",
          path: ["date_to"],
          message: "date_to_must_not_precede_date_from",
        });
      }
      return;
    }

    if (query.date_from || query.date_to) {
      context.addIssue({
        code: "custom",
        path: [query.date_from ? "date_from" : "date_to"],
        message: "custom_dates_require_custom_range",
      });
    }
  });

export const usageTokenCountSchema = z.string().regex(/^\d+$/u);

export const usageTokenBreakdownSchema = z.strictObject({
  total_tokens: usageTokenCountSchema,
  input_tokens: usageTokenCountSchema,
  cached_input_tokens: usageTokenCountSchema,
  output_tokens: usageTokenCountSchema,
  reasoning_output_tokens: usageTokenCountSchema,
});

export const usageCostAmountSchema = z.string().regex(/^\d+(?:\.\d{1,12})?$/u);

export const usageCostBreakdownSchema = z.strictObject({
  currency: z.literal("CNY"),
  total_cost: usageCostAmountSchema,
  input_cost: usageCostAmountSchema,
  cached_input_cost: usageCostAmountSchema,
  output_cost: usageCostAmountSchema,
  unpriced_tokens: usageTokenCountSchema,
});

export const knowledgeUsageWorkloadValues = [
  "document_embedding",
  "query_embedding",
  "rerank",
] as const;
export const modelUsageWorkloadValues = [
  ...knowledgeUsageWorkloadValues,
  "image_generation",
  "memory_generation",
  "task_title_generation",
] as const;
export const usageWorkloadValues = [
  "assistant_response",
  ...modelUsageWorkloadValues,
] as const;
export const usageWorkloadSchema = z.enum(usageWorkloadValues);

export const knowledgeUsageModelKindValues = ["embedding", "rerank"] as const;
export const usageModelKindValues = [
  "generation",
  "image",
  ...knowledgeUsageModelKindValues,
] as const;
export const usageModelKindSchema = z.enum(usageModelKindValues);

export const usageMeasurementMethodValues = ["provider", "estimated"] as const;
export const usageMeasurementMethodSchema = z.enum(
  usageMeasurementMethodValues,
);

export const usageMetricsSchema = z.strictObject({
  task_count: z.number().int().nonnegative(),
  turn_count: z.number().int().nonnegative(),
  request_count: z.number().int().nonnegative(),
  token_usage: usageTokenBreakdownSchema,
  cost: usageCostBreakdownSchema,
});

export const usageTokenTrendGranularityValues = [
  "day",
  "month",
  "year",
] as const;
export const usageTokenTrendGranularitySchema = z.enum(
  usageTokenTrendGranularityValues,
);

export const usageTokenTrendPointSchema = z.strictObject({
  period_start: z.iso.date(),
  token_usage: usageTokenBreakdownSchema,
  cost: usageCostBreakdownSchema,
  workloads: z.array(
    z.strictObject({
      workload: usageWorkloadSchema,
      request_count: z.number().int().nonnegative(),
      measurement_methods: z.array(usageMeasurementMethodSchema),
      token_usage: usageTokenBreakdownSchema,
      cost: usageCostBreakdownSchema,
    }),
  ),
});

export const usageTokenTrendSchema = z.strictObject({
  granularity: usageTokenTrendGranularitySchema,
  points: z.array(usageTokenTrendPointSchema),
});

export const usageModelBreakdownSchema = z.strictObject({
  model_id: z.string().min(1).max(240),
  display_name: z.string().min(1).max(120).nullable(),
  model_kind: usageModelKindSchema,
  workload_types: z.array(usageWorkloadSchema),
  measurement_methods: z.array(usageMeasurementMethodSchema),
  request_count: z.number().int().nonnegative(),
  turn_count: z.number().int().nonnegative(),
  token_usage: usageTokenBreakdownSchema,
  cost: usageCostBreakdownSchema,
});

export const usageWorkloadBreakdownSchema = z.strictObject({
  workload: usageWorkloadSchema,
  request_count: z.number().int().nonnegative(),
  measurement_methods: z.array(usageMeasurementMethodSchema),
  token_usage: usageTokenBreakdownSchema,
  cost: usageCostBreakdownSchema,
});

export const usageGroupReferenceSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(120),
});

export const usageGroupBreakdownSchema = z.strictObject({
  group_id: uuidSchema.nullable(),
  group_name: z.string().min(1).max(120),
  is_ungrouped: z.boolean(),
  member_count: z.number().int().nonnegative(),
  metrics: usageMetricsSchema,
  models: z.array(usageModelBreakdownSchema),
});

export const usageApplicationBreakdownSchema = z.strictObject({
  application_id: uuidSchema.nullable(),
  application_name: z.string().min(1).max(160),
  is_unattributed: z.boolean(),
  metrics: usageMetricsSchema,
  models: z.array(usageModelBreakdownSchema),
});

export const usageUserBreakdownSchema = z.strictObject({
  user_id: uuidSchema,
  name: z.string().min(1).max(120),
  email: z.string().email(),
  role: z.enum(["user", "admin"]),
  status: z.enum(["active", "disabled"]),
  groups: z.array(usageGroupReferenceSchema),
  metrics: usageMetricsSchema,
  models: z.array(usageModelBreakdownSchema),
});

export const personalUsageDailyActivitySchema = z.strictObject({
  date: z.iso.date(),
  total_tokens: usageTokenCountSchema,
});

export const personalUsageMetricsSchema = z.strictObject({
  task_count: z.number().int().nonnegative(),
  turn_count: z.number().int().nonnegative(),
  request_count: z.number().int().nonnegative(),
  skill_usage_count: z.number().int().nonnegative(),
  token_usage: usageTokenBreakdownSchema,
});

export const personalUsageModelSchema = z.strictObject({
  model_id: z.string().min(1).max(240),
  display_name: z.string().min(1).max(120).nullable(),
  model_kind: usageModelKindSchema,
  request_count: z.number().int().nonnegative(),
  turn_count: z.number().int().nonnegative(),
  token_usage: usageTokenBreakdownSchema,
});

export const personalUsageSkillSchema = z.strictObject({
  skill_id: z.string().min(1).max(240),
  name: z.string().min(1).max(160),
  usage_count: z.number().int().nonnegative(),
});

export const personalUsageProfileSchema = z.strictObject({
  generated_at: timestampSchema,
  activity_period: z.strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    time_zone: usageAnalyticsTimeZoneSchema,
  }),
  token_coverage: z.strictObject({
    started_at: timestampSchema,
  }),
  metrics: personalUsageMetricsSchema,
  peak_daily_tokens: usageTokenCountSchema,
  active_days: z.number().int().nonnegative(),
  current_streak_days: z.number().int().nonnegative(),
  longest_streak_days: z.number().int().nonnegative(),
  daily_activity: z.array(personalUsageDailyActivitySchema),
  models: z.array(personalUsageModelSchema),
  skills: z.array(personalUsageSkillSchema),
});

export const usageAnalyticsReportSchema = z.strictObject({
  range: usageAnalyticsRangeSchema,
  generated_at: timestampSchema,
  period: z.strictObject({
    from: timestampSchema.nullable(),
    to: timestampSchema,
    time_zone: usageAnalyticsTimeZoneSchema,
  }),
  token_coverage: z.strictObject({
    started_at: timestampSchema,
    complete_for_period: z.boolean(),
  }),
  group_semantics: z.literal("current_membership_coverage"),
  totals: usageMetricsSchema,
  token_trend: usageTokenTrendSchema,
  workloads: z.array(usageWorkloadBreakdownSchema),
  models: z.array(usageModelBreakdownSchema),
  applications: z.array(usageApplicationBreakdownSchema),
  groups: z.array(usageGroupBreakdownSchema),
  users: z.array(usageUserBreakdownSchema),
});

export const applicationUsageReportSchema = z.strictObject({
  application: z.strictObject({
    id: uuidSchema,
    name: z.string().min(1).max(160),
  }),
  range: usageAnalyticsRangeSchema,
  generated_at: timestampSchema,
  period: z.strictObject({
    from: timestampSchema.nullable(),
    to: timestampSchema,
    time_zone: usageAnalyticsTimeZoneSchema,
  }),
  token_coverage: z.strictObject({
    started_at: timestampSchema,
    complete_for_period: z.boolean(),
  }),
  active_user_count: z.number().int().nonnegative(),
  totals: usageMetricsSchema,
  token_trend: usageTokenTrendSchema,
  workloads: z.array(usageWorkloadBreakdownSchema),
  models: z.array(usageModelBreakdownSchema),
});

export const billingStatementStatusSchema = z.literal("generated");
export const billingStatementPricingModeSchema = z.enum(["uniform", "mixed"]);
export const billingStatementMonthSchema = z.string().regex(/^\d{4}-\d{2}$/u);

export const billingStatementPeriodSchema = z.strictObject({
  month: billingStatementMonthSchema,
  from: timestampSchema,
  to_exclusive: timestampSchema,
  time_zone: usageAnalyticsTimeZoneSchema,
});

export const billingStatementSummarySchema = z.strictObject({
  id: uuidSchema,
  statement_number: z.string().min(1).max(40),
  period: billingStatementPeriodSchema,
  currency: z.literal("CNY"),
  status: billingStatementStatusSchema,
  total_cost: usageCostAmountSchema,
  unpriced_tokens: usageTokenCountSchema,
  generated_at: timestampSchema,
});

export const billingStatementModelLineSchema = z.strictObject({
  model_id: z.string().min(1).max(240),
  display_name: z.string().min(1).max(120).nullable(),
  token_usage: usageTokenBreakdownSchema,
  cost: usageCostBreakdownSchema,
  pricing: z.strictObject({
    mode: billingStatementPricingModeSchema,
    input_price_per_million: usageCostAmountSchema.nullable(),
    cached_input_price_per_million: usageCostAmountSchema.nullable(),
    output_price_per_million: usageCostAmountSchema.nullable(),
  }),
});

export const billingStatementDetailSchema =
  billingStatementSummarySchema.extend({
    models: z.array(billingStatementModelLineSchema),
  });

export const billingStatementListSchema = z.strictObject({
  generated_at: timestampSchema,
  current_period: z.strictObject({
    period: billingStatementPeriodSchema,
    expected_generation_at: timestampSchema,
  }),
  statements: z.array(billingStatementSummarySchema),
});

export const billingStatementPdfQuerySchema = z.strictObject({
  locale: z.enum(["zh-CN", "en-US"]).optional(),
});

export type UsageAnalyticsRange = z.infer<typeof usageAnalyticsRangeSchema>;
export type BillingStatementSummary = z.infer<
  typeof billingStatementSummarySchema
>;
export type BillingStatementDetail = z.infer<
  typeof billingStatementDetailSchema
>;
export type BillingStatementList = z.infer<typeof billingStatementListSchema>;
export type BillingStatementModelLine = z.infer<
  typeof billingStatementModelLineSchema
>;
export type PersonalUsageProfileQuery = z.infer<
  typeof personalUsageProfileQuerySchema
>;
export type UsageAnalyticsReportQuery = z.infer<
  typeof usageAnalyticsReportQuerySchema
>;
export type UsageTokenBreakdown = z.infer<typeof usageTokenBreakdownSchema>;
export type UsageCostBreakdown = z.infer<typeof usageCostBreakdownSchema>;
export type UsageWorkload = z.infer<typeof usageWorkloadSchema>;
export type UsageModelKind = z.infer<typeof usageModelKindSchema>;
export type UsageMeasurementMethod = z.infer<
  typeof usageMeasurementMethodSchema
>;
export type UsageTokenTrendGranularity = z.infer<
  typeof usageTokenTrendGranularitySchema
>;
export type UsageTokenTrendPoint = z.infer<typeof usageTokenTrendPointSchema>;
export type UsageMetrics = z.infer<typeof usageMetricsSchema>;
export type UsageModelBreakdown = z.infer<typeof usageModelBreakdownSchema>;
export type UsageWorkloadBreakdown = z.infer<
  typeof usageWorkloadBreakdownSchema
>;
export type UsageGroupBreakdown = z.infer<typeof usageGroupBreakdownSchema>;
export type UsageApplicationBreakdown = z.infer<
  typeof usageApplicationBreakdownSchema
>;
export type UsageUserBreakdown = z.infer<typeof usageUserBreakdownSchema>;
export type PersonalUsageDailyActivity = z.infer<
  typeof personalUsageDailyActivitySchema
>;
export type PersonalUsageProfile = z.infer<typeof personalUsageProfileSchema>;
export type UsageAnalyticsReport = z.infer<typeof usageAnalyticsReportSchema>;
export type ApplicationUsageReport = z.infer<
  typeof applicationUsageReportSchema
>;

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
