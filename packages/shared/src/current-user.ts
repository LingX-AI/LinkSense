import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { creditAmountSchema } from "./credit-limits.js";
import { emailSchema, userNameSchema } from "./users.js";

export const currentUserInfoInputSchema = z.strictObject({});

export const currentUserGroupSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
});

export const currentUserCreditQuotaPeriodSchema = z.strictObject({
  limit_credits: creditAmountSchema,
  used_credits: creditAmountSchema,
  remaining_credits: creditAmountSchema,
  remaining_percentage: z.number().int().min(0).max(100),
  reset_at: timestampSchema,
});

export const currentUserInfoSuccessSchema = z.strictObject({
  success: z.literal(true),
  user: z.strictObject({
    name: userNameSchema.nullable(),
    email: emailSchema.nullable(),
    user_groups: z.array(currentUserGroupSchema).max(10_000),
  }),
  credit_quota: z.strictObject({
    weekly: currentUserCreditQuotaPeriodSchema.nullable(),
  }),
});

export const currentUserInfoFailureCodeSchema = z.enum([
  "CURRENT_USER_INVALID",
  "CURRENT_USER_FORBIDDEN",
  "CURRENT_USER_UNAVAILABLE",
]);

export const currentUserInfoFailureSchema = z.strictObject({
  code: currentUserInfoFailureCodeSchema,
  retryable: z.boolean(),
});

export type CurrentUserInfoInput = z.infer<typeof currentUserInfoInputSchema>;
export type CurrentUserInfoSuccess = z.infer<
  typeof currentUserInfoSuccessSchema
>;
export type CurrentUserInfoFailure = z.infer<
  typeof currentUserInfoFailureSchema
>;
