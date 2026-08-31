import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose"
import { z } from "zod"

import { sha256 } from "../../lib/crypto.js"
import type { AuthenticationSettingsReader } from "../system/authentication-settings.js"
import type {
  AuthenticationIntegrationStatus,
  TeamsTokenVerifier,
  VerifiedExternalIdentity,
} from "./types.js"

export type TeamsDeployment = {
  tenantId?: string
  clientId?: string
  applicationIdUri?: string
}

export class MicrosoftTeamsTokenVerifier implements TeamsTokenVerifier {
  private readonly configurationStatus: AuthenticationIntegrationStatus
  private readonly jwks: JWTVerifyGetKey | null

  constructor(
    private readonly deployment: TeamsDeployment,
    keySet?: JWTVerifyGetKey,
  ) {
    this.configurationStatus = deployment.tenantId && deployment.clientId
      ? "configured"
      : deployment.tenantId || deployment.clientId
        ? "invalid"
        : "not_configured"
    this.jwks = keySet ?? (deployment.tenantId
      ? createRemoteJWKSet(
          new URL(
            `https://login.microsoftonline.com/${encodeURIComponent(deployment.tenantId)}/discovery/v2.0/keys`,
          ),
          { timeoutDuration: 5_000, cooldownDuration: 30_000 },
        )
      : null)
  }

  async status(): Promise<AuthenticationIntegrationStatus> {
    return this.configurationStatus
  }

  async verify(token: string): Promise<VerifiedExternalIdentity> {
    const tenantId = this.deployment.tenantId
    const clientId = this.deployment.clientId
    if (
      this.configurationStatus !== "configured" ||
      !tenantId ||
      !clientId ||
      !this.jwks
    ) {
      throw new Error("Teams SSO not configured")
    }
    const issuers = [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ]
    const { payload } = await jwtVerify(token, this.jwks, {
      algorithms: ["RS256"],
      issuer: issuers,
      audience: this.deployment.applicationIdUri ?? clientId,
      clockTolerance: 5,
    })
    if (payload.tid !== tenantId) throw new Error("Teams tenant mismatch")
    const email = extractTeamsEmail(payload)
    if (!email) throw new Error("Teams email missing")
    return { email }
  }
}

type TeamsVerifierFactory = (deployment: TeamsDeployment) => TeamsTokenVerifier

type ConfigurableMicrosoftTeamsTokenVerifierOptions = {
  securePublicUrl?: boolean
  createVerifier?: TeamsVerifierFactory
}

export class ConfigurableMicrosoftTeamsTokenVerifier
  implements TeamsTokenVerifier
{
  private cached: { key: string; verifier: TeamsTokenVerifier } | null = null
  private readonly securePublicUrl: boolean
  private readonly createVerifier: TeamsVerifierFactory

  constructor(
    private readonly settings: Pick<AuthenticationSettingsReader, "resolveTeams">,
    private readonly publicBaseUrl?: string,
    options: ConfigurableMicrosoftTeamsTokenVerifierOptions = {},
  ) {
    this.securePublicUrl = options.securePublicUrl ?? true
    this.createVerifier =
      options.createVerifier ??
      ((deployment) => new MicrosoftTeamsTokenVerifier(deployment))
  }

  async status(): Promise<AuthenticationIntegrationStatus> {
    if (!this.securePublicUrl) return "invalid"
    return (await this.settings.resolveTeams()).status
  }

  async verify(token: string): Promise<VerifiedExternalIdentity> {
    return (await this.verifier()).verify(token)
  }

  private async verifier(): Promise<TeamsTokenVerifier> {
    if (!this.securePublicUrl) {
      throw new Error("Teams SSO requires a secure public URL")
    }
    const resolved = await this.settings.resolveTeams()
    if (resolved.status !== "configured" || !resolved.configuration) {
      throw new Error("Teams SSO not configured")
    }
    const deployment: TeamsDeployment = {
      tenantId: resolved.configuration.tenantId,
      clientId: resolved.configuration.clientId,
      ...(this.publicBaseUrl
        ? {
            applicationIdUri: teamsApplicationIdUri(
              this.publicBaseUrl,
              resolved.configuration.clientId,
            ),
          }
        : {}),
    }
    const key = sha256(`${resolved.revision}:${JSON.stringify(deployment)}`)
    if (this.cached?.key === key) return this.cached.verifier
    const verifier = this.createVerifier(deployment)
    this.cached = { key, verifier }
    return verifier
  }
}

function extractTeamsEmail(claims: Record<string, unknown>): string | null {
  for (const key of ["preferred_username", "email", "upn"]) {
    const parsed = z.string().trim().email().safeParse(claims[key])
    if (parsed.success) return parsed.data.toLocaleLowerCase("en-US")
  }
  return null
}

function teamsApplicationIdUri(publicBaseUrl: string, clientId: string): string {
  const host = new URL(publicBaseUrl).host.toLowerCase()
  return `api://${host}/${clientId}`
}
