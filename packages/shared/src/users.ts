import { z } from "zod";

import {
  localeSchema,
  timestampSchema,
  uniqueArraySchema,
  uuidSchema,
} from "./common.js";
import {
  bulkUpdateUserTokenLimitsInputSchema,
  tokenLimitValueSchema,
} from "./token-limits.js";

export const userRoleSchema = z.enum(["user", "admin"]);
export const userStatusSchema = z.enum(["active", "disabled"]);
export const loginMethodSchema = z.enum(["password", "oidc", "teams"]);
export const userRegistrationSourceSchema = z.enum([
  "self_registration",
  "organization_invitation",
]);

export const emailSchema = z
  .string()
  .trim()
  .email()
  .transform((email) => email.toLocaleLowerCase("en-US"));

export const userNameSchema = z.string().trim().min(1).max(120);

export const userSchema = z.strictObject({
  id: uuidSchema,
  email: emailSchema,
  name: userNameSchema,
  avatar_object_key: z.string().min(1).nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  preferred_locale: localeSchema.nullable(),
  last_login_at: timestampSchema.nullable(),
  last_login_method: loginMethodSchema.nullable(),
  password_updated_at: timestampSchema.nullable(),
  registration_source: userRegistrationSourceSchema,
  total_token_limit: tokenLimitValueSchema.nullable().default(null),
  weekly_token_limit: tokenLimitValueSchema.nullable().default(null),
  monthly_token_limit: tokenLimitValueSchema.nullable().default(null),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const createUserInputSchema = z.strictObject({
  email: emailSchema,
  name: userNameSchema,
  role: userRoleSchema.default("user"),
  user_group_ids: uniqueArraySchema(uuidSchema).default([]),
});

export const importUserRowSchema = z.strictObject({
  name: userNameSchema,
  email: emailSchema,
  role: userRoleSchema,
  user_groups: uniqueArraySchema(z.string().trim().min(1).max(120)).default([]),
});

export const updateUserInputSchema = z
  .strictObject({
    email: emailSchema.optional(),
    name: userNameSchema.optional(),
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
    user_group_ids: uniqueArraySchema(uuidSchema).optional(),
    total_token_limit: tokenLimitValueSchema.nullable().optional(),
    weekly_token_limit: tokenLimitValueSchema.nullable().optional(),
    monthly_token_limit: tokenLimitValueSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "user_update_requires_at_least_one_field",
  });

export const bulkUserTokenLimitsInputSchema =
  bulkUpdateUserTokenLimitsInputSchema;

export const userGroupSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).nullable(),
  created_by: uuidSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const userGroupMemberStatusSchema = z.enum(["active", "revoked"]);

export const userGroupMemberSchema = z.strictObject({
  id: uuidSchema,
  user_id: uuidSchema,
  user_group_id: uuidSchema,
  status: userGroupMemberStatusSchema,
  created_by: uuidSchema.nullable(),
  revoked_by: uuidSchema.nullable(),
  revoked_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type User = z.infer<typeof userSchema>;
export type CreateUserInput = z.input<typeof createUserInputSchema>;
export type ImportUserRow = z.input<typeof importUserRowSchema>;
export type UpdateUserInput = z.input<typeof updateUserInputSchema>;
export type BulkUserTokenLimitsInput = z.input<
  typeof bulkUserTokenLimitsInputSchema
>;
export type UserGroup = z.infer<typeof userGroupSchema>;
