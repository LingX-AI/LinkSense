import {
  SAML,
  ValidateInResponseTo,
  type CacheProvider,
} from "@node-saml/node-saml";
import {
  samlResponseSchema,
  emailSchema,
  type SamlResponse,
} from "@linksense/shared";
import { SaxesParser } from "saxes";
import { z } from "zod";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { VerifiedExternalIdentity } from "../auth/types.js";
import {
  validateSamlCertificates,
  type SamlConfiguration,
  type SamlSettingsReader,
} from "./settings.js";
import type { SamlStateStore } from "./state.js";

const TTL = 300;
const flowSchema = z.strictObject({
  revision: z.number().int(),
  browserHash: z.string(),
  requestId: z.string(),
});
const assertionSchema = z.object({
  Assertion: z.object({
    $: z.object({ IssueInstant: z.iso.datetime(), Version: z.literal("2.0") }),
    Issuer: z.array(z.object({ _: z.string() })).length(1),
    Subject: z
      .array(
        z.object({
          NameID: z
            .array(z.object({ _: z.string().min(1).max(2048) }))
            .length(1),
          SubjectConfirmation: z
            .array(
              z.object({
                $: z.object({
                  Method: z.literal("urn:oasis:names:tc:SAML:2.0:cm:bearer"),
                }),
                SubjectConfirmationData: z
                  .array(
                    z.object({
                      $: z.object({
                        Recipient: z.string(),
                        InResponseTo: z.string(),
                        NotOnOrAfter: z.iso.datetime(),
                      }),
                    }),
                  )
                  .length(1),
              }),
            )
            .length(1),
        }),
      )
      .length(1),
    Conditions: z
      .array(z.object({ $: z.object({ NotOnOrAfter: z.iso.datetime() }) }))
      .length(1),
    AuthnStatement: z
      .array(z.object({ $: z.object({ AuthnInstant: z.iso.datetime() }) }))
      .length(1),
  }),
});

export class SamlProtocol {
  constructor(
    private readonly settings: SamlSettingsReader,
    private readonly states: SamlStateStore,
  ) {}

  async available(): Promise<boolean> {
    try {
      await this.configuration();
      return true;
    } catch {
      return false;
    }
  }

  async start(browser: string, ip: string): Promise<string> {
    if (!(await this.states.throttle(ip)))
      throw new AppError("AUTH_LOGIN_RATE_LIMITED");
    const config = await this.configuration();
    const relay = randomToken(32);
    const requestId = `_${randomToken(32)}`;
    await this.states.put(
      `flow:${relay}`,
      JSON.stringify({
        revision: config.revision,
        browserHash: sha256(browser),
        requestId,
      }),
      TTL,
    );
    return this.client(config, relay, requestId).getAuthorizeUrlAsync(
      relay,
      undefined,
      {},
    );
  }

  async complete(
    raw: SamlResponse,
    browser: string,
  ): Promise<VerifiedExternalIdentity> {
    try {
      const input = samlResponseSchema.parse(raw);
      const serialized = await this.states.get(
        `flow:${input.RelayState}`,
        true,
      );
      if (!serialized) throw new Error("Expired flow");
      const flow = flowSchema.parse(JSON.parse(serialized));
      if (flow.browserHash !== sha256(browser))
        throw new Error("Wrong browser");
      const config = await this.configuration();
      if (config.revision !== flow.revision)
        throw new Error("Configuration changed");
      const { acsUrl } = this.settings.urls();
      validateResponseEnvelope(input.SAMLResponse, acsUrl);
      const { profile, loggedOut } = await this.client(
        config,
        input.RelayState,
        flow.requestId,
      ).validatePostResponseAsync(input);
      if (!profile || loggedOut) throw new Error("Missing identity");
      // Read only the assertion returned after Node-SAML signature verification.
      // Node-SAML validates audience and timestamps but does not enforce Recipient.
      const { Assertion: assertion } = assertionSchema.parse(
        profile.getAssertion?.(),
      );
      const subject = assertion.Subject[0];
      const confirmation =
        subject?.SubjectConfirmation[0]?.SubjectConfirmationData[0]?.$;
      if (
        assertion.Issuer[0]?._ !== config.idp_entity_id ||
        confirmation?.Recipient !== acsUrl ||
        confirmation.InResponseTo !== flow.requestId
      )
        throw new Error("Assertion target mismatch");
      const attributes = z
        .record(z.string(), z.unknown())
        .parse(profile.attributes ?? {});
      const email = emailSchema.parse(
        config.email_attribute === "NameID"
          ? subject?.NameID[0]?._
          : attributes[config.email_attribute],
      );
      const name = config.name_attribute
        ? z
            .string()
            .trim()
            .min(1)
            .max(200)
            .optional()
            .parse(attributes[config.name_attribute])
        : undefined;
      return { email, ...(name ? { name } : {}) };
    } catch {
      throw new AppError("AUTH_INVALID_CREDENTIALS");
    }
  }

  async metadata(): Promise<string> {
    const config = await this.configuration();
    return this.client(
      config,
      "metadata",
      "metadata",
    ).generateServiceProviderMetadata(
      null,
      config.sign_requests ? config.signing_certificate : null,
    );
  }

  private async configuration(): Promise<SamlConfiguration> {
    const config = await this.settings.resolve();
    if (
      !config?.enabled ||
      new URL(this.settings.urls().acsUrl).protocol !== "https:"
    )
      throw new AppError("AUTH_INVALID_CREDENTIALS", undefined, 503);
    validateSamlCertificates(config);
    return config;
  }

  private client(
    config: SamlConfiguration,
    relay: string,
    requestId: string,
  ): SAML {
    const key = (id: string): string =>
      `request:${relay}:${config.revision}:${id}`;
    const cacheProvider: CacheProvider = {
      saveAsync: async (id, value) => {
        await this.states.put(key(id), value, TTL);
        return { value, createdAt: Date.now() };
      },
      getAsync: (id) => this.states.get(key(id)),
      removeAsync: (id) =>
        id ? this.states.get(key(id), true) : Promise.resolve(null),
    };
    const urls = this.settings.urls();
    return new SAML({
      callbackUrl: urls.acsUrl,
      issuer: urls.entityId,
      audience: urls.entityId,
      entryPoint: config.idp_sso_url,
      idpIssuer: config.idp_entity_id,
      idpCert: config.idp_certificate,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
      acceptedClockSkewMs: 30_000,
      maxAssertionAgeMs: TTL * 1000,
      requestIdExpirationPeriodMs: TTL * 1000,
      cacheProvider,
      generateUniqueId: () => requestId,
      identifierFormat: null,
      disableRequestedAuthnContext: true,
      signatureAlgorithm: "sha256",
      digestAlgorithm: "sha256",
      ...(config.sign_requests
        ? {
            privateKey: config.signing_private_key,
            publicCert: config.signing_certificate,
          }
        : {}),
    });
  }
}

function validateResponseEnvelope(encoded: string, acsUrl: string): void {
  const xml = Buffer.from(encoded, "base64").toString("utf8");
  if (Buffer.byteLength(xml) > 262_144) throw new Error("Response too large");
  const parser = new SaxesParser({ xmlns: true });
  const path: string[] = [];
  const namespace = "urn:oasis:names:tc:SAML:2.0:protocol";
  let statuses = 0;
  let statusCodes = 0;
  parser.on("doctype", () => {
    throw new Error("DTD is forbidden");
  });
  parser.on("opentag", (tag) => {
    path.push(`${tag.uri}:${tag.local}`);
    if (
      path.length === 1 &&
      (tag.local !== "Response" ||
        tag.uri !== namespace ||
        tag.attributes.Destination?.value !== acsUrl ||
        tag.attributes.Version?.value !== "2.0")
    )
      throw new Error("Invalid response envelope");
    if (path.length === 2 && tag.uri === namespace && tag.local === "Status")
      statuses += 1;
    if (
      path.length === 3 &&
      path[1] === `${namespace}:Status` &&
      tag.uri === namespace &&
      tag.local === "StatusCode"
    ) {
      statusCodes += 1;
      if (
        tag.attributes.Value?.value !==
        "urn:oasis:names:tc:SAML:2.0:status:Success"
      )
        throw new Error("Unsuccessful response");
    }
  });
  parser.on("closetag", () => {
    path.pop();
  });
  parser.write(xml).close();
  if (statuses !== 1 || statusCodes !== 1)
    throw new Error("Missing or ambiguous response status");
}
