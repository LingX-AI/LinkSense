import type { Locale, loginMethodSchema } from "@linksense/shared"
import type { z } from "zod"

import type { LoginRateLimitKeys } from "../../adapters/redis.js"
import type { AuditContext } from "../audit/service.js"

export type AuthRole = "user" | "admin"
export type AuthStatus = "active" | "disabled"
export type LoginMethod = z.infer<typeof loginMethodSchema>
export type RunningMessageAction = "steer" | "queue"

export type AuthUserRecord = {
  id: string
  email: string
  name: string
  avatarObjectKey: string | null
  role: AuthRole
  status: AuthStatus
  passwordHash: string | null
  preferredLocale: Locale | null
  runningMessageAction: RunningMessageAction
  lastLoginAt: Date | null
  lastLoginMethod: LoginMethod | null
  passwordUpdatedAt: Date | null
  authValidAfter: Date
  createdAt: Date
  updatedAt: Date
}

export type SessionMetadata = {
  ipAddress: string | null
  userAgent: string | null
}

export type NewRefreshSession = SessionMetadata & {
  id: string
  userId: string
  familyId: string
  tokenHash: string
  expiresAt: Date
  loginMethod: LoginMethod
  expectedEmail: string
  expectedAuthValidAfter: Date
  expectedPasswordHash?: string
  now: Date
}

export type RotateRefreshSession = SessionMetadata & {
  id: string
  tokenHash: string
  replacementTokenHash: string
  now: Date
}

export type RefreshRotationResult =
  | {
      status: "rotated"
      user: AuthUserRecord
      familyId: string
      expiresAt: Date
    }
  | { status: "invalid" | "reused" }

export type InitializeAdminInput = {
  id: string
  email: string
  name: string
  passwordHash: string
  now: Date
  audit: AuditContext
}

export type InitializeAdminResult =
  | { status: "initialized"; user: AuthUserRecord }
  | { status: "already_initialized" }

export type PasswordChangeInput = {
  userId: string
  expectedPasswordHash: string
  newPasswordHash: string
  now: Date
  audit: AuditContext
}

export type PasswordResetInput = {
  tokenHash: string
  newPasswordHash: string
  now: Date
  audit: AuditContext
}

export type PasswordMutationResult =
  | { status: "changed"; user: AuthUserRecord }
  | { status: "invalid" }

export type RegistrationTokenCreationResult =
  | { status: "created" }
  | { status: "disabled" | "email_exists" }

export type CompleteRegistrationInput = {
  id: string
  tokenHash: string
  passwordHash: string
  now: Date
  audit: AuditContext
}

export type CompleteRegistrationResult =
  | { status: "activated"; user: AuthUserRecord }
  | { status: "disabled" }
  | { status: "invalid" }
  | { status: "email_exists" }

export type ProvisionDisabledExternalUserInput = {
  id: string
  email: string
  name: string
  now: Date
  audit: AuditContext
}

export type ProvisionDisabledExternalUserResult = {
  user: AuthUserRecord
  created: boolean
}

export interface AuthPersistence {
  getBootstrapState(): Promise<{ initialized: boolean }>
  getRegistrationState(): Promise<{ enabled: boolean }>
  initializeAdmin(input: InitializeAdminInput): Promise<InitializeAdminResult>
  findUserByEmail(email: string): Promise<AuthUserRecord | null>
  findUserById(id: string): Promise<AuthUserRecord | null>
  findOrCreateDisabledExternalUser(
    input: ProvisionDisabledExternalUserInput,
  ): Promise<ProvisionDisabledExternalUserResult>
  createRefreshSession(input: NewRefreshSession): Promise<boolean>
  rotateRefreshSession(
    input: RotateRefreshSession,
  ): Promise<RefreshRotationResult>
  revokeRefreshSession(tokenHash: string, now: Date): Promise<void>
  changePassword(input: PasswordChangeInput): Promise<PasswordMutationResult>
  createPasswordResetToken(input: {
    id: string
    userId: string
    tokenHash: string
    expiresAt: Date
    now: Date
    requestIp: string | null
    requestUserAgent: string | null
  }): Promise<void>
  invalidatePasswordResetToken(tokenHash: string, now: Date): Promise<void>
  resetPassword(input: PasswordResetInput): Promise<PasswordMutationResult>
  createRegistrationToken(input: {
    id: string
    email: string
    locale: Locale
    tokenHash: string
    expiresAt: Date
    now: Date
    requestIp: string | null
    requestUserAgent: string | null
  }): Promise<RegistrationTokenCreationResult>
  invalidateRegistrationToken(tokenHash: string, now: Date): Promise<void>
  completeRegistration(
    input: CompleteRegistrationInput,
  ): Promise<CompleteRegistrationResult>
  recordExternalLogin(
    userId: string,
    method: Exclude<LoginMethod, "password">,
    now: Date,
  ): Promise<AuthUserRecord | null>
  cleanupInvalidTokens(before: Date, limit: number): Promise<{
    refreshTokens: number
    passwordResetTokens: number
    registrationTokens: number
  }>
}

export interface AuthRateLimiter {
  loginKeys(email: string, ip: string): LoginRateLimitKeys
  precheckLogin(keys: LoginRateLimitKeys): Promise<number>
  recordLoginFailure(keys: LoginRateLimitKeys): Promise<number>
  clearEmailLoginState(keys: LoginRateLimitKeys): Promise<void>
  takePasswordResetRequest(email: string, ip: string): Promise<boolean>
  takeRegistrationRequest(email: string, ip: string): Promise<boolean>
}

export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(hash: string, password: string): Promise<boolean>
  dummyHash(): Promise<string>
}

export type AccessTokenInput = {
  sub: string
  email: string
  role: AuthRole
  auth_valid_after: string
}

export interface AccessTokenIssuer {
  issue(payload: AccessTokenInput): Promise<{
    token: string
    expiresAt: Date
  }>
}

export type PasswordResetMail = {
  deliveryId: string
  tokenHash: string
  to: string
  locale: Locale
  subject: string
  text: string
  html: string
}

export type RegistrationMail = PasswordResetMail

export interface PasswordMailGateway {
  status(): Promise<"available" | "not_configured" | "unavailable">
  sendPasswordReset(mail: PasswordResetMail): Promise<void>
  sendRegistration(mail: RegistrationMail): Promise<void>
}

export type VerifiedExternalIdentity = {
  email: string
  name?: string
}

export type AuthenticationIntegrationStatus =
  | "configured"
  | "invalid"
  | "not_configured"

export interface OidcFlow {
  status(): Promise<AuthenticationIntegrationStatus>
  start(): Promise<{ authorizationUrl: string }>
  complete(callbackUrl: URL): Promise<VerifiedExternalIdentity>
}

export interface TeamsTokenVerifier {
  status(): Promise<AuthenticationIntegrationStatus>
  verify(token: string): Promise<VerifiedExternalIdentity>
}

export type AuthenticatedUser = Omit<AuthUserRecord, "passwordHash">

export type AuditWriter = {
  write(entry: {
    actorId?: string | null
    action: string
    targetType?: string | null
    targetId?: string | null
    result: "success" | "rejected" | "failed"
    metadata?: Record<string, string | number | boolean | null>
    ipAddress?: string | null
    userAgent?: string | null
  }): Promise<void>
}
