import {
  type SocialProvider,
  socialProviderSchema,
  type SocialCallbackResult,
} from "@linksense/shared"
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js"
import { AppError } from "../../lib/errors.js"
import { readSelfRegistrationPolicy } from "../auth/registration-policy.js"
import type { SessionMetadata } from "../auth/types.js"
import type { SocialIdentity } from "./protocol.js"
import { SOCIAL_SETTINGS_ID, type SocialSettingsService } from "./settings.js"

export class SocialFailure extends Error {
  constructor(readonly result: SocialCallbackResult) {
    super(result)
  }
}
export type SocialActor = { id: string; authValidAfter: string }
export type SocialAuthentication = { userId: string; authValidAfter: string }
export interface SocialRepository {
  find(identity: SocialIdentity): Promise<SocialAuthentication | null>
  registrationEnabled(): Promise<boolean>
  authenticate(
    identity: SocialIdentity,
    revision: number,
    actor: SocialActor | null,
    metadata: SessionMetadata,
  ): Promise<SocialAuthentication>
  list(
    userId: string,
  ): Promise<Array<{ provider: SocialProvider; created_at: string }>>
  unlink(
    userId: string,
    provider: SocialProvider,
    metadata: SessionMetadata,
  ): Promise<void>
}

export class PrismaSocialRepository implements SocialRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SocialSettingsService,
  ) {}

  async find(identity: SocialIdentity): Promise<SocialAuthentication | null> {
    const account = await this.prisma.socialAccount.findUnique({
      where: { provider_clientId_subject: identityKey(identity) },
    })
    if (!account) return null
    const user = await this.prisma.user.findUnique({
      where: { id: account.userId },
    })
    if (!user || user.status !== "active") throw new SocialFailure("disabled")
    return {
      userId: user.id,
      authValidAfter: user.authValidAfter.toISOString(),
    }
  }

  async registrationEnabled(): Promise<boolean> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SOCIAL_SETTINGS_ID },
      select: { settingsJson: true },
    })
    return readSelfRegistrationPolicy(row?.settingsJson) !== null
  }

  async authenticate(
    identity: SocialIdentity,
    revision: number,
    actor: SocialActor | null,
    metadata: SessionMetadata,
  ): Promise<SocialAuthentication> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))`
        const row = await tx.systemSetting.findUnique({
          where: { id: SOCIAL_SETTINGS_ID },
          select: { settingsJson: true },
        })
        const config = this.settings.readEnvelope(row?.settingsJson)[
          identity.provider
        ]
        if (
          !config?.enabled ||
          config.revision !== revision ||
          config.client_id !== identity.clientId
        )
          throw new SocialFailure("configuration_changed")
        const account = await tx.socialAccount.findUnique({
          where: { provider_clientId_subject: identityKey(identity) },
        })
        if (actor && account && account.userId !== actor.id)
          throw new SocialFailure("already_linked")
        let userId = actor?.id ?? account?.userId
        if (userId) {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`
          const user = await tx.user.findUnique({ where: { id: userId } })
          if (!user || user.status !== "active")
            throw new SocialFailure("disabled")
          if (
            actor &&
            actor.authValidAfter !== user.authValidAfter.toISOString()
          )
            throw new SocialFailure("failed")
          if (!account) {
            if (
              await tx.socialAccount.findUnique({
                where: {
                  userId_provider: { userId, provider: identity.provider },
                },
              })
            )
              throw new SocialFailure("already_linked")
            await tx.socialAccount.create({
              data: { userId, ...identityKey(identity) },
            })
            await audit(
              tx,
              userId,
              "social_account_linked",
              identity.provider,
              metadata,
            )
          }
          return { userId, authValidAfter: user.authValidAfter.toISOString() }
        }
        const policy = readSelfRegistrationPolicy(row?.settingsJson)
        if (!policy) throw new SocialFailure("registration_disabled")
        if (!identity.email || !identity.emailVerified)
          throw new SocialFailure("verify_email")
        if (
          await tx.user.findUnique({
            where: { email: identity.email },
            select: { id: true },
          })
        )
          throw new SocialFailure("email_exists")
        const user = await tx.user.create({
          data: {
            email: identity.email,
            name:
              identity.name ||
              identity.email
                .slice(0, identity.email.indexOf("@"))
                .slice(0, 120),
            role: "user",
            status: "active",
            selfRegisteredAt: new Date(),
            ...policy,
          },
        })
        userId = user.id
        await tx.socialAccount.create({
          data: { userId, ...identityKey(identity) },
        })
        await audit(
          tx,
          userId,
          "user_self_registered",
          identity.provider,
          metadata,
        )
        return { userId, authValidAfter: user.authValidAfter.toISOString() }
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new SocialFailure("email_exists")
      throw error
    }
  }

  async list(
    userId: string,
  ): Promise<Array<{ provider: SocialProvider; created_at: string }>> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    })
    return accounts.map((item) => ({
      provider: socialProviderSchema.parse(item.provider),
      created_at: item.createdAt.toISOString(),
    }))
  }

  async unlink(
    userId: string,
    provider: SocialProvider,
    metadata: SessionMetadata,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))`
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`
      const user = await tx.user.findUnique({ where: { id: userId } })
      if (!user || user.status !== "active") throw new AppError("AUTH_REQUIRED")
      const accounts = await tx.socialAccount.findMany({ where: { userId } })
      if (!accounts.some((account) => account.provider === provider)) return
      const row = await tx.systemSetting.findUnique({
        where: { id: SOCIAL_SETTINGS_ID },
        select: { settingsJson: true },
      })
      const configs = this.settings.readEnvelope(row?.settingsJson)
      const otherEnabled = accounts.some((account) => {
        const other = socialProviderSchema.parse(account.provider)
        return (
          other !== provider &&
          configs[other]?.enabled &&
          configs[other]?.client_id === account.clientId
        )
      })
      if (!user.passwordHash && !otherEnabled)
        throw new AppError("SOCIAL_LAST_METHOD")
      await tx.socialAccount.deleteMany({ where: { userId, provider } })
      const now = new Date(
        Math.max(Date.now(), user.authValidAfter.getTime() + 1),
      )
      await tx.user.update({
        where: { id: userId },
        data: { authValidAfter: now },
      })
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: "social_account_unlinked" },
      })
      await audit(tx, userId, "social_account_unlinked", provider, metadata)
    })
  }
}

function identityKey(identity: SocialIdentity): {
  provider: SocialProvider
  clientId: string
  subject: string
} {
  return {
    provider: identity.provider,
    clientId: identity.clientId,
    subject: identity.subject,
  }
}
async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  provider: SocialProvider,
  metadata: SessionMetadata,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: userId,
      action,
      targetType: "user",
      targetId: userId,
      result: "success",
      metadataJson: { provider },
      ...metadata,
    },
  })
}
