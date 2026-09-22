import { z } from "zod";

const httpsUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" && !url.username && !url.password && !url.hash
      );
    } catch {
      return false;
    }
  });
const certificate = z.string().trim().min(1).max(16_384);
const fields = {
  enabled: z.boolean(),
  idp_entity_id: z.string().trim().min(1).max(2048),
  idp_sso_url: httpsUrl,
  idp_certificate: certificate,
  email_attribute: z.string().trim().min(1).max(512),
  name_attribute: z.string().trim().max(512),
  sign_requests: z.boolean(),
  signing_certificate: z.string().trim().max(16_384),
};
export const samlConfigurationFieldsSchema = z.strictObject(fields);
export const updateSamlSettingsSchema = z.strictObject({
  ...fields,
  expected_revision: z.number().int().nonnegative(),
  signing_private_key: z.string().trim().min(1).max(16_384).optional(),
});
export const samlSettingsSchema = z.strictObject({
  ...fields,
  idp_entity_id: z.string(),
  idp_sso_url: z.string(),
  idp_certificate: z.string(),
  revision: z.number().int().nonnegative(),
  status: z.enum(["configured", "not_configured", "invalid"]),
  signing_private_key_configured: z.boolean(),
  sp_entity_id: z.url(),
  acs_url: z.url(),
  metadata_url: z.url(),
});
export const samlAvailabilitySchema = z.strictObject({ enabled: z.boolean() });
export const samlStartResultSchema = z.strictObject({
  authorization_url: httpsUrl,
});
export const samlResponseSchema = z.strictObject({
  SAMLResponse: z
    .string()
    .min(1)
    .max(350_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  RelayState: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});
export type SamlSettings = z.infer<typeof samlSettingsSchema>;
export type UpdateSamlSettings = z.infer<typeof updateSamlSettingsSchema>;
export type SamlResponse = z.infer<typeof samlResponseSchema>;
