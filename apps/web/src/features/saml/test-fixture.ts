import type { SamlSettings } from "@linksense/shared"

export const samlSettingsFixture: SamlSettings = {
  enabled: false,
  revision: 0,
  status: "not_configured",
  idp_entity_id: "",
  idp_sso_url: "",
  idp_certificate: "",
  email_attribute: "email",
  name_attribute: "displayName",
  sign_requests: false,
  signing_certificate: "",
  signing_private_key_configured: false,
  sp_entity_id: "https://linksense.example.test/api/v1/auth/saml/metadata",
  acs_url: "https://linksense.example.test/api/v1/auth/saml/acs",
  metadata_url: "https://linksense.example.test/api/v1/auth/saml/metadata",
}
