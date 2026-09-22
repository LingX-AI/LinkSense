import { generate } from "selfsigned";
import { SignedXml } from "xml-crypto";
import { inflateRawSync } from "node:zlib";
import type { SamlConfiguration } from "../src/modules/saml/settings.js";
import type { SamlStateStore } from "../src/modules/saml/state.js";

export const SAML_NOW = new Date("2026-09-22T08:00:00Z");
export const samlUrls = {
  entityId: "https://linksense.example.test/api/v1/auth/saml/metadata",
  metadataUrl: "https://linksense.example.test/api/v1/auth/saml/metadata",
  acsUrl: "https://linksense.example.test/api/v1/auth/saml/acs",
};
export async function samlCertificate() {
  return generate(
    [{ name: "commonName", value: "saml-test-only.example.test" }],
    {
      keySize: 2048,
      algorithm: "sha256",
      notBeforeDate: new Date("2026-01-01T00:00:00Z"),
      notAfterDate: new Date("2027-01-01T00:00:00Z"),
    },
  );
}
export function samlConfiguration(cert: string): SamlConfiguration {
  return {
    enabled: true,
    revision: 1,
    idp_entity_id: "https://idp.example.test/entity",
    idp_sso_url: "https://idp.example.test/sso",
    idp_certificate: cert,
    email_attribute: "email",
    name_attribute: "displayName",
    sign_requests: false,
    signing_certificate: "",
    signing_private_key: "",
  };
}
export function memorySamlStates(): SamlStateStore & {
  values: Map<string, { value: string; expires: number }>;
} {
  const values = new Map<string, { value: string; expires: number }>();
  return {
    values,
    async put(key, value, ttl) {
      if (values.has(key)) throw new Error("Collision");
      values.set(key, { value, expires: Date.now() + ttl * 1000 });
    },
    async get(key, consume = false) {
      const v = values.get(key);
      if (consume) values.delete(key);
      return v && v.expires > Date.now() ? v.value : null;
    },
    async throttle() {
      return true;
    },
  };
}
export function requestDetails(url: string) {
  const parsed = new URL(url);
  const xml = inflateRawSync(
    Buffer.from(parsed.searchParams.get("SAMLRequest") ?? "", "base64"),
  ).toString();
  const id = /\bID="([^"]+)"/u.exec(xml)?.[1];
  if (!id) throw new Error("Missing request ID");
  return { id, relay: parsed.searchParams.get("RelayState") ?? "", xml };
}
export function signedResponse(
  id: string,
  privateKey: string,
  overrides: Partial<{
    issuer: string;
    audience: string;
    recipient: string;
    destination: string;
    requestId: string;
    expires: string;
    notBefore: string;
    issued: string;
    email: string;
    unsigned: boolean;
    nameId: string;
    missingAuthnStatement: boolean;
    missingExpiry: boolean;
  }> = {},
): string {
  const v = {
    issuer: "https://idp.example.test/entity",
    audience: samlUrls.entityId,
    recipient: samlUrls.acsUrl,
    destination: samlUrls.acsUrl,
    requestId: id,
    expires: "2026-09-22T08:04:00Z",
    notBefore: "2026-09-22T07:59:30Z",
    issued: SAML_NOW.toISOString(),
    email: "MEMBER@example.test",
    nameId: "member-stable-id",
    unsigned: false,
    missingAuthnStatement: false,
    missingExpiry: false,
    ...overrides,
  };
  let xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response" Version="2.0" IssueInstant="${v.issued}" Destination="${v.destination}" InResponseTo="${id}"><saml:Issuer>${v.issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_assertion" Version="2.0" IssueInstant="${v.issued}"><saml:Issuer>${v.issuer}</saml:Issuer><saml:Subject><saml:NameID>${v.nameId}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${v.requestId}" Recipient="${v.recipient}" NotOnOrAfter="${v.expires}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${v.notBefore}" NotOnOrAfter="${v.expires}"><saml:AudienceRestriction><saml:Audience>${v.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${v.issued}" SessionIndex="_session"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${v.email}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="displayName"><saml:AttributeValue>Member</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
  if (v.missingAuthnStatement)
    xml = xml.replace(/<saml:AuthnStatement.*?<\/saml:AuthnStatement>/u, "");
  if (v.missingExpiry) xml = xml.replaceAll(/ NotOnOrAfter="[^"]*"/gu, "");
  if (v.unsigned) return Buffer.from(xml).toString("base64");
  const signer = new SignedXml({
    privateKey,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: "//*[local-name()='Assertion']",
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });
  signer.computeSignature(xml, {
    location: {
      reference: "//*[local-name()='Assertion']/*[local-name()='Issuer']",
      action: "after",
    },
  });
  return Buffer.from(signer.getSignedXml()).toString("base64");
}
