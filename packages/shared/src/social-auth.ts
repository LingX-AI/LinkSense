import { z } from "zod"

export const socialProviderSchema = z.enum([
  "google",
  "apple",
  "microsoft",
  "facebook",
])
export type SocialProvider = z.infer<typeof socialProviderSchema>

export const updateSocialProviderSchema = z
  .strictObject({
    expected_revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    client_id: z.string().trim().max(512),
    client_secret: z.string().min(1).max(16_384).optional(),
    team_id: z
      .string()
      .regex(/^[A-Z0-9]{10}$/u)
      .optional(),
    key_id: z
      .string()
      .regex(/^[A-Z0-9]{10}$/u)
      .optional(),
    graph_api_version: z
      .string()
      .regex(/^v\d{2,3}\.0$/u)
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.enabled && !value.client_id) {
      context.addIssue({
        code: "custom",
        path: ["client_id"],
        message: "required",
      })
    }
  })
export type UpdateSocialProvider = z.infer<typeof updateSocialProviderSchema>

export const socialProviderSettingsSchema = z.strictObject({
  provider: socialProviderSchema,
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  client_id: z.string(),
  secret_configured: z.boolean(),
  team_id: z.string().nullable(),
  key_id: z.string().nullable(),
  graph_api_version: z.string().nullable(),
  redirect_uri: z.url(),
})
export type SocialProviderSettings = z.infer<
  typeof socialProviderSettingsSchema
>
export const socialSettingsSchema = z.array(socialProviderSettingsSchema)
export const socialProvidersSchema = z.array(socialProviderSchema)
export const socialAccountsSchema = z.array(
  z.strictObject({
    provider: socialProviderSchema,
    created_at: z.iso.datetime(),
  }),
)
export const socialStartSchema = z.strictObject({ authorization_url: z.url() })
export const socialEmailInputSchema = z.strictObject({
  email: z
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
})
export const socialEmailCompleteSchema = z.strictObject({
  token: z.string().min(32).max(256),
})

export const socialCallbackResultSchema = z.enum([
  "success",
  "linked",
  "verify_email",
  "failed",
  "disabled",
  "email_exists",
  "registration_disabled",
  "last_method",
  "already_linked",
  "configuration_changed",
])
export type SocialCallbackResult = z.infer<typeof socialCallbackResultSchema>
