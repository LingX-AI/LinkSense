import { randomUUID, timingSafeEqual } from "node:crypto"

import {
  emailSchema,
  initializeSystemInputSchema,
  passwordSchema,
  type Locale,
  userNameSchema,
} from "@linksense/shared"

import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_SESSION_TTL_SECONDS,
  type AppConfig,
} from "../../config.js"
import { randomToken, sha256 } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import {
  renderPasswordResetEmail,
  renderRegistrationEmail,
} from "../../lib/password-reset-email.js"
import {
  getDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from "../../lib/password.js"
import type { AuditContext } from "../audit/service.js"
import type {
  AccessTokenIssuer,
  AuditWriter,
  AuthPersistence,
  AuthRateLimiter,
  AuthUserRecord,
  AuthenticatedUser,
  LoginMethod,
  OidcFlow,
  PasswordHasher,
  PasswordMailGateway,
  SessionMetadata,
  TeamsTokenVerifier,
  VerifiedExternalIdentity,
} from "./types.js"

const MILLISECONDS_PER_SECOND = 1_000
export const PASSWORD_RESET_MINIMUM_RESPONSE_MS = 100

type PasswordResetDeliveryFailureReason =
  | "PASSWORD_RESET_LINK_CONFIGURATION_INVALID"
  | "PASSWORD_RESET_TOKEN_PERSISTENCE_FAILED"
  | "PASSWORD_RESET_MAIL_ENQUEUE_FAILED"

type RegistrationDeliveryFailureReason =
  | "REGISTRATION_LINK_CONFIGURATION_INVALID"
  | "REGISTRATION_TOKEN_PERSISTENCE_FAILED"
  | "REGISTRATION_MAIL_ENQUEUE_FAILED"

type ResponseClock = {
  now(): number
  wait(milliseconds: number): Promise<void>
}

export class LoginRateLimitedError extends AppError {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super("AUTH_LOGIN_RATE_LIMITED")
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds))
  }
}

export type AuthServiceOptions = {
  persistence: AuthPersistence
  rateLimiter: AuthRateLimiter
  accessTokens: AccessTokenIssuer
  mail: PasswordMailGateway
  readProductName: () => Promise<string>
  config: Pick<
    AppConfig,
    | "nodeEnv"
    | "publicBaseUrl"
    | "passwordReset"
    | "invalidAuthTokenRetentionDays"
  > & {
    initializationToken?: string | undefined
    oidc: { status: "configured" | "invalid" | "not_configured" }
    teams: { status: "configured" | "invalid" | "not_configured" }
    smtp: { status: "configured" | "invalid" | "not_configured" }
  }
  oidc?: OidcFlow
  teams?: TeamsTokenVerifier
  audit: AuditWriter
  passwordHasher?: PasswordHasher
  now?: () => Date
  createId?: () => string
  createOpaqueToken?: () => string
  passwordResetResponseClock?: ResponseClock
}

export type AuthSession = {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: Date
  refreshSessionExpiresAt: Date
  user: AuthenticatedUser
}

export class AuthService {
  private readonly passwordHasher: PasswordHasher
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly createOpaqueToken: () => string
  private readonly passwordResetResponseClock: ResponseClock
  private readonly preparedDummyHash: Promise<string>

  constructor(private readonly options: AuthServiceOptions) {
    this.passwordHasher = options.passwordHasher ?? {
      hash: hashPassword,
      verify: verifyPassword,
      dummyHash: getDummyPasswordHash,
    }
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
    this.createOpaqueToken = options.createOpaqueToken ?? (() => randomToken(48))
    this.passwordResetResponseClock =
      options.passwordResetResponseClock ?? defaultResponseClock
    this.preparedDummyHash = this.passwordHasher.dummyHash()
  }

  async prepare(): Promise<void> {
    await this.preparedDummyHash
  }

  async bootstrap() {
    const [state, registration, smtpStatus, oidcStatus, teamsStatus] =
      await Promise.all([
      this.options.persistence.getBootstrapState(),
      this.options.persistence.getRegistrationState(),
      this.readSmtpStatus(),
      readIntegrationStatus(this.options.oidc, this.options.config.oidc.status),
      readIntegrationStatus(this.options.teams, this.options.config.teams.status),
    ])
    const oidc = { status: oidcStatus }
    const teamsSso = { status: teamsStatus }
    const passwordEmail = { status: smtpStatus }
    return {
      initialized: state.initialized,
      initialization_credential_required:
        !state.initialized && this.options.config.initializationToken !== undefined,
      oidc,
      teams_sso: teamsSso,
      password_email: passwordEmail,
      registration,
      authentication: {
        local_password: { status: "available" as const },
        password_email: passwordEmail,
        oidc,
        teams: teamsSso,
      },
    }
  }

  async initialize(
    rawInput: unknown,
    audit: AuditContext = {},
  ): Promise<{ user: AuthenticatedUser }> {
    const parsed = initializeSystemInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      if (containsPasswordPolicyIssue(parsed.error.issues)) {
        throw new AppError("PASSWORD_POLICY_VIOLATION")
      }
      throw new AppError("VALIDATION_ERROR")
    }
    const state = await this.options.persistence.getBootstrapState()
    if (state.initialized) {
      throw new AppError("SYSTEM_ALREADY_INITIALIZED")
    }
    const expectedCredential = this.options.config.initializationToken
    if (
      expectedCredential !== undefined &&
      !credentialsMatch(
        parsed.data.initialization_credential,
        expectedCredential,
      )
    ) {
      throw new AppError("SYSTEM_INITIALIZATION_CREDENTIAL_INVALID")
    }
    const now = jwtBoundary(this.now())
    const passwordHash = await this.passwordHasher.hash(parsed.data.password)
    const result = await this.options.persistence.initializeAdmin({
      id: this.createId(),
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash,
      now,
      audit,
    })
    if (result.status === "already_initialized") {
      throw new AppError("SYSTEM_ALREADY_INITIALIZED")
    }
    return { user: sanitizeUser(result.user) }
  }

  async login(
    emailInput: string,
    candidatePassword: string,
    metadata: SessionMetadata,
  ): Promise<AuthSession> {
    const email = emailSchema.parse(emailInput)
    let keys
    let cooldown: number
    try {
      keys = this.options.rateLimiter.loginKeys(email, metadata.ipAddress ?? "invalid")
      cooldown = await this.options.rateLimiter.precheckLogin(keys)
    } catch {
      throw new AppError("AUTH_LOGIN_PROTECTION_UNAVAILABLE")
    }
    if (cooldown > 0) throw new LoginRateLimitedError(cooldown)

    const user = await this.options.persistence.findUserByEmail(email)
    const hasRealHash = user?.status === "active" && user.passwordHash !== null
    const hash = hasRealHash && user?.passwordHash
      ? user.passwordHash
      : await this.preparedDummyHash
    const passwordMatches = await this.passwordHasher.verify(hash, candidatePassword)
    const accepted = hasRealHash && passwordMatches

    if (!accepted) {
      let retryAfter: number
      try {
        retryAfter = await this.options.rateLimiter.recordLoginFailure(keys)
      } catch {
        throw new AppError("AUTH_LOGIN_PROTECTION_UNAVAILABLE")
      }
      if (retryAfter > 0) throw new LoginRateLimitedError(retryAfter)
      throw new AppError("AUTH_INVALID_CREDENTIALS")
    }

    try {
      await this.options.rateLimiter.clearEmailLoginState(keys)
    } catch {
      throw new AppError("AUTH_LOGIN_PROTECTION_UNAVAILABLE")
    }
    return this.createSession(user, "password", metadata)
  }

  async refresh(
    refreshToken: string,
    metadata: SessionMetadata,
  ): Promise<AuthSession> {
    if (refreshToken.length < 32 || refreshToken.length > 16_384) {
      throw new AppError("AUTH_SESSION_EXPIRED")
    }
    const replacement = this.createOpaqueToken()
    const result = await this.options.persistence.rotateRefreshSession({
      id: this.createId(),
      tokenHash: sha256(refreshToken),
      replacementTokenHash: sha256(replacement),
      now: this.now(),
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    })
    if (result.status !== "rotated") {
      throw new AppError("AUTH_SESSION_EXPIRED")
    }
    const access = await this.options.accessTokens.issue(accessPayload(result.user))
    return {
      accessToken: access.token,
      refreshToken: replacement,
      accessTokenExpiresAt: access.expiresAt,
      refreshSessionExpiresAt: result.expiresAt,
      user: sanitizeUser(result.user),
    }
  }

  async logout(refreshToken: string | null | undefined): Promise<void> {
    if (!refreshToken) return
    await this.options.persistence.revokeRefreshSession(
      sha256(refreshToken),
      this.now(),
    )
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    audit: AuditContext = {},
  ): Promise<void> {
    if (!passwordSchema.safeParse(newPassword).success) {
      await this.writePasswordChangeRejection(userId, audit, "PASSWORD_POLICY_VIOLATION")
      throw new AppError("PASSWORD_POLICY_VIOLATION")
    }
    const user = await this.options.persistence.findUserById(userId)
    if (!user || user.status !== "active" || !user.passwordHash) {
      await this.writePasswordChangeRejection(userId, audit, "AUTH_INVALID_CREDENTIALS")
      throw new AppError("AUTH_INVALID_CREDENTIALS")
    }
    const currentPasswordMatches = await this.passwordHasher.verify(
      user.passwordHash,
      currentPassword,
    )
    if (!currentPasswordMatches) {
      await this.writePasswordChangeRejection(userId, audit, "AUTH_INVALID_CREDENTIALS")
      throw new AppError("AUTH_INVALID_CREDENTIALS")
    }

    const newPasswordHash = await this.passwordHasher.hash(newPassword)
    const result = await this.options.persistence.changePassword({
      userId,
      expectedPasswordHash: user.passwordHash,
      newPasswordHash,
      now: jwtBoundary(this.now()),
      audit,
    })
    if (result.status !== "changed") throw new AppError("AUTH_INVALID_CREDENTIALS")
  }

  async forgotPassword(
    emailInput: string,
    metadata: SessionMetadata,
  ): Promise<{ code: "PASSWORD_RESET_REQUEST_ACCEPTED" }> {
    const email = emailSchema.parse(emailInput)
    const smtpStatus = await this.readSmtpStatus()
    if (smtpStatus !== "available") {
      await this.options.audit.write({
        actorId: null,
        action: "password_setup_or_reset_unavailable",
        result: "failed",
        metadata: {
          capability: "smtp",
          capability_status: smtpStatus,
          error_code: "SMTP_UNAVAILABLE",
          observed_at: this.now().toISOString(),
        },
      })
      throw new AppError("PASSWORD_EMAIL_UNAVAILABLE")
    }
    const responseWindowStartedAt = this.passwordResetResponseClock.now()

    let allowed: boolean
    try {
      allowed = await this.options.rateLimiter.takePasswordResetRequest(
        email,
        metadata.ipAddress ?? "invalid",
      )
    } catch {
      throw new AppError("PASSWORD_RESET_PROTECTION_UNAVAILABLE")
    }
    if (!allowed) {
      return this.finishPasswordResetRequest(responseWindowStartedAt)
    }

    const user = await this.options.persistence.findUserByEmail(email)
    if (!user || user.status !== "active") {
      await this.writePasswordResetRequestAccepted(metadata)
      return this.finishPasswordResetRequest(responseWindowStartedAt)
    }

    const plaintextToken = this.createOpaqueToken()
    const tokenHash = sha256(plaintextToken)
    const tokenId = this.createId()
    const deliveryId = this.createId()
    const now = this.now()
    let link: string
    try {
      link = buildPasswordResetLink(
        this.options.config.publicBaseUrl,
        plaintextToken,
      )
    } catch {
      return this.failPasswordResetDelivery(
        responseWindowStartedAt,
        tokenHash,
        "PASSWORD_RESET_LINK_CONFIGURATION_INVALID",
      )
    }

    try {
      await this.options.persistence.createPasswordResetToken({
        id: tokenId,
        userId: user.id,
        tokenHash,
        now,
        expiresAt: new Date(
          now.getTime() +
            this.options.config.passwordReset.tokenTtlMinutes *
              60 *
              MILLISECONDS_PER_SECOND,
        ),
        requestIp: metadata.ipAddress,
        requestUserAgent: metadata.userAgent,
      })
    } catch {
      return this.failPasswordResetDelivery(
        responseWindowStartedAt,
        tokenHash,
        "PASSWORD_RESET_TOKEN_PERSISTENCE_FAILED",
      )
    }

    try {
      const locale = user.preferredLocale ?? "zh-CN"
      const productName = await this.options.readProductName()
      await this.options.mail.sendPasswordReset(
        createPasswordResetMail({
          deliveryId,
          tokenHash,
          to: user.email,
          recipientName: user.name,
          locale,
          productName,
          link,
          expiresInMinutes:
            this.options.config.passwordReset.tokenTtlMinutes,
        }),
      )
    } catch {
      return this.failPasswordResetDelivery(
        responseWindowStartedAt,
        tokenHash,
        "PASSWORD_RESET_MAIL_ENQUEUE_FAILED",
      )
    }
    await this.writePasswordResetRequestAccepted(metadata)
    return this.finishPasswordResetRequest(responseWindowStartedAt)
  }

  async resetPassword(
    plaintextToken: string,
    newPassword: string,
    audit: AuditContext = {},
  ): Promise<void> {
    if (!passwordSchema.safeParse(newPassword).success) {
      await this.options.audit.write({
        actorId: null,
        action: "password_setup_or_reset_rejected",
        result: "rejected",
        metadata: { error_code: "PASSWORD_POLICY_VIOLATION" },
        ipAddress: audit.ipAddress ?? null,
        userAgent: audit.userAgent ?? null,
      })
      throw new AppError("PASSWORD_POLICY_VIOLATION")
    }
    const newPasswordHash = await this.passwordHasher.hash(newPassword)
    const result = await this.options.persistence.resetPassword({
      tokenHash: sha256(plaintextToken),
      newPasswordHash,
      now: jwtBoundary(this.now()),
      audit,
    })
    if (result.status !== "changed") {
      throw new AppError("PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED")
    }
  }

  async requestRegistration(
    emailInput: string,
    locale: Locale,
    metadata: SessionMetadata,
  ): Promise<{ code: "REGISTRATION_REQUEST_ACCEPTED" }> {
    const email = emailSchema.parse(emailInput)
    const registration = await this.options.persistence.getRegistrationState()
    if (!registration.enabled) throw new AppError("REGISTRATION_DISABLED")

    const smtpStatus = await this.readSmtpStatus()
    if (smtpStatus !== "available") {
      await this.options.audit.write({
        actorId: null,
        action: "self_registration_unavailable",
        result: "failed",
        metadata: {
          capability: "smtp",
          capability_status: smtpStatus,
          error_code: "SMTP_UNAVAILABLE",
          observed_at: this.now().toISOString(),
        },
      })
      throw new AppError("REGISTRATION_EMAIL_UNAVAILABLE")
    }
    const responseWindowStartedAt = this.passwordResetResponseClock.now()

    let allowed: boolean
    try {
      allowed = await this.options.rateLimiter.takeRegistrationRequest(
        email,
        metadata.ipAddress ?? "invalid",
      )
    } catch {
      throw new AppError("REGISTRATION_PROTECTION_UNAVAILABLE")
    }
    if (!allowed) {
      return this.finishRegistrationRequest(responseWindowStartedAt)
    }

    const plaintextToken = this.createOpaqueToken()
    const tokenHash = sha256(plaintextToken)
    const now = this.now()
    let link: string
    try {
      link = buildRegistrationLink(
        this.options.config.publicBaseUrl,
        plaintextToken,
      )
    } catch {
      return this.failRegistrationDelivery(
        responseWindowStartedAt,
        tokenHash,
        "REGISTRATION_LINK_CONFIGURATION_INVALID",
      )
    }

    let creation
    try {
      creation = await this.options.persistence.createRegistrationToken({
        id: this.createId(),
        email,
        locale,
        tokenHash,
        now,
        expiresAt: new Date(
          now.getTime() +
            this.options.config.passwordReset.tokenTtlMinutes *
              60 *
              MILLISECONDS_PER_SECOND,
        ),
        requestIp: metadata.ipAddress,
        requestUserAgent: metadata.userAgent,
      })
    } catch {
      return this.failRegistrationDelivery(
        responseWindowStartedAt,
        tokenHash,
        "REGISTRATION_TOKEN_PERSISTENCE_FAILED",
      )
    }
    if (creation.status === "disabled") {
      await this.finishRegistrationRequest(responseWindowStartedAt)
      throw new AppError("REGISTRATION_DISABLED")
    }
    if (creation.status === "email_exists") {
      await this.writeRegistrationRequestAccepted(metadata)
      return this.finishRegistrationRequest(responseWindowStartedAt)
    }

    try {
      const productName = await this.options.readProductName()
      await this.options.mail.sendRegistration(
        createRegistrationMail({
          deliveryId: this.createId(),
          tokenHash,
          to: email,
          locale,
          productName,
          link,
          expiresInMinutes:
            this.options.config.passwordReset.tokenTtlMinutes,
        }),
      )
    } catch {
      return this.failRegistrationDelivery(
        responseWindowStartedAt,
        tokenHash,
        "REGISTRATION_MAIL_ENQUEUE_FAILED",
      )
    }
    await this.writeRegistrationRequestAccepted(metadata)
    return this.finishRegistrationRequest(responseWindowStartedAt)
  }

  async completeRegistration(
    plaintextToken: string,
    newPassword: string,
    metadata: SessionMetadata,
  ): Promise<AuthSession> {
    if (!passwordSchema.safeParse(newPassword).success) {
      await this.options.audit.write({
        actorId: null,
        action: "self_registration_rejected",
        result: "rejected",
        metadata: { error_code: "PASSWORD_POLICY_VIOLATION" },
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      })
      throw new AppError("PASSWORD_POLICY_VIOLATION")
    }
    const passwordHash = await this.passwordHasher.hash(newPassword)
    const result = await this.options.persistence.completeRegistration({
      id: this.createId(),
      tokenHash: sha256(plaintextToken),
      passwordHash,
      now: jwtBoundary(this.now()),
      audit: metadata,
    })
    if (result.status === "disabled") {
      throw new AppError("REGISTRATION_DISABLED")
    }
    if (result.status === "email_exists") {
      throw new AppError("REGISTRATION_EMAIL_ALREADY_REGISTERED")
    }
    if (result.status === "invalid") {
      throw new AppError("REGISTRATION_TOKEN_INVALID_OR_EXPIRED")
    }
    return this.createSession(result.user, "password", metadata)
  }

  async startOidc(): Promise<{ authorizationUrl: string }> {
    if (
      !this.options.oidc ||
      (await readIntegrationStatus(
        this.options.oidc,
        this.options.config.oidc.status,
      )) !== "configured"
    ) {
      throw new AppError("AUTH_INVALID_CREDENTIALS", undefined, 503)
    }
    return this.options.oidc.start()
  }

  async completeOidc(
    callbackUrl: URL,
    metadata: SessionMetadata,
  ): Promise<AuthSession> {
    if (
      !this.options.oidc ||
      (await readIntegrationStatus(
        this.options.oidc,
        this.options.config.oidc.status,
      )) !== "configured"
    ) {
      throw new AppError("AUTH_INVALID_CREDENTIALS", undefined, 503)
    }
    let identity: VerifiedExternalIdentity
    try {
      identity = await this.options.oidc.complete(callbackUrl)
    } catch {
      throw new AppError("AUTH_INVALID_CREDENTIALS")
    }
    return this.loginExternal(identity, "oidc", metadata)
  }

  async exchangeTeamsToken(
    token: string,
    metadata: SessionMetadata,
  ): Promise<AuthSession> {
    if (
      !this.options.teams ||
      (await readIntegrationStatus(
        this.options.teams,
        this.options.config.teams.status,
      )) !== "configured"
    ) {
      throw new AppError("TEAMS_SSO_NOT_CONFIGURED")
    }
    let identity: VerifiedExternalIdentity
    try {
      identity = await this.options.teams.verify(token)
    } catch {
      throw new AppError("TEAMS_SSO_FAILED")
    }
    return this.loginExternal(identity, "teams", metadata)
  }

  async getCurrentUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.options.persistence.findUserById(userId)
    if (!user || user.status !== "active") throw new AppError("AUTH_REQUIRED")
    return sanitizeUser(user)
  }

  async cleanupInvalidTokens(limit = 500) {
    const before = new Date(
      this.now().getTime() -
        this.options.config.invalidAuthTokenRetentionDays *
          24 *
          60 *
          60 *
          MILLISECONDS_PER_SECOND,
    )
    return this.options.persistence.cleanupInvalidTokens(before, limit)
  }

  async createSocialSession(
    userId: string,
    provider: import("@linksense/shared").SocialProvider,
    metadata: SessionMetadata,
    expectedAuthValidAfter: string,
  ): Promise<AuthSession> {
    const user = await this.options.persistence.findUserById(userId)
    if (!user || user.status !== "active") throw new AppError("USER_DISABLED")
    if (user.authValidAfter.toISOString() !== expectedAuthValidAfter) throw new AppError("AUTH_SESSION_EXPIRED")
    return this.createSession(user, provider, metadata)
  }

  async loginSaml(identity: VerifiedExternalIdentity, metadata: SessionMetadata): Promise<AuthSession> {
    return this.loginExternal(identity, "saml", metadata)
  }

  private async loginExternal(
    identity: VerifiedExternalIdentity,
    method: "oidc" | "teams" | "saml",
    metadata: SessionMetadata,
  ) {
    const email = emailSchema.parse(identity.email)
    const provisioned =
      await this.options.persistence.findOrCreateDisabledExternalUser({
        id: this.createId(),
        email,
        name: externalUserName(identity, email),
        now: this.now(),
        audit: metadata,
      })
    if (provisioned.user.status !== "active") {
      throw new AppError(
        provisioned.created
          ? method === "oidc"
            ? "OIDC_ACCOUNT_PENDING_APPROVAL"
            : "EXTERNAL_ACCOUNT_PENDING_APPROVAL"
          : "USER_DISABLED",
      )
    }
    return this.createSession(provisioned.user, method, metadata)
  }

  private async createSession(
    user: AuthUserRecord,
    loginMethod: LoginMethod,
    metadata: SessionMetadata,
  ): Promise<AuthSession> {
    const now = this.now()
    const refreshToken = this.createOpaqueToken()
    const refreshSessionExpiresAt = new Date(
      now.getTime() + REFRESH_SESSION_TTL_SECONDS * MILLISECONDS_PER_SECOND,
    )
    const access = await this.options.accessTokens.issue(accessPayload(user))
    const sessionPersisted = await this.options.persistence.createRefreshSession({
      id: this.createId(),
      userId: user.id,
      familyId: this.createId(),
      tokenHash: sha256(refreshToken),
      expiresAt: refreshSessionExpiresAt,
      loginMethod,
      expectedEmail: user.email,
      expectedAuthValidAfter: user.authValidAfter,
      ...(loginMethod === "password" && user.passwordHash
        ? { expectedPasswordHash: user.passwordHash }
        : {}),
      now,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    })
    if (!sessionPersisted) throw new AppError("AUTH_INVALID_CREDENTIALS")
    await this.options.audit.write({
      actorId: user.id,
      action: "user_signed_in",
      result: "success",
      targetType: "user",
      targetId: user.id,
      metadata: { login_method: loginMethod },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    })
    return {
      accessToken: access.token,
      refreshToken,
      accessTokenExpiresAt: access.expiresAt,
      refreshSessionExpiresAt,
      user: sanitizeUser({
        ...user,
        lastLoginAt: now,
        lastLoginMethod: loginMethod,
      }),
    }
  }

  private async readSmtpStatus() {
    try {
      return await this.options.mail.status()
    } catch {
      return "unavailable" as const
    }
  }

  private writePasswordChangeRejection(
    userId: string,
    audit: AuditContext,
    errorCode: "AUTH_INVALID_CREDENTIALS" | "PASSWORD_POLICY_VIOLATION",
  ) {
    return this.options.audit.write({
      actorId: userId,
      action: "password_change_rejected",
      result: "rejected",
      targetType: "user",
      targetId: userId,
      metadata: { error_code: errorCode },
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
    })
  }

  private writePasswordResetRequestAccepted(metadata: SessionMetadata) {
    return this.options.audit.write({
      actorId: null,
      action: "password_setup_or_reset_requested",
      result: "success",
      metadata: { accepted_at: this.now().toISOString() },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    })
  }

  private writeRegistrationRequestAccepted(metadata: SessionMetadata) {
    return this.options.audit.write({
      actorId: null,
      action: "self_registration_requested",
      result: "success",
      metadata: { accepted_at: this.now().toISOString() },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    })
  }

  private async finishPasswordResetRequest(
    responseWindowStartedAt: number,
  ): Promise<{ code: "PASSWORD_RESET_REQUEST_ACCEPTED" }> {
    const remaining = Math.max(
      0,
      PASSWORD_RESET_MINIMUM_RESPONSE_MS -
        (this.passwordResetResponseClock.now() - responseWindowStartedAt),
    )
    if (remaining > 0) await this.passwordResetResponseClock.wait(remaining)
    return { code: "PASSWORD_RESET_REQUEST_ACCEPTED" }
  }

  private async failPasswordResetDelivery(
    responseWindowStartedAt: number,
    tokenHash: string,
    reasonCode: PasswordResetDeliveryFailureReason,
  ): Promise<never> {
    const isLinkConfigurationFailure =
      reasonCode === "PASSWORD_RESET_LINK_CONFIGURATION_INVALID"
    await Promise.allSettled([
      this.options.persistence.invalidatePasswordResetToken(tokenHash, this.now()),
      this.options.audit.write({
        actorId: null,
        action: "password_setup_or_reset_delivery_failed",
        result: "failed",
        metadata: {
          capability: isLinkConfigurationFailure
            ? "password_reset_link"
            : "password_reset_mail_queue",
          error_code: isLinkConfigurationFailure
            ? "PASSWORD_RESET_LINK_CONFIGURATION_INVALID"
            : "PASSWORD_RESET_MAIL_ENQUEUE_FAILED",
          reason_code: reasonCode,
        },
      }),
    ])
    await this.finishPasswordResetRequest(responseWindowStartedAt)
    throw new AppError("PASSWORD_RESET_EMAIL_DELIVERY_FAILED")
  }

  private async finishRegistrationRequest(
    responseWindowStartedAt: number,
  ): Promise<{ code: "REGISTRATION_REQUEST_ACCEPTED" }> {
    const remaining = Math.max(
      0,
      PASSWORD_RESET_MINIMUM_RESPONSE_MS -
        (this.passwordResetResponseClock.now() - responseWindowStartedAt),
    )
    if (remaining > 0) await this.passwordResetResponseClock.wait(remaining)
    return { code: "REGISTRATION_REQUEST_ACCEPTED" }
  }

  private async failRegistrationDelivery(
    responseWindowStartedAt: number,
    tokenHash: string,
    reasonCode: RegistrationDeliveryFailureReason,
  ): Promise<never> {
    const isLinkConfigurationFailure =
      reasonCode === "REGISTRATION_LINK_CONFIGURATION_INVALID"
    await Promise.allSettled([
      this.options.persistence.invalidateRegistrationToken(
        tokenHash,
        this.now(),
      ),
      this.options.audit.write({
        actorId: null,
        action: "self_registration_delivery_failed",
        result: "failed",
        metadata: {
          capability: isLinkConfigurationFailure
            ? "registration_link"
            : "registration_mail_queue",
          error_code: isLinkConfigurationFailure
            ? "REGISTRATION_LINK_CONFIGURATION_INVALID"
            : "REGISTRATION_MAIL_ENQUEUE_FAILED",
          reason_code: reasonCode,
        },
      }),
    ])
    await this.finishRegistrationRequest(responseWindowStartedAt)
    throw new AppError("REGISTRATION_EMAIL_DELIVERY_FAILED")
  }
}

function credentialsMatch(
  provided: string | undefined,
  expected: string,
): boolean {
  const providedDigest = Buffer.from(sha256(provided ?? ""), "hex")
  const expectedDigest = Buffer.from(sha256(expected), "hex")
  return timingSafeEqual(providedDigest, expectedDigest)
}

async function readIntegrationStatus(
  integration: Pick<OidcFlow, "status"> | Pick<TeamsTokenVerifier, "status"> | undefined,
  fallback: "configured" | "invalid" | "not_configured",
): Promise<"configured" | "invalid" | "not_configured"> {
  if (!integration) return fallback
  try {
    return await integration.status()
  } catch {
    return "invalid"
  }
}

export function createFastifyAccessTokenIssuer(jwt: {
  sign(payload: object, options?: { expiresIn?: number | string }): string
}): AccessTokenIssuer {
  return {
    async issue(payload) {
      const issuedAt = Math.floor(Date.now() / MILLISECONDS_PER_SECOND)
      return {
        token: jwt.sign(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS }),
        expiresAt: new Date(
          (issuedAt + ACCESS_TOKEN_TTL_SECONDS) * MILLISECONDS_PER_SECOND,
        ),
      }
    },
  }
}

function externalUserName(
  identity: VerifiedExternalIdentity,
  normalizedEmail: string,
): string {
  const claimedName = userNameSchema.safeParse(identity.name)
  if (claimedName.success) return claimedName.data
  return normalizedEmail.slice(0, normalizedEmail.lastIndexOf("@"))
}

function accessPayload(user: AuthUserRecord) {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    auth_valid_after: user.authValidAfter.toISOString(),
  }
}

function sanitizeUser(user: AuthUserRecord): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarObjectKey: user.avatarObjectKey,
    role: user.role,
    status: user.status,
    preferredLocale: user.preferredLocale,
    runningMessageAction: user.runningMessageAction,
    lastLoginAt: user.lastLoginAt,
    lastLoginMethod: user.lastLoginMethod,
    passwordUpdatedAt: user.passwordUpdatedAt,
    authValidAfter: user.authValidAfter,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

function containsPasswordPolicyIssue(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>,
) {
  return issues.some((issue) => issue.path[0] === "password")
}

function jwtBoundary(now: Date): Date {
  return new Date(now.getTime())
}

function buildPasswordResetLink(
  baseUrl: string,
  token: string,
): string {
  const url = new URL("/reset-password", baseUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("password reset URL must use HTTP or HTTPS")
  }
  url.hash = new URLSearchParams({ token }).toString()
  return url.toString()
}

function buildRegistrationLink(baseUrl: string, token: string): string {
  const url = new URL("/register/activate", baseUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("registration URL must use HTTP or HTTPS")
  }
  url.hash = new URLSearchParams({ token }).toString()
  return url.toString()
}

function createPasswordResetMail(input: {
  deliveryId: string
  tokenHash: string
  to: string
  recipientName: string
  locale: Locale
  productName: string
  link: string
  expiresInMinutes: number
}) {
  const content = renderPasswordResetEmail({
    locale: input.locale,
    productName: input.productName,
    resetUrl: input.link,
    expiresInMinutes: input.expiresInMinutes,
    recipientName: input.recipientName,
  })
  return {
    deliveryId: input.deliveryId,
    tokenHash: input.tokenHash,
    to: input.to,
    locale: input.locale,
    ...content,
  }
}

function createRegistrationMail(input: {
  deliveryId: string
  tokenHash: string
  to: string
  locale: Locale
  productName: string
  link: string
  expiresInMinutes: number
}) {
  const content = renderRegistrationEmail({
    locale: input.locale,
    productName: input.productName,
    activationUrl: input.link,
    expiresInMinutes: input.expiresInMinutes,
  })
  return {
    deliveryId: input.deliveryId,
    tokenHash: input.tokenHash,
    to: input.to,
    locale: input.locale,
    ...content,
  }
}

const defaultResponseClock: ResponseClock = {
  now: () => Date.now(),
  wait: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds)
    }),
}
