import * as oidc from "openid-client"
import { z } from "zod"

import type { LinkSenseRedis } from "../../adapters/redis.js"
import { sha256 } from "../../lib/crypto.js"
import {
  isAllowedOidcRedirectUri,
  type AuthenticationSettingsReader,
} from "../system/authentication-settings.js"
import type {
  AuthenticationIntegrationStatus,
  OidcFlow,
  VerifiedExternalIdentity,
} from "./types.js"

const oidcStateSchema = z.strictObject({
  codeVerifier: z.string().min(43).max(128),
  nonce: z.string().min(16).max(512),
  configurationRevision: z.number().int().nonnegative(),
})

export interface OidcStateStore {
  save(
    state: string,
    value: z.infer<typeof oidcStateSchema>,
    ttlSeconds: number,
  ): Promise<void>
  consume(state: string): Promise<z.infer<typeof oidcStateSchema> | null>
}

export class RedisOidcStateStore implements OidcStateStore {
  constructor(private readonly redis: Pick<LinkSenseRedis, "client">) {}

  async save(
    state: string,
    value: z.infer<typeof oidcStateSchema>,
    ttlSeconds: number,
  ): Promise<void> {
    const result = await this.redis.client.set(
      oidcStateKey(state),
      JSON.stringify(value),
      "EX",
      ttlSeconds,
      "NX",
    )
    if (result !== "OK") throw new Error("OIDC state collision")
  }

  async consume(state: string) {
    const result = await this.redis.client.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      oidcStateKey(state),
    )
    if (typeof result !== "string") return null
    const parsed = oidcStateSchema.safeParse(JSON.parse(result))
    return parsed.success ? parsed.data : null
  }
}

export type OidcDeployment = {
  issuerUrl?: string
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  revision?: number
}

export class OpenIdClientFlow implements OidcFlow {
  private readonly configurationStatus: AuthenticationIntegrationStatus
  private readonly issuerUrl: URL | null
  private configurationPromise: Promise<oidc.Configuration> | null = null

  constructor(
    private readonly deployment: OidcDeployment,
    private readonly states: OidcStateStore,
  ) {
    const fields = [
      deployment.issuerUrl,
      deployment.clientId,
      deployment.clientSecret,
      deployment.redirectUri,
    ]
    this.configurationStatus = fields.every(Boolean)
      ? "configured"
      : fields.some(Boolean)
        ? "invalid"
        : "not_configured"
    this.issuerUrl = deployment.issuerUrl ? new URL(deployment.issuerUrl) : null
    if (this.issuerUrl && this.issuerUrl.protocol !== "https:") {
      throw new Error("OIDC issuer must use HTTPS")
    }
    if (
      deployment.redirectUri &&
      !isAllowedOidcRedirectUri(deployment.redirectUri)
    ) {
      throw new Error("OIDC redirect URI must use HTTPS or loopback HTTP")
    }
  }

  async status(): Promise<AuthenticationIntegrationStatus> {
    return this.configurationStatus
  }

  async start(): Promise<{ authorizationUrl: string }> {
    const config = await this.configuration()
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    const codeVerifier = oidc.randomPKCECodeVerifier()
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
    await this.states.save(
      state,
      {
        codeVerifier,
        nonce,
        configurationRevision: this.deployment.revision ?? 0,
      },
      10 * 60,
    )
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.required("redirectUri"),
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    })
    return { authorizationUrl: authorizationUrl.toString() }
  }

  async complete(callbackUrl: URL): Promise<VerifiedExternalIdentity> {
    const state = callbackUrl.searchParams.get("state")
    if (!state) throw new Error("OIDC state missing")
    const stored = await this.states.consume(state)
    if (!stored) throw new Error("OIDC state invalid or expired")
    if (stored.configurationRevision !== (this.deployment.revision ?? 0)) {
      throw new Error("OIDC configuration changed")
    }

    const canonicalCallback = new URL(this.required("redirectUri"))
    canonicalCallback.search = callbackUrl.search
    const config = await this.configuration()
    const tokens = await oidc.authorizationCodeGrant(config, canonicalCallback, {
      expectedState: state,
      expectedNonce: stored.nonce,
      pkceCodeVerifier: stored.codeVerifier,
      idTokenExpected: true,
    })
    const claims = tokens.claims()
    if (!claims?.sub) throw new Error("OIDC subject missing")
    const directIdentity = extractOidcIdentity(claims)
    if (directIdentity) return directIdentity
    const userInfo = await oidc.fetchUserInfo(
      config,
      tokens.access_token,
      claims.sub,
    )
    const userInfoIdentity = extractOidcIdentity(userInfo)
    if (!userInfoIdentity) throw new Error("OIDC email missing")
    const fallbackName = extractOidcName(claims)
    return {
      ...userInfoIdentity,
      ...(userInfoIdentity.name || !fallbackName ? {} : { name: fallbackName }),
    }
  }

  private configuration(): Promise<oidc.Configuration> {
    if (this.configurationStatus !== "configured" || !this.issuerUrl) {
      throw new Error("OIDC not configured")
    }
    this.configurationPromise ??= oidc
      .discovery(
        this.issuerUrl,
        this.required("clientId"),
        {
          client_secret: this.required("clientSecret"),
          redirect_uris: [this.required("redirectUri")],
          response_types: ["code"],
        },
        oidc.ClientSecretPost(this.required("clientSecret")),
      )
      .then((configuration) => {
        configuration.timeout = 5
        return configuration
      })
    return this.configurationPromise
  }

  private required(
    key: "issuerUrl" | "clientId" | "clientSecret" | "redirectUri",
  ): string {
    const value = this.deployment[key]
    if (!value) throw new Error("OIDC not configured")
    return value
  }
}

type OpenIdFlowFactory = (
  deployment: OidcDeployment,
  states: OidcStateStore,
) => OidcFlow

type ConfigurableOpenIdClientFlowOptions = {
  securePublicUrl?: boolean
  createFlow?: OpenIdFlowFactory
}

export class ConfigurableOpenIdClientFlow implements OidcFlow {
  private cached: { key: string; flow: OidcFlow } | null = null
  private readonly securePublicUrl: boolean
  private readonly createFlow: OpenIdFlowFactory

  constructor(
    private readonly settings: Pick<AuthenticationSettingsReader, "resolveOidc">,
    private readonly states: OidcStateStore,
    options: ConfigurableOpenIdClientFlowOptions = {},
  ) {
    this.securePublicUrl = options.securePublicUrl ?? true
    this.createFlow =
      options.createFlow ??
      ((deployment, stateStore) =>
        new OpenIdClientFlow(deployment, stateStore))
  }

  async status(): Promise<AuthenticationIntegrationStatus> {
    if (!this.securePublicUrl) return "invalid"
    return (await this.settings.resolveOidc()).status
  }

  async start(): Promise<{ authorizationUrl: string }> {
    return (await this.flow()).start()
  }

  async complete(callbackUrl: URL): Promise<VerifiedExternalIdentity> {
    return (await this.flow()).complete(callbackUrl)
  }

  private async flow(): Promise<OidcFlow> {
    if (!this.securePublicUrl) {
      throw new Error("OIDC requires a secure public URL")
    }
    const resolved = await this.settings.resolveOidc()
    if (resolved.status !== "configured" || !resolved.configuration) {
      throw new Error("OIDC not configured")
    }
    const deployment: OidcDeployment = {
      issuerUrl: resolved.configuration.issuerUrl,
      clientId: resolved.configuration.clientId,
      clientSecret: resolved.configuration.clientSecret,
      redirectUri: resolved.configuration.redirectUri,
      revision: resolved.revision,
    }
    const key = sha256(JSON.stringify(deployment))
    if (this.cached?.key === key) return this.cached.flow
    const flow = this.createFlow(deployment, this.states)
    this.cached = { key, flow }
    return flow
  }
}

export function extractOidcIdentity(
  claims: Record<string, unknown>,
): VerifiedExternalIdentity | null {
  const email = extractEmail(claims)
  if (!email) return null
  const name = extractOidcName(claims)
  return { email, ...(name ? { name } : {}) }
}

function extractEmail(claims: Record<string, unknown>): string | null {
  for (const key of ["email", "preferred_username", "upn"]) {
    const parsed = z.string().trim().email().safeParse(claims[key])
    if (parsed.success) return parsed.data.toLocaleLowerCase("en-US")
  }
  return null
}

function extractOidcName(claims: Record<string, unknown>): string | null {
  const parsed = z.string().trim().min(1).max(120).safeParse(claims.name)
  return parsed.success ? parsed.data : null
}

function oidcStateKey(state: string): string {
  return `linksense:oidc:state:${state}`
}
