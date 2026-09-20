import { z } from "zod";
import { creditAmountSchema } from "./credit-limits.js";
import { usageAnalyticsTimeZoneSchema, usageWorkloadSchema } from "./usage.js";

export const personalQuotaQuerySchema = z.strictObject({
  range: z.enum(["7d", "30d"]).default("7d"),
  time_zone: usageAnalyticsTimeZoneSchema.default("UTC"),
});
export const personalQuotaOverviewSchema = z.strictObject({
  limit: creditAmountSchema.nullable(),
  used: creditAmountSchema,
  remaining: creditAmountSchema.nullable(),
  reset_at: z.iso.datetime(),
  time_zone: usageAnalyticsTimeZoneSchema,
});
const creditBreakdownSchema = z.strictObject({
  model: z.string(),
  workload: usageWorkloadSchema,
  credits: creditAmountSchema,
});
const countPointSchema = z.strictObject({
  date: z.iso.date(),
  name: z.string(),
  count: z.number().int().nonnegative(),
});
export const personalQuotaAnalyticsSchema = z.strictObject({
  generated_at: z.iso.datetime(),
  range: z.enum(["7d", "30d"]),
  time_zone: usageAnalyticsTimeZoneSchema,
  dates: z.array(z.iso.date()),
  credits: z.array(creditBreakdownSchema.extend({ date: z.iso.date() })),
  tasks: z.array(z.strictObject({
    id: z.uuid().nullable(),
    title: z.string().nullable(),
    credits: creditAmountSchema,
    breakdown: z.array(creditBreakdownSchema),
  })),
  tools: z.array(countPointSchema),
  skills: z.array(countPointSchema),
  messages: z.array(countPointSchema),
});
export const personalQuotaReportSchema = z.strictObject({
  overview: personalQuotaOverviewSchema,
  analytics: personalQuotaAnalyticsSchema,
});
export type PersonalQuotaQuery = z.infer<typeof personalQuotaQuerySchema>;
export type PersonalQuotaOverview = z.infer<typeof personalQuotaOverviewSchema>;
export type PersonalQuotaAnalytics = z.infer<typeof personalQuotaAnalyticsSchema>;
export type PersonalQuotaReport = z.infer<typeof personalQuotaReportSchema>;
