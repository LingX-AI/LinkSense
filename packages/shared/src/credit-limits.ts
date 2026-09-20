import { z } from "zod";

/** Monetary and credit quantities use six decimal places, without floating point. */
export const CREDIT_SCALE = 1_000_000n;
export const CREDIT_INPUT_PATTERN = "\\d+(?:\\.\\d{1,6})?";
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function creditMicrosToDecimal(value: bigint): string {
  const whole = value / CREDIT_SCALE;
  const fraction = (value % CREDIT_SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function decimalToCreditMicros(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/u.test(value))
    throw new Error("invalid_credit_amount");
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * CREDIT_SCALE + BigInt(fraction.padEnd(6, "0"));
}

export const creditAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,30}(?:\.\d{1,6})?$/u)
  .transform((value) => creditMicrosToDecimal(decimalToCreditMicros(value)));

export const creditLimitValueSchema = creditAmountSchema.refine((value) => {
  const micros = decimalToCreditMicros(value);
  return micros > 0n && micros <= POSTGRES_BIGINT_MAX;
}, "credit_limit_out_of_range");

export const creditLimitSettingsSchema = z.strictObject({
  weekly_credit_limit: creditLimitValueSchema.nullable(),
});

export const quotaSettingsSchema = z.strictObject({
  credit_price_cny: creditLimitValueSchema,
  weekly_credit_limit: creditLimitValueSchema.nullable(),
});

export const resetMemberQuotasInputSchema = z.strictObject({});
export const applyMemberCreditLimitsInputSchema = z.strictObject({
  limits: creditLimitSettingsSchema,
});
export const quotaBatchResultSchema = z.strictObject({
  updated_user_count: z.number().int().nonnegative(),
});
export const applyMemberCreditLimitsResultSchema =
  quotaBatchResultSchema.extend({ settings: quotaSettingsSchema });

export function defaultQuotaSettings(): QuotaSettings {
  return {
    credit_price_cny: "0.01",
    weekly_credit_limit: null,
  };
}

export const updateCreditLimitsInputSchema = creditLimitSettingsSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "credit_limit_update_requires_at_least_one_field",
  );

export const bulkUpdateUserCreditLimitsInputSchema = z
  .strictObject({
    ...creditLimitSettingsSchema.partial().shape,
    user_ids: z.array(z.string().uuid()).min(1).max(500),
  })
  .refine(
    (value) => value.weekly_credit_limit !== undefined,
    "credit_limit_update_requires_at_least_one_field",
  );

export type CreditLimitSettings = z.infer<typeof creditLimitSettingsSchema>;
export type QuotaSettings = z.infer<typeof quotaSettingsSchema>;
export type UpdateCreditLimitsInput = z.infer<
  typeof updateCreditLimitsInputSchema
>;
export type BulkUpdateUserCreditLimitsInput = z.infer<
  typeof bulkUpdateUserCreditLimitsInputSchema
>;
