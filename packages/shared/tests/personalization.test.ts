import { describe, expect, it } from "vitest";

import {
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  personalizationSettingsSchema,
  runnerMemoryUsageCaptureSchema,
  updatePersonalizationSettingsSchema,
} from "../src/index.js";

describe("personalization contracts", () => {
  it("accepts the supported settings and partial updates", () => {
    expect(
      personalizationSettingsSchema.parse({
        custom_instructions: "请优先使用中文回答。",
        memories_enabled: true,
      }),
    ).toEqual({
      custom_instructions: "请优先使用中文回答。",
      memories_enabled: true,
    });
    expect(
      updatePersonalizationSettingsSchema.parse({
        memories_enabled: false,
      }),
    ).toEqual({ memories_enabled: false });
  });

  it("rejects empty updates and oversized custom instructions", () => {
    expect(updatePersonalizationSettingsSchema.safeParse({}).success).toBe(
      false,
    );
    expect(
      personalizationSettingsSchema.safeParse({
        custom_instructions: "x".repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 1),
        memories_enabled: true,
      }).success,
    ).toBe(false);
  });

  it("validates durable memory-usage captures", () => {
    const capture = {
      request_id: "10000000-0000-4000-8000-000000000001",
      owner_id: "10000000-0000-4000-8000-000000000002",
      conversation_id: "10000000-0000-4000-8000-000000000003",
      operation: "consolidate",
      model: "gpt-5.2",
      measurement_method: "provider",
      token_usage: {
        total_tokens: 15,
        input_tokens: 10,
        cached_input_tokens: 2,
        output_tokens: 5,
        reasoning_output_tokens: 1,
      },
      pricing: {
        input_price_per_million: "1",
        cached_input_price_per_million: "0.1",
        output_price_per_million: "8",
      },
      observed_at: "2026-07-31T08:00:00.000Z",
    } as const;

    expect(runnerMemoryUsageCaptureSchema.parse(capture)).toEqual(capture);
    expect(
      runnerMemoryUsageCaptureSchema.safeParse({
        ...capture,
        token_usage: {
          ...capture.token_usage,
          cached_input_tokens: 11,
        },
      }).success,
    ).toBe(false);
  });
});
