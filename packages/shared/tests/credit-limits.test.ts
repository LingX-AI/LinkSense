import { describe, expect, it } from "vitest";
import {
  bulkUserCreditLimitsInputSchema,
  creditAmountSchema,
  creditLimitValueSchema,
  creditMicrosToDecimal,
  decimalToCreditMicros,
  defaultQuotaSettings,
  modelProviderSettingsSchema,
  quotaSettingsSchema,
  updateUserInputSchema,
} from "../src/index.js";

describe("credit quota contracts", () => {
  it.each(["0.000001", "12.5", "9223372036854.775807"])(
    "accepts a positive credit amount %s without losing precision",
    (value) => {
      expect(creditLimitValueSchema.parse(value)).toBe(value);
      expect(creditMicrosToDecimal(decimalToCreditMicros(value))).toBe(value);
    },
  );
  it.each([
    "0",
    "-1",
    "1e3",
    "NaN",
    "0.0000001",
    "1.1234567",
    "9223372036854.775808",
  ])("rejects invalid or out-of-range amount %s", (value) => {
    expect(creditLimitValueSchema.safeParse(value).success).toBe(false);
  });
  it("normalizes amounts and permits zero consumption", () => {
    expect(creditAmountSchema.parse(" 001.200000 ")).toBe("1.2");
    expect(creditAmountSchema.parse("0")).toBe("0");
  });
  it("supports one optional weekly limit for all members", () => {
    const settings = defaultQuotaSettings();
    settings.weekly_credit_limit = "100";
    expect(quotaSettingsSchema.parse(settings)).toEqual(settings);
    expect(quotaSettingsSchema.parse(defaultQuotaSettings()).weekly_credit_limit).toBeNull();
    expect(
      quotaSettingsSchema.safeParse({ ...settings, credit_price_cny: "0" })
        .success,
    ).toBe(false);
  });
  it("rejects removed monthly, total, and population-specific quota fields", () => {
    const settings = defaultQuotaSettings();
    expect(
      quotaSettingsSchema.safeParse({
        ...settings,
        monthly_credit_limit: "300",
      }).success,
    ).toBe(false);
    expect(
      quotaSettingsSchema.safeParse({
        ...settings,
        total_credit_limit: "300",
      }).success,
    ).toBe(false);
    expect(
      quotaSettingsSchema.safeParse({
        ...settings,
        organization_members: { weekly_credit_limit: "300" },
      }).success,
    ).toBe(false);
    expect(
      updateUserInputSchema.safeParse({ monthly_credit_limit: "300" }).success,
    ).toBe(false);
    expect(
      updateUserInputSchema.safeParse({ total_credit_limit: "300" }).success,
    ).toBe(false);
  });
  it("supports clearing weekly user limits", () => {
    expect(
      updateUserInputSchema.parse({
        weekly_credit_limit: "0.01",
      }),
    ).toEqual({ weekly_credit_limit: "0.01" });
    const input = {
      user_ids: ["00000000-0000-4000-8000-000000000001"],
      weekly_credit_limit: null,
    };
    expect(bulkUserCreditLimitsInputSchema.parse(input)).toEqual(input);
    expect(
      bulkUserCreditLimitsInputSchema.safeParse({ user_ids: input.user_ids })
        .success,
    ).toBe(false);
  });
  it("removes quota settings from the model settings contract and rejects the old field", () => {
    const settings = {
      configured: false,
      revision: 0,
      providers: [],
      default_model: null,
    };
    expect(modelProviderSettingsSchema.parse(settings)).not.toHaveProperty(
      "token_limits",
    );
    expect(
      modelProviderSettingsSchema.safeParse({ ...settings, token_limits: {} })
        .success,
    ).toBe(false);
  });
});
