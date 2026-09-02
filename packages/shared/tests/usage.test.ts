import { describe, expect, it } from "vitest";

import {
  applicationUsageReportSchema,
  personalUsageProfileQuerySchema,
  personalUsageProfileSchema,
  usageAnalyticsReportQuerySchema,
  usageTokenTrendSchema,
} from "../src/index.js";

describe("usage analytics contracts", () => {
  it("defaults personal usage queries to UTC", () => {
    expect(personalUsageProfileQuerySchema.parse({})).toEqual({
      time_zone: "UTC",
    });
    expect(
      personalUsageProfileQuerySchema.safeParse({
        time_zone: "Invalid/Time_Zone",
      }).success,
    ).toBe(false);
  });

  it("defaults to an all-time UTC report", () => {
    expect(usageAnalyticsReportQuerySchema.parse({})).toEqual({
      range: "all",
      time_zone: "UTC",
    });
  });

  it("accepts a complete ordered custom calendar range", () => {
    expect(
      usageAnalyticsReportQuerySchema.parse({
        range: "custom",
        date_from: "2026-07-01",
        date_to: "2026-07-27",
        time_zone: "Asia/Shanghai",
      }),
    ).toEqual({
      range: "custom",
      date_from: "2026-07-01",
      date_to: "2026-07-27",
      time_zone: "Asia/Shanghai",
    });
  });

  it("rejects incomplete, inverted, ambiguous, or invalid-zone ranges", () => {
    for (const query of [
      { range: "custom", date_from: "2026-07-01" },
      {
        range: "custom",
        date_from: "2026-07-28",
        date_to: "2026-07-27",
      },
      { range: "7d", date_from: "2026-07-01", date_to: "2026-07-27" },
      { range: "all", time_zone: "Invalid/Time_Zone" },
    ]) {
      expect(usageAnalyticsReportQuerySchema.safeParse(query).success).toBe(
        false,
      );
    }
  });

  it("keeps trend token counts precise as decimal strings", () => {
    const trend = {
      granularity: "day",
      points: [
        {
          period_start: "2026-07-27",
          token_usage: {
            total_tokens: "9007199254740993",
            input_tokens: "9007199254740000",
            cached_input_tokens: "100",
            output_tokens: "993",
            reasoning_output_tokens: "20",
          },
          cost: {
            currency: "CNY",
            total_cost: "12.345678901234",
            input_cost: "10",
            cached_input_cost: "0.345678901234",
            output_cost: "2",
            unpriced_tokens: "0",
          },
          workloads: [
            {
              workload: "document_embedding",
              request_count: 1,
              measurement_methods: ["provider"],
              token_usage: {
                total_tokens: "9007199254740993",
                input_tokens: "9007199254740000",
                cached_input_tokens: "100",
                output_tokens: "993",
                reasoning_output_tokens: "20",
              },
              cost: {
                currency: "CNY",
                total_cost: "12.345678901234",
                input_cost: "10",
                cached_input_cost: "0.345678901234",
                output_cost: "2",
                unpriced_tokens: "0",
              },
            },
          ],
        },
      ],
    };

    expect(usageTokenTrendSchema.parse(trend)).toEqual(trend);
    expect(
      usageTokenTrendSchema.safeParse({
        ...trend,
        points: [
          {
            ...trend.points[0],
            token_usage: {
              ...trend.points[0]?.token_usage,
              total_tokens: 9_007_199_254_740_993,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps personal profile usage and daily activity token counts precise", () => {
    const profile = {
      generated_at: "2026-07-27T12:00:00.000Z",
      activity_period: {
        from: "2025-07-28",
        to: "2026-07-27",
        time_zone: "Asia/Shanghai",
      },
      token_coverage: {
        started_at: "2026-07-01T00:00:00.000Z",
      },
      metrics: {
        task_count: 3,
        turn_count: 4,
        request_count: 4,
        skill_usage_count: 2,
        token_usage: {
          total_tokens: "9007199254740993",
          input_tokens: "9007199254740000",
          cached_input_tokens: "100",
          output_tokens: "993",
          reasoning_output_tokens: "20",
        },
      },
      peak_daily_tokens: "9007199254740993",
      active_days: 1,
      current_streak_days: 1,
      longest_streak_days: 1,
      daily_activity: [
        {
          date: "2026-07-27",
          total_tokens: "9007199254740993",
        },
      ],
      models: [],
      skills: [
        {
          skill_id: "builtin:capability:linksense-browser",
          name: "linksense-browser",
          usage_count: 2,
        },
      ],
    };

    expect(personalUsageProfileSchema.parse(profile)).toEqual(profile);
    expect(
      personalUsageProfileSchema.safeParse({
        ...profile,
        daily_activity: [{ date: "2026-07-27", total_tokens: 100 }],
      }).success,
    ).toBe(false);
    expect(
      personalUsageProfileSchema.safeParse({
        ...profile,
        metrics: {
          ...profile.metrics,
          cost: {
            currency: "CNY",
            total_cost: "12.345678901234",
            input_cost: "10",
            cached_input_cost: "0.345678901234",
            output_cost: "2",
            unpriced_tokens: "0",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("validates an application-scoped usage report without user identities", () => {
    const report = {
      application: {
        id: "50000000-0000-4000-8000-000000000001",
        name: "研究助手",
      },
      range: "7d",
      generated_at: "2026-07-27T12:00:00.000Z",
      period: {
        from: "2026-07-21T00:00:00.000Z",
        to: "2026-07-27T12:00:00.000Z",
        time_zone: "UTC",
      },
      token_coverage: {
        started_at: "2026-07-01T00:00:00.000Z",
        complete_for_period: true,
      },
      active_user_count: 2,
      totals: {
        task_count: 3,
        turn_count: 5,
        request_count: 6,
        token_usage: {
          total_tokens: "1200",
          input_tokens: "900",
          cached_input_tokens: "300",
          output_tokens: "300",
          reasoning_output_tokens: "100",
        },
        cost: {
          currency: "CNY",
          total_cost: "1.2",
          input_cost: "0.7",
          cached_input_cost: "0.1",
          output_cost: "0.4",
          unpriced_tokens: "0",
        },
      },
      token_trend: { granularity: "day", points: [] },
      workloads: [],
      models: [],
    };

    expect(applicationUsageReportSchema.parse(report)).toEqual(report);
    expect(
      applicationUsageReportSchema.safeParse({
        ...report,
        users: [{ email: "private@example.test" }],
      }).success,
    ).toBe(false);
  });
});
