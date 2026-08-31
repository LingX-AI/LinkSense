import { z } from "zod";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export const tokenLimitValueSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/u, "token_limit_must_be_positive_integer")
  .refine(
    (value) => {
      try {
        return BigInt(value) <= POSTGRES_BIGINT_MAX;
      } catch {
        return false;
      }
    },
    "token_limit_too_large",
  );

export const tokenLimitSettingsSchema = z.strictObject({
  weekly_token_limit: tokenLimitValueSchema.nullable().default(null),
  monthly_token_limit: tokenLimitValueSchema.nullable().default(null),
});

const updateTokenLimitsInputShape = {
  weekly_token_limit: tokenLimitValueSchema.nullable().optional(),
  monthly_token_limit: tokenLimitValueSchema.nullable().optional(),
} as const;

export const updateTokenLimitsInputSchema = z
  .strictObject(updateTokenLimitsInputShape)
  .refine((value) => Object.keys(value).length > 0, {
    message: "token_limit_update_requires_at_least_one_field",
  });

export const bulkUpdateUserTokenLimitsInputSchema =
  z.strictObject({
    total_token_limit: tokenLimitValueSchema.nullable().optional(),
    ...updateTokenLimitsInputShape,
    user_ids: z.array(z.string().uuid()).min(1).max(500),
  }).refine(
    (value) =>
      value.total_token_limit !== undefined ||
      value.weekly_token_limit !== undefined ||
      value.monthly_token_limit !== undefined,
    { message: "token_limit_update_requires_at_least_one_field" },
  );

export type TokenLimitSettings = z.infer<typeof tokenLimitSettingsSchema>;
export type UpdateTokenLimitsInput = z.infer<
  typeof updateTokenLimitsInputSchema
>;
export type BulkUpdateUserTokenLimitsInput = z.infer<
  typeof bulkUpdateUserTokenLimitsInputSchema
>;
