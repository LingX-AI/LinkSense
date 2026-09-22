import { createHash } from "node:crypto"
import { isLocale, loginMethodSchema, type Locale } from "@linksense/shared"

import {
  Prisma,
  type PrismaClient,
  type User,
} from "../../generated/prisma/client.js"
import { sanitizeAuditMetadata } from "../audit/service.js"
import { readSelfRegistrationPolicy } from "./registration-policy.js"

import type {
  AuthPersistence,
  AuthUserRecord,
  CompleteRegistrationInput,
  CompleteRegistrationResult,
  InitializeAdminInput,
  InitializeAdminResult,
  NewRefreshSession,
  PasswordChangeInput,
  PasswordMutationResult,
  PasswordResetInput,
  ProvisionDisabledExternalUserInput,
  ProvisionDisabledExternalUserResult,
  RefreshRotationResult,
  RegistrationTokenCreationResult,
  RotateRefreshSession,
} from "./types.js"

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const INITIALIZATION_ADVISORY_LOCK = 7_223_456_001n

type DatabaseClient = PrismaClient | Prisma.TransactionClient

export class PrismaAuthRepository implements AuthPersistence {
  constructor(private readonly prisma: PrismaClient) {}

  async getBootstrapState(): Promise<{ initialized: boolean }> {
    const [settings, activeAdministrators] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { id: SYSTEM_SETTINGS_ID } }),
      this.prisma.user.count({ where: { role: "admin", status: "active" } }),
    ])
    const initialized =
      readBooleanSetting(settings?.settingsJson, "system_initialized") === true &&
      activeAdministrators > 0
    return { initialized }
  }

  async getRegistrationState(): Promise<{ enabled: boolean }> {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { settingsJson: true },
    })
    return { enabled: readSelfRegistrationPolicy(settings?.settingsJson) !== null }
  }

  initializeAdmin(input: InitializeAdminInput): Promise<InitializeAdminResult> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${INITIALIZATION_ADVISORY_LOCK})`
      const [settings, userCount] = await Promise.all([
        transaction.systemSetting.findUnique({
          where: { id: SYSTEM_SETTINGS_ID },
        }),
        transaction.user.count(),
      ])
      const alreadyInitialized =
        userCount > 0 ||
        readBooleanSetting(settings?.settingsJson, "system_initialized") === true

      if (alreadyInitialized) {
        await writeAudit(transaction, {
          action: "system_initialization_rejected",
          result: "rejected",
          actorId: null,
          targetType: "system",
          targetId: SYSTEM_SETTINGS_ID,
          metadata: {
            error_code: "SYSTEM_ALREADY_INITIALIZED",
            requested_at: input.now.toISOString(),
          },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        })
        return { status: "already_initialized" }
      }

      const user = await transaction.user.create({
        data: {
          id: input.id,
          email: input.email,
          name: input.name,
          role: "admin",
          status: "active",
          passwordHash: input.passwordHash,
          passwordUpdatedAt: input.now,
          authValidAfter: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      })
      const settingsJson = mergeSettings(settings?.settingsJson, {
        system_initialized: true,
        initialized_at: input.now.toISOString(),
      })
      await transaction.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson,
          updatedBy: user.id,
          createdAt: input.now,
          updatedAt: input.now,
        },
        update: {
          settingsJson,
          updatedBy: user.id,
          updatedAt: input.now,
        },
      })
      await writeAudit(transaction, {
        action: "system_initialized",
        result: "success",
        actorId: user.id,
        targetType: "user",
        targetId: user.id,
        metadata: { role: "admin", initialized_at: input.now.toISOString() },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      })
      return { status: "initialized", user: mapUser(user) }
    })
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findFirst({
      where: { email },
    })
    return user ? mapUser(user) : null
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findFirst({
      where: { id },
    })
    return user ? mapUser(user) : null
  }

  findOrCreateDisabledExternalUser(
    input: ProvisionDisabledExternalUserInput,
  ): Promise<ProvisionDisabledExternalUserResult> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.user.findUnique({
        where: { email: input.email },
      })
      if (existing) return { user: mapUser(existing), created: false }

      const inserted = await transaction.user.createMany({
        data: {
          id: input.id,
          email: input.email,
          name: input.name,
          role: "user",
          status: "disabled",
          passwordHash: null,
          passwordUpdatedAt: null,
          authValidAfter: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
        skipDuplicates: true,
      })
      const user = await transaction.user.findUnique({
        where: { email: input.email },
      })
      if (!user) throw new Error("External user provisioning did not converge")

      const created = inserted.count === 1
      if (created) {
        await writeAudit(transaction, {
          actorId: null,
          action: "user_created",
          targetType: "user",
          targetId: user.id,
          result: "success",
          metadata: {
            role: "user",
            status: "disabled",
            user_group_count: 0,
          },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        })
      }
      return { user: mapUser(user), created }
    })
  }

  async createRefreshSession(input: NewRefreshSession): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await lockUser(transaction, input.userId)
      const user = await transaction.user.findUnique({ where: { id: input.userId } })
      if (
        !user ||
        user.status !== "active" ||
        user.email !== input.expectedEmail ||
        user.authValidAfter.getTime() !== input.expectedAuthValidAfter.getTime() ||
        (input.expectedPasswordHash !== undefined &&
          user.passwordHash !== input.expectedPasswordHash)
      ) {
        return false
      }
      await transaction.refreshToken.create({
        data: {
          id: input.id,
          userId: input.userId,
          familyId: input.familyId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          ipAddress: input.ipAddress,
          userAgent: redactRefreshUserAgent(input.userAgent),
          createdAt: input.now,
        },
      })
      await transaction.user.update({
        where: { id: input.userId },
        data: {
          lastLoginAt: input.now,
          lastLoginMethod: input.loginMethod,
          updatedAt: input.now,
        },
      })
      return true
    })
  }

  rotateRefreshSession(
    input: RotateRefreshSession,
  ): Promise<RefreshRotationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM refresh_tokens
        WHERE token_hash = ${input.tokenHash}
        FOR UPDATE
      `
      const lockedId = locked[0]?.id
      if (!lockedId) return { status: "invalid" }
      const current = await transaction.refreshToken.findUnique({
        where: { id: lockedId },
      })
      if (!current) return { status: "invalid" }

      if (current.revokedAt || current.replacedByTokenId) {
        await revokeRefreshFamily(
          transaction,
          current.familyId,
          input.now,
          "reuse_detected",
        )
        return { status: "reused" }
      }
      if (current.expiresAt.getTime() <= input.now.getTime()) {
        return { status: "invalid" }
      }

      const user = await transaction.user.findUnique({
        where: { id: current.userId },
      })
      if (!user || user.status !== "active") {
        await revokeRefreshFamily(
          transaction,
          current.familyId,
          input.now,
          "user_inactive",
        )
        return { status: "invalid" }
      }

      await transaction.refreshToken.create({
        data: {
          id: input.id,
          userId: current.userId,
          familyId: current.familyId,
          parentTokenId: current.id,
          tokenHash: input.replacementTokenHash,
          ipAddress: input.ipAddress,
          userAgent: redactRefreshUserAgent(input.userAgent),
          expiresAt: current.expiresAt,
          createdAt: input.now,
        },
      })
      await transaction.refreshToken.update({
        where: { id: current.id },
        data: {
          revokedAt: input.now,
          revokeReason: "rotated",
          replacedByTokenId: input.id,
        },
      })
      return {
        status: "rotated",
        user: mapUser(user),
        familyId: current.familyId,
        expiresAt: current.expiresAt,
      }
    })
  }

  async revokeRefreshSession(tokenHash: string, now: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now, revokeReason: "logout" },
    })
  }

  changePassword(input: PasswordChangeInput): Promise<PasswordMutationResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockUser(transaction, input.userId)
      const user = await transaction.user.findUnique({
        where: { id: input.userId },
      })
      if (
        !user ||
        user.status !== "active" ||
        user.passwordHash !== input.expectedPasswordHash
      ) {
        await writeAudit(transaction, {
          action: "password_change_rejected",
          result: "rejected",
          actorId: input.userId,
          targetType: "user",
          targetId: input.userId,
          metadata: { error_code: "AUTH_INVALID_CREDENTIALS" },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        })
        return { status: "invalid" }
      }

      const updated = await transaction.user.update({
        where: { id: user.id },
        data: {
          passwordHash: input.newPasswordHash,
          passwordUpdatedAt: input.now,
          authValidAfter: input.now,
          updatedAt: input.now,
        },
      })
      await revokeUserRefreshTokens(
        transaction,
        user.id,
        input.now,
        "password_changed",
      )
      await writeAudit(transaction, {
        action: "user_password_changed",
        result: "success",
        actorId: user.id,
        targetType: "user",
        targetId: user.id,
        metadata: { method: "authenticated_change" },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      })
      return { status: "changed", user: mapUser(updated) }
    })
  }

  async createPasswordResetToken(input: {
    id: string
    userId: string
    tokenHash: string
    expiresAt: Date
    now: Date
    requestIp: string | null
    requestUserAgent: string | null
  }): Promise<void> {
    await this.prisma.passwordResetToken.create({
      data: {
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        requestIp: input.requestIp,
        requestUserAgent: input.requestUserAgent,
        createdAt: input.now,
      },
    })
  }

  async invalidatePasswordResetToken(tokenHash: string, now: Date): Promise<void> {
    await this.prisma.passwordResetToken.updateMany({
      where: { tokenHash, consumedAt: null },
      data: { consumedAt: now },
    })
  }

  resetPassword(input: PasswordResetInput): Promise<PasswordMutationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM password_reset_tokens
        WHERE token_hash = ${input.tokenHash}
        FOR UPDATE
      `
      const tokenId = locked[0]?.id
      const token = tokenId
        ? await transaction.passwordResetToken.findUnique({ where: { id: tokenId } })
        : null
      const user = token
        ? await lockAndReadUser(transaction, token.userId)
        : null
      if (
        !token ||
        token.consumedAt ||
        token.expiresAt.getTime() <= input.now.getTime() ||
        !user ||
        user.status !== "active"
      ) {
        await writeAudit(transaction, {
          action: "password_token_rejected",
          result: "rejected",
          actorId: null,
          targetType: null,
          targetId: null,
          metadata: {
            error_code: "PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED",
          },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        })
        return { status: "invalid" }
      }

      const updated = await transaction.user.update({
        where: { id: user.id },
        data: {
          passwordHash: input.newPasswordHash,
          passwordUpdatedAt: input.now,
          authValidAfter: input.now,
          updatedAt: input.now,
        },
      })
      await transaction.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: input.now },
      })
      await revokeUserRefreshTokens(
        transaction,
        user.id,
        input.now,
        "password_reset",
      )
      await writeAudit(transaction, {
        action: "user_password_changed",
        result: "success",
        actorId: user.id,
        targetType: "user",
        targetId: user.id,
        metadata: { method: "reset_link" },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      })
      return { status: "changed", user: mapUser(updated) }
    })
  }

  createRegistrationToken(input: {
    id: string
    email: string
    locale: Locale
    tokenHash: string
    expiresAt: Date
    now: Date
    requestIp: string | null
    requestUserAgent: string | null
  }): Promise<RegistrationTokenCreationResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockSystemSettings(transaction)
      const settings = await transaction.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
        select: { settingsJson: true },
      })
      if (!readSelfRegistrationPolicy(settings?.settingsJson)) {
        return { status: "disabled" }
      }
      const existing = await transaction.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      })
      if (existing) return { status: "email_exists" }

      await transaction.registrationToken.updateMany({
        where: { email: input.email, consumedAt: null },
        data: { consumedAt: input.now },
      })
      await transaction.registrationToken.create({
        data: {
          id: input.id,
          email: input.email,
          locale: input.locale,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          requestIp: input.requestIp,
          requestUserAgent: input.requestUserAgent,
          createdAt: input.now,
        },
      })
      return { status: "created" }
    })
  }

  async invalidateRegistrationToken(
    tokenHash: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.registrationToken.updateMany({
      where: { tokenHash, consumedAt: null },
      data: { consumedAt: now },
    })
  }

  async completeRegistration(
    input: CompleteRegistrationInput,
  ): Promise<CompleteRegistrationResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await lockSystemSettings(transaction)
        const settings = await transaction.systemSetting.findUnique({
          where: { id: SYSTEM_SETTINGS_ID },
          select: { settingsJson: true },
        })
        const registrationPolicy = readSelfRegistrationPolicy(
          settings?.settingsJson,
        )
        if (!registrationPolicy) {
          return { status: "disabled" }
        }

        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM registration_tokens
          WHERE token_hash = ${input.tokenHash}
          FOR UPDATE
        `
        const tokenId = locked[0]?.id
        const token = tokenId
          ? await transaction.registrationToken.findUnique({
              where: { id: tokenId },
            })
          : null
        if (
          !token ||
          token.consumedAt ||
          token.expiresAt.getTime() <= input.now.getTime()
        ) {
          return { status: "invalid" }
        }

        const existing = await transaction.user.findUnique({
          where: { email: token.email },
          select: { id: true },
        })
        if (existing) {
          await transaction.registrationToken.update({
            where: { id: token.id },
            data: { consumedAt: input.now },
          })
          return { status: "email_exists" }
        }

        const user = await transaction.user.create({
          data: {
            id: input.id,
            email: token.email,
            name: registrationUserName(token.email),
            role: "user",
            status: "active",
            passwordHash: input.passwordHash,
            preferredLocale: null,
            selfRegisteredAt: input.now,
            ...registrationPolicy,
            passwordUpdatedAt: input.now,
            authValidAfter: input.now,
            createdAt: input.now,
            updatedAt: input.now,
          },
        })
        await transaction.registrationToken.updateMany({
          where: { email: token.email, consumedAt: null },
          data: { consumedAt: input.now },
        })
        await writeAudit(transaction, {
          actorId: user.id,
          action: "user_self_registered",
          targetType: "user",
          targetId: user.id,
          result: "success",
          metadata: {
            role: "user",
            status: "active",
          },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        })
        return { status: "activated", user: mapUser(user) }
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { status: "email_exists" }
      }
      throw error
    }
  }

  async recordExternalLogin(
    userId: string,
    method: "oidc" | "teams",
    now: Date,
  ): Promise<AuthUserRecord | null> {
    const updated = await this.prisma.user.updateMany({
      where: { id: userId, status: "active" },
      data: { lastLoginAt: now, lastLoginMethod: method, updatedAt: now },
    })
    if (updated.count !== 1) return null
    return this.findUserById(userId)
  }

  cleanupInvalidTokens(
    before: Date,
    limit: number,
  ): Promise<{
    refreshTokens: number
    passwordResetTokens: number
    registrationTokens: number
  }> {
    return this.prisma.$transaction(async (transaction) => {
      const [refreshRows, resetRows, registrationRows] = await Promise.all([
        transaction.refreshToken.findMany({
          where: {
            OR: [
              { revokedAt: { lt: before } },
              { revokedAt: null, expiresAt: { lt: before } },
            ],
          },
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take: limit,
        }),
        transaction.passwordResetToken.findMany({
          where: {
            OR: [
              { consumedAt: { lt: before } },
              { consumedAt: null, expiresAt: { lt: before } },
            ],
          },
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take: limit,
        }),
        transaction.registrationToken.findMany({
          where: {
            OR: [
              { consumedAt: { lt: before } },
              { consumedAt: null, expiresAt: { lt: before } },
            ],
          },
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take: limit,
        }),
      ])
      const [refreshTokens, passwordResetTokens, registrationTokens] =
        await Promise.all([
        transaction.refreshToken.deleteMany({
          where: { id: { in: refreshRows.map((row) => row.id) } },
        }),
        transaction.passwordResetToken.deleteMany({
          where: { id: { in: resetRows.map((row) => row.id) } },
        }),
        transaction.registrationToken.deleteMany({
          where: { id: { in: registrationRows.map((row) => row.id) } },
        }),
      ])
      return {
        refreshTokens: refreshTokens.count,
        passwordResetTokens: passwordResetTokens.count,
        registrationTokens: registrationTokens.count,
      }
    })
  }
}

async function lockUser(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE
  `
}

async function lockSystemSettings(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
  `
}

async function lockAndReadUser(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<User | null> {
  await lockUser(transaction, userId)
  return transaction.user.findUnique({ where: { id: userId } })
}

async function revokeRefreshFamily(
  transaction: Prisma.TransactionClient,
  familyId: string,
  now: Date,
  reason: string,
): Promise<void> {
  await transaction.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason },
  })
}

async function revokeUserRefreshTokens(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
  reason: string,
): Promise<void> {
  await transaction.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason },
  })
}

function mapUser(user: User): AuthUserRecord {
  if (
    (user.role !== "user" && user.role !== "admin") ||
    (user.status !== "active" && user.status !== "disabled") ||
    (user.preferredLocale !== null && !isLocale(user.preferredLocale)) ||
    (user.runningMessageAction !== "steer" &&
      user.runningMessageAction !== "queue") ||
    (user.lastLoginMethod !== null && !loginMethodSchema.safeParse(user.lastLoginMethod).success)
  ) {
    throw new Error("invalid persisted auth user state")
  }
  return {
    ...user,
    role: user.role,
    status: user.status,
    preferredLocale: user.preferredLocale,
    runningMessageAction: user.runningMessageAction,
    lastLoginMethod: user.lastLoginMethod === null ? null : loginMethodSchema.parse(user.lastLoginMethod),
  }
}

type AuditWrite = {
  action: string
  result: "success" | "rejected" | "failed"
  actorId: string | null
  targetType: string | null
  targetId: string | null
  metadata: Record<string, string | number | boolean | null>
  ipAddress: string | null
  userAgent: string | null
}

function writeAudit(client: DatabaseClient, entry: AuditWrite): Promise<unknown> {
  return client.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      result: entry.result,
      metadataJson: sanitizeAuditMetadata(entry.action, entry.metadata),
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    },
  })
}

function readBooleanSetting(value: Prisma.JsonValue | undefined, key: string) {
  if (!value || Array.isArray(value) || typeof value !== "object") return undefined
  const entry = value[key]
  return typeof entry === "boolean" ? entry : undefined
}

function registrationUserName(email: string): string {
  return email.slice(0, email.lastIndexOf("@"))
}

function redactRefreshUserAgent(value: string | null): string | null {
  if (value === null) return null
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function mergeSettings(
  value: Prisma.JsonValue | undefined,
  additions: Record<string, string | boolean>,
): Prisma.InputJsonObject {
  const base =
    value && !Array.isArray(value) && typeof value === "object" ? value : {}
  return { ...base, ...additions }
}
