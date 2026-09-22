import { createHmac } from "node:crypto"
import * as oidc from "openid-client"
import { importPKCS8, SignJWT } from "jose"
import { z } from "zod"
import { socialProviderSchema, type SocialProvider } from "@linksense/shared"
import type { SocialConfiguration, SocialSettingsReader } from "./settings.js"

export const socialIdentitySchema = z.strictObject({
  provider: socialProviderSchema,
  clientId: z.string().min(1).max(512),
  subject: z.string().min(1).max(255),
  email: z.email().max(320).nullable(),
  emailVerified: z.boolean(),
  name: z.string().max(120),
})
export type SocialIdentity = z.infer<typeof socialIdentitySchema>
export type ProtocolChecks = { state: string; nonce: string; verifier: string }
export interface SocialProtocol {
  start(
    provider: SocialProvider,
    config: SocialConfiguration,
    checks: ProtocolChecks,
  ): Promise<string>
  complete(
    provider: SocialProvider,
    config: SocialConfiguration,
    parameters: Record<string, string>,
    checks: ProtocolChecks,
  ): Promise<SocialIdentity>
}

const microsoftIssuer =
  "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0"
const issuers = {
  google: "https://accounts.google.com",
  apple: "https://appleid.apple.com",
  microsoft: microsoftIssuer,
} as const

export class OpenIdSocialProtocol implements SocialProtocol {
  constructor(
    private readonly settings: Pick<SocialSettingsReader, "redirectUri">,
  ) {}

  private async configuration(
    provider: SocialProvider,
    settings: SocialConfiguration,
  ): Promise<oidc.Configuration> {
    if (provider === "facebook") {
      const version = z
        .string()
        .regex(/^v\d{2,3}\.0$/u)
        .parse(settings.graph_api_version)
      const config = new oidc.Configuration(
        {
          issuer: "https://www.facebook.com",
          authorization_endpoint: `https://www.facebook.com/${version}/dialog/oauth`,
          token_endpoint: `https://graph.facebook.com/${version}/oauth/access_token`,
        },
        settings.client_id,
        settings.client_secret,
        oidc.ClientSecretPost(settings.client_secret),
      )
      config.timeout = 5
      return config
    }
    const secret =
      provider === "apple"
        ? await appleClientSecret(settings)
        : settings.client_secret
    return oidc.discovery(
      new URL(issuers[provider]),
      settings.client_id,
      secret,
      oidc.ClientSecretPost(secret),
      {
        timeout: 5,
        execute: [oidc.enableNonRepudiationChecks],
      },
    )
  }

  async start(
    provider: SocialProvider,
    settings: SocialConfiguration,
    checks: ProtocolChecks,
  ): Promise<string> {
    const config = await this.configuration(provider, settings)
    return oidc
      .buildAuthorizationUrl(config, {
        response_type: "code",
        redirect_uri: this.settings.redirectUri(provider),
        state: checks.state,
        scope:
          provider === "facebook"
            ? "email,public_profile"
            : provider === "apple"
              ? "name email"
              : "openid email profile",
        ...(provider !== "facebook" ? { nonce: checks.nonce } : {}),
        ...(provider === "apple" ? { response_mode: "form_post" } : {}),
        ...(provider === "google" || provider === "microsoft"
          ? {
              code_challenge: await oidc.calculatePKCECodeChallenge(
                checks.verifier,
              ),
              code_challenge_method: "S256",
            }
          : {}),
      })
      .toString()
  }

  async complete(
    provider: SocialProvider,
    settings: SocialConfiguration,
    parameters: Record<string, string>,
    checks: ProtocolChecks,
  ): Promise<SocialIdentity> {
    const config = await this.configuration(provider, settings)
    const url = new URL(this.settings.redirectUri(provider))
    const params = new URLSearchParams(parameters)
    let callback: URL | Request
    if (provider === "apple") {
      callback = new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params,
      })
    } else {
      url.search = params.toString()
      callback = url
    }
    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      expectedState: checks.state,
      ...(provider !== "facebook"
        ? { expectedNonce: checks.nonce, idTokenExpected: true }
        : {}),
      ...(provider === "google" || provider === "microsoft"
        ? { pkceCodeVerifier: checks.verifier }
        : {}),
    })
    if (provider === "facebook") {
      const profileUrl = new URL(
        `https://graph.facebook.com/${settings.graph_api_version}/me`,
      )
      profileUrl.searchParams.set("fields", "id,name,email")
      profileUrl.searchParams.set(
        "appsecret_proof",
        createHmac("sha256", settings.client_secret)
          .update(tokens.access_token)
          .digest("hex"),
      )
      const response = await fetch(profileUrl, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      })
      if (!response.ok) throw new Error("social profile unavailable")
      const profile = z
        .object({
          id: z.string().min(1),
          name: z.string().optional(),
          email: z.string().optional(),
        })
        .parse(await response.json())
      return socialIdentitySchema.parse({
        provider,
        clientId: settings.client_id,
        subject: profile.id,
        email: validEmail(profile.email),
        emailVerified: false,
        name: (profile.name ?? "").slice(0, 120),
      })
    }
    return identityFromClaims(provider, settings.client_id, tokens.claims())
  }
}

export function identityFromClaims(
  provider: Exclude<SocialProvider, "facebook">,
  clientId: string,
  value: unknown,
): SocialIdentity {
  const claims = z
    .object({
      sub: z.string().min(1).max(255),
      email: z.string().optional(),
      email_verified: z.union([z.boolean(), z.string()]).optional(),
      name: z.string().optional(),
    })
    .parse(value)
  return socialIdentitySchema.parse({
    provider,
    clientId,
    subject: claims.sub,
    email: validEmail(claims.email),
    // Microsoft does not assert mailbox ownership; never use preferred_username
    // or an email claim to merge accounts or bypass email verification.
    emailVerified:
      provider !== "microsoft" &&
      (claims.email_verified === true || claims.email_verified === "true"),
    name: (claims.name ?? "").slice(0, 120),
  })
}

function validEmail(value: unknown): string | null {
  const result = z.email().max(320).safeParse(value)
  return result.success ? result.data.toLowerCase() : null
}

export async function appleClientSecret(
  settings: SocialConfiguration,
): Promise<string> {
  const teamId = z
    .string()
    .regex(/^[A-Z0-9]{10}$/u)
    .parse(settings.team_id)
  const keyId = z
    .string()
    .regex(/^[A-Z0-9]{10}$/u)
    .parse(settings.key_id)
  const key = await importPKCS8(settings.client_secret, "ES256")
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(settings.client_id)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key)
}
