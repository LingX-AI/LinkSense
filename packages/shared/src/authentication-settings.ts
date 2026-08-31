import { z } from "zod";

export const authenticationManagementModeSchema = z.enum([
  "inherit",
  "managed",
  "disabled",
]);

export const authenticationConfigurationStatusSchema = z.enum([
  "configured",
  "not_configured",
  "invalid",
]);

export const authenticationConfigurationSourceSchema = z.enum([
  "environment",
  "system",
  "none",
]);

export const smtpSecuritySchema = z.enum(["tls", "starttls"]);

const expectedRevisionSchema = z.number().int().nonnegative();
const smtpHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => !/\s/u.test(value), { message: "smtp_host_invalid" });
const mailFromSchema = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine((value) => !/[\r\n]/u.test(value), {
    message: "smtp_from_header_invalid",
  });
const optionalUsernameSchema = z.string().trim().min(1).max(320).nullable();
const secretSchema = z.string().min(1).max(16_384);
const tokenSecretSchema = z.string().trim().min(1).max(16_384);
const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "https_url_required",
  });

const inheritedAuthenticationSettingsSchema = z.strictObject({
  mode: z.literal("inherit"),
  expected_revision: expectedRevisionSchema,
});

const disabledAuthenticationSettingsSchema = z.strictObject({
  mode: z.literal("disabled"),
  expected_revision: expectedRevisionSchema,
});

export const updateSmtpAuthenticationSettingsSchema = z.discriminatedUnion(
  "mode",
  [
    inheritedAuthenticationSettingsSchema,
    disabledAuthenticationSettingsSchema,
    z.strictObject({
      mode: z.literal("managed"),
      expected_revision: expectedRevisionSchema,
      host: smtpHostSchema,
      port: z.number().int().min(1).max(65_535),
      security: smtpSecuritySchema,
      username: optionalUsernameSchema.optional(),
      password: secretSchema.optional(),
      from: mailFromSchema,
    }),
  ],
);

export const updateOidcAuthenticationSettingsSchema = z.discriminatedUnion(
  "mode",
  [
    inheritedAuthenticationSettingsSchema,
    disabledAuthenticationSettingsSchema,
    z.strictObject({
      mode: z.literal("managed"),
      expected_revision: expectedRevisionSchema,
      issuer_url: httpsUrlSchema,
      client_id: z.string().trim().min(1).max(512),
      client_secret: tokenSecretSchema.optional(),
    }),
  ],
);

export const updateTeamsAuthenticationSettingsSchema = z.discriminatedUnion(
  "mode",
  [
    inheritedAuthenticationSettingsSchema,
    disabledAuthenticationSettingsSchema,
    z.strictObject({
      mode: z.literal("managed"),
      expected_revision: expectedRevisionSchema,
      tenant_id: z.uuid(),
      client_id: z.uuid(),
    }),
  ],
);

const authenticationSettingsSummaryBase = {
  mode: authenticationManagementModeSchema,
  status: authenticationConfigurationStatusSchema,
  source: authenticationConfigurationSourceSchema,
  revision: z.number().int().nonnegative(),
};

export const smtpAuthenticationSettingsSummarySchema = z.strictObject({
  ...authenticationSettingsSummaryBase,
  host: z.string().nullable(),
  port: z.number().int().min(1).max(65_535).nullable(),
  security: smtpSecuritySchema.nullable(),
  username: z.string().nullable(),
  from: z.string().nullable(),
  password_configured: z.boolean(),
});

export const oidcAuthenticationSettingsSummarySchema = z.strictObject({
  ...authenticationSettingsSummaryBase,
  issuer_url: z.string().nullable(),
  client_id: z.string().nullable(),
  redirect_uri: z.string(),
  client_secret_configured: z.boolean(),
});

export const teamsAuthenticationSettingsSummarySchema = z.strictObject({
  ...authenticationSettingsSummaryBase,
  tenant_id: z.string().nullable(),
  client_id: z.string().nullable(),
});

export const authenticationSettingsSchema = z.strictObject({
  smtp: smtpAuthenticationSettingsSummarySchema,
  oidc: oidcAuthenticationSettingsSummarySchema,
  teams: teamsAuthenticationSettingsSummarySchema,
});

export const authenticationSettingsUpdateResultSchema = z.strictObject({
  code: z.literal("AUTHENTICATION_SETTINGS_UPDATED"),
  settings: authenticationSettingsSchema,
});

export type AuthenticationManagementMode = z.infer<
  typeof authenticationManagementModeSchema
>;
export type AuthenticationConfigurationStatus = z.infer<
  typeof authenticationConfigurationStatusSchema
>;
export type SmtpSecurity = z.infer<typeof smtpSecuritySchema>;
export type UpdateSmtpAuthenticationSettings = z.infer<
  typeof updateSmtpAuthenticationSettingsSchema
>;
export type UpdateOidcAuthenticationSettings = z.infer<
  typeof updateOidcAuthenticationSettingsSchema
>;
export type UpdateTeamsAuthenticationSettings = z.infer<
  typeof updateTeamsAuthenticationSettingsSchema
>;
export type AuthenticationSettings = z.infer<
  typeof authenticationSettingsSchema
>;
