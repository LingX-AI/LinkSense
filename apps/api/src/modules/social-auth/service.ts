import {
  socialProviderSchema,
  type SocialProvider,
  type Locale,
} from "@linksense/shared"
import * as oidc from "openid-client"
import { z } from "zod"
import type { Mailer } from "../../adapters/mailer.js"
import { randomToken, sha256 } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import { translateBackend } from "../../lib/i18n.js"
import type { SessionMetadata } from "../auth/types.js"
import { socialIdentitySchema, type SocialProtocol } from "./protocol.js"
import {
  SocialFailure,
  type SocialActor,
  type SocialAuthentication,
  type SocialRepository,
} from "./repository.js"
import type { SocialSettingsReader } from "./settings.js"
import type { SocialStateStore } from "./state.js"

const actorSchema = z.strictObject({
  id: z.uuid(),
  authValidAfter: z.iso.datetime(),
})
const flowSchema = z.strictObject({
  provider: socialProviderSchema,
  revision: z.number().int(),
  browserHash: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  actor: actorSchema.nullable(),
})
const pendingSchema = z.strictObject({
  identity: socialIdentitySchema,
  revision: z.number().int(),
  browserHash: z.string(),
})
const emailProofSchema = z.strictObject({
  pending: z.string(),
  email: z.email(),
  browserHash: z.string(),
})
export type SocialCompletion =
  | {
      result: "success" | "linked"
      account: SocialAuthentication
      provider: SocialProvider
    }
  | { result: "verify_email"; pending: string }

export class SocialAuthService {
  constructor(
    private readonly options: {
      settings: SocialSettingsReader
      states: SocialStateStore
      protocol: SocialProtocol
      repository: SocialRepository
      mailer: Pick<Mailer, "sendRaw">
      publicBaseUrl: string
    },
  ) {}

  async start(
    provider: SocialProvider,
    browser: string,
    actor: SocialActor | null,
    ip: string,
  ): Promise<string> {
    if (!(await this.options.states.throttle(`start:${ip}`, 2)))
      throw new AppError("SOCIAL_AUTH_FAILED")
    const config = await this.options.settings.resolve(provider)
    if (!config?.enabled) throw new AppError("SOCIAL_AUTH_FAILED")
    const checks = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      verifier: oidc.randomPKCECodeVerifier(),
    }
    const url = await this.options.protocol.start(provider, config, checks)
    await this.options.states.put(
      `flow:${checks.state}`,
      {
        provider,
        revision: config.revision,
        browserHash: sha256(browser),
        nonce: checks.nonce,
        verifier: checks.verifier,
        actor,
      },
      900,
    )
    return url
  }

  async complete(
    provider: SocialProvider,
    params: Record<string, string>,
    browser: string,
    metadata: SessionMetadata,
  ): Promise<SocialCompletion> {
    const state = z.string().min(16).max(512).parse(params.state)
    const stored = await this.options.states.read(
      `flow:${state}`,
      flowSchema,
      true,
    )
    if (
      !stored ||
      stored.provider !== provider ||
      !browser ||
      stored.browserHash !== sha256(browser)
    )
      throw new SocialFailure("failed")
    const config = await this.options.settings.resolve(provider)
    if (!config?.enabled || config.revision !== stored.revision)
      throw new SocialFailure("configuration_changed")
    const identity = socialIdentitySchema.parse(
      await this.options.protocol.complete(provider, config, params, {
        state,
        nonce: stored.nonce,
        verifier: stored.verifier,
      }),
    )
    if (
      identity.provider !== provider ||
      identity.clientId !== config.client_id
    )
      throw new SocialFailure("failed")
    if (
      !stored.actor &&
      !(await this.options.repository.find(identity)) &&
      (!identity.email || !identity.emailVerified)
    ) {
      if (!(await this.options.repository.registrationEnabled()))
        throw new SocialFailure("registration_disabled")
      const pending = randomToken()
      await this.options.states.put(
        `pending:${pending}`,
        {
          identity,
          revision: stored.revision,
          browserHash: stored.browserHash,
        },
        900,
      )
      return { result: "verify_email", pending }
    }
    const account = await this.options.repository.authenticate(
      identity,
      stored.revision,
      stored.actor,
      metadata,
    )
    return { result: stored.actor ? "linked" : "success", account, provider }
  }

  async sendVerification(
    pending: string,
    browser: string,
    email: string,
    locale: Locale,
    ip: string,
  ): Promise<void> {
    const stored = await this.options.states.read(
      `pending:${pending}`,
      pendingSchema,
    )
    if (!stored || !browser || stored.browserHash !== sha256(browser))
      throw new AppError("SOCIAL_AUTH_FAILED")
    if (!(await this.options.repository.registrationEnabled()))
      throw new AppError("REGISTRATION_DISABLED")
    const limits = await Promise.all([
      this.options.states.throttle(`mail-pending:${pending}`, 60),
      this.options.states.throttle(`mail-address:${email}`, 60),
      this.options.states.throttle(`mail-ip:${ip}`, 60),
    ])
    if (limits.some((allowed) => !allowed))
      throw new AppError("SOCIAL_AUTH_FAILED")
    const token = randomToken()
    await this.options.states.put(
      `email:${token}`,
      { pending, email, browserHash: stored.browserHash },
      900,
    )
    const url = new URL("/auth/social/callback", this.options.publicBaseUrl)
    url.hash = new URLSearchParams({ token }).toString()
    const message = {
      subject: translateBackend("mail.socialVerification.subject", locale),
      text: translateBackend("mail.socialVerification.text", locale, {
        url: url.toString(),
      }),
    }
    try {
      await this.options.mailer.sendRaw({ to: email, ...message })
    } catch {
      await this.options.states.read(`email:${token}`, emailProofSchema, true)
      throw new AppError("REGISTRATION_EMAIL_UNAVAILABLE")
    }
  }

  async verifyEmail(
    token: string,
    pending: string,
    browser: string,
    metadata: SessionMetadata,
  ): Promise<SocialCompletion> {
    const proof = await this.options.states.read(
      `email:${token}`,
      emailProofSchema,
      true,
    )
    if (
      !proof ||
      proof.pending !== pending ||
      !browser ||
      proof.browserHash !== sha256(browser)
    )
      throw new SocialFailure("failed")
    const stored = await this.options.states.read(
      `pending:${pending}`,
      pendingSchema,
      true,
    )
    if (!stored || stored.browserHash !== proof.browserHash)
      throw new SocialFailure("failed")
    const identity = {
      ...stored.identity,
      email: proof.email,
      emailVerified: true,
    }
    const account = await this.options.repository.authenticate(
      identity,
      stored.revision,
      null,
      metadata,
    )
    return { result: "success", account, provider: identity.provider }
  }
}
