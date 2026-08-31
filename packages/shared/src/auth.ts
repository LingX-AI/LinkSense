import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { passwordSchema } from "./password.js";
import { tokenLimitValueSchema } from "./token-limits.js";
import { emailSchema, userNameSchema, userRoleSchema } from "./users.js";

const opaqueTokenSchema = z.string().min(32).max(16_384);

export const localLoginInputSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(1_024),
});

export const changePasswordInputSchema = z.strictObject({
  current_password: z.string().min(1).max(1_024),
  new_password: passwordSchema,
});

export const forgotPasswordInputSchema = z.strictObject({
  email: emailSchema,
});

export const resetPasswordInputSchema = z.strictObject({
  token: opaqueTokenSchema,
  new_password: passwordSchema,
});

export const registrationRequestInputSchema = z.strictObject({
  email: emailSchema,
});

export const completeRegistrationInputSchema = z.strictObject({
  token: opaqueTokenSchema,
  new_password: passwordSchema,
});

export const registrationAvailabilitySchema = z.strictObject({
  enabled: z.boolean(),
});

export const registrationSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    total_token_limit: tokenLimitValueSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (value.enabled && value.total_token_limit === null) {
      context.addIssue({
        code: "custom",
        path: ["total_token_limit"],
        message: "registration_total_token_limit_required",
      });
    }
  });

export const updateRegistrationSettingsSchema = registrationSettingsSchema;

export const initializeSystemInputSchema = z.strictObject({
  email: emailSchema,
  name: userNameSchema,
  password: passwordSchema,
  initialization_credential: opaqueTokenSchema.optional(),
});

export const accessTokenClaimsSchema = z.strictObject({
  sub: uuidSchema,
  role: userRoleSchema,
  email: emailSchema,
  auth_valid_after: timestampSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export const tokenPairSchema = z.strictObject({
  access_token: opaqueTokenSchema,
  refresh_token: opaqueTokenSchema,
  access_token_expires_at: timestampSchema,
  refresh_session_expires_at: timestampSchema,
});

export type LocalLoginInput = z.input<typeof localLoginInputSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordInputSchema>;
export type ForgotPasswordInput = z.input<typeof forgotPasswordInputSchema>;
export type ResetPasswordInput = z.input<typeof resetPasswordInputSchema>;
export type RegistrationRequestInput = z.input<
  typeof registrationRequestInputSchema
>;
export type CompleteRegistrationInput = z.input<
  typeof completeRegistrationInputSchema
>;
export type RegistrationSettings = z.infer<typeof registrationSettingsSchema>;
export type RegistrationAvailability = z.infer<
  typeof registrationAvailabilitySchema
>;
export type UpdateRegistrationSettings = z.input<
  typeof updateRegistrationSettingsSchema
>;
export type InitializeSystemInput = z.input<typeof initializeSystemInputSchema>;
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
