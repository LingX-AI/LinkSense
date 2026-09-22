import { describe, expect, it } from "vitest";
import { samlResponseSchema, updateSamlSettingsSchema } from "./saml.js";
import { loginMethodSchema } from "./users.js";
const input = {
  enabled: true,
  expected_revision: 0,
  idp_entity_id: "idp",
  idp_sso_url: "https://idp.example.test/sso",
  idp_certificate: "test-certificate",
  email_attribute: "email",
  name_attribute: "",
  sign_requests: false,
  signing_certificate: "",
};
describe("SAML contracts", () => {
  it("accepts all existing login methods and adds saml", () => {
    for (const method of [
      "password",
      "oidc",
      "teams",
      "google",
      "apple",
      "microsoft",
      "facebook",
      "saml",
    ]) {
      expect(loginMethodSchema.parse(method)).toBe(method);
    }
  });
  it("requires safe HTTPS endpoints and rejects unexpected fields", () => {
    expect(updateSamlSettingsSchema.safeParse(input).success).toBe(true);
    for (const idp_sso_url of [
      "http://idp.example.test",
      "javascript:alert(1)",
      "https://user:secret@idp.example.test",
      "https://idp.example.test/#fragment",
    ])
      expect(
        updateSamlSettingsSchema.safeParse({ ...input, idp_sso_url }).success,
      ).toBe(false);
    expect(
      updateSamlSettingsSchema.safeParse({ ...input, role: "admin" }).success,
    ).toBe(false);
  });
  it("bounds callback input and rejects redirects supplied as relay state", () => {
    expect(
      samlResponseSchema.safeParse({
        SAMLResponse: "dGVzdA==",
        RelayState: "a".repeat(43),
      }).success,
    ).toBe(true);
    expect(
      samlResponseSchema.safeParse({
        SAMLResponse: "dGVzdA==",
        RelayState: "https://attacker.example",
      }).success,
    ).toBe(false);
    expect(
      samlResponseSchema.safeParse({
        SAMLResponse: "a".repeat(350001),
        RelayState: "a".repeat(43),
      }).success,
    ).toBe(false);
  });
  it("returns validation errors for empty and malformed URLs without throwing from safeParse", () => {
    for (const idp_sso_url of ["", "not-a-url", "https://", "\n"]) {
      expect(
        updateSamlSettingsSchema.safeParse({ ...input, idp_sso_url }).success,
      ).toBe(false);
    }
  });
});
