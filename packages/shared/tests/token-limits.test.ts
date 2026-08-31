import { describe, expect, it } from "vitest";

import {
  bulkUserTokenLimitsInputSchema,
  modelProviderSettingsSchema,
  tokenLimitValueSchema,
  updateModelProviderSettingsSchema,
  updateUserInputSchema,
} from "../src/index.js";

describe("token limit contracts", () => {
  it("accepts positive integer token limits and rejects invalid values", () => {
    expect(tokenLimitValueSchema.parse(" 1000 ")).toBe("1000");
    expect(tokenLimitValueSchema.safeParse("0").success).toBe(false);
    expect(tokenLimitValueSchema.safeParse("-1").success).toBe(false);
    expect(tokenLimitValueSchema.safeParse("12.5").success).toBe(false);
    expect(
      tokenLimitValueSchema.safeParse("9223372036854775808").success,
    ).toBe(false);
  });

  it("defaults model settings token limits to no limit", () => {
    expect(
      modelProviderSettingsSchema.parse({
        configured: false,
        revision: 0,
        providers: [],
        default_model: null,
      }).token_limits,
    ).toEqual({
      weekly_token_limit: null,
      monthly_token_limit: null,
    });
  });

  it("accepts user and batch limit updates with nullable fields", () => {
    expect(
      updateUserInputSchema.parse({
        weekly_token_limit: "10000",
        monthly_token_limit: null,
      }),
    ).toEqual({
      weekly_token_limit: "10000",
      monthly_token_limit: null,
    });
    expect(
      bulkUserTokenLimitsInputSchema.parse({
        user_ids: ["00000000-0000-4000-8000-000000000001"],
        total_token_limit: "50000",
        weekly_token_limit: null,
      }),
    ).toEqual({
      user_ids: ["00000000-0000-4000-8000-000000000001"],
      total_token_limit: "50000",
      weekly_token_limit: null,
    });
  });

  it("adds default token limits to model provider updates", () => {
    const result = updateModelProviderSettingsSchema.safeParse({
      expected_revision: 0,
      providers: [
        {
          id: "provider-1",
          provider: "openai_compatible",
          provider_project: null,
          provider_location: null,
          base_url: "https://models.example.test/v1",
          api_key: "secret",
          models: [
            {
              id: "model-1",
              display_name: "Model 1",
              kind: "chat",
              enabled: true,
              supported_reasoning_efforts: ["medium"],
              default_reasoning_effort: "medium",
            },
          ],
        },
      ],
      default_model: "model-1",
    });

    if (!result.success) throw result.error;
    expect(result.data.token_limits).toEqual({
      weekly_token_limit: null,
      monthly_token_limit: null,
    });
  });
});
