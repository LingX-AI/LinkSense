import {
  socialProviderSchema,
  socialSettingsSchema,
  updateSocialProviderSchema,
  type SocialProvider,
  type SocialProviderSettings,
  type UpdateSocialProvider,
} from "@linksense/shared"
import { importPKCS8 } from "jose"
import { z } from "zod"
import type { AppConfig } from "../../config.js"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"
import { decryptJson, encryptJson } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import type { AuditContext } from "../audit/service.js"

export const SOCIAL_SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const CONTEXT = "linksense:social-authentication:v1"
const KEY = "social_authentication_encrypted"
const configurationSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  client_id: z.string().max(512),
  client_secret: z.string().max(16_384),
  team_id: z.string().optional(),
  key_id: z.string().optional(),
  graph_api_version: z.string().optional(),
})
const envelopeSchema = z.partialRecord(
  socialProviderSchema,
  configurationSchema,
)
export type SocialConfiguration = z.infer<typeof configurationSchema>
export type SocialSettingsReader = Pick<
  SocialSettingsService,
  "resolve" | "redirectUri"
>

export class SocialSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  redirectUri(provider: SocialProvider): string {
    return new URL(
      `/api/v1/auth/social/${provider}/callback`,
      this.config.publicBaseUrl,
    ).toString()
  }

  readEnvelope(
    value: Prisma.JsonValue | undefined,
  ): z.infer<typeof envelopeSchema> {
    const raw = jsonObject(value)[KEY]
    if (raw === undefined) return {}
    if (typeof raw !== "string") throw new AppError("INTERNAL_ERROR")
    return envelopeSchema.parse(
      decryptJson<unknown>(
        raw,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        CONTEXT,
      ),
    )
  }

  async resolve(provider: SocialProvider): Promise<SocialConfiguration | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SOCIAL_SETTINGS_ID },
      select: { settingsJson: true },
    })
    return this.readEnvelope(row?.settingsJson)[provider] ?? null
  }

  async getAdminSettings(): Promise<SocialProviderSettings[]> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SOCIAL_SETTINGS_ID },
      select: { settingsJson: true },
    })
    const envelope = this.readEnvelope(row?.settingsJson)
    return socialSettingsSchema.parse(
      socialProviderSchema.options.map((provider) => {
        const value = envelope[provider]
        return {
          provider,
          revision: value?.revision ?? 0,
          enabled: value?.enabled ?? false,
          client_id: value?.client_id ?? "",
          secret_configured: Boolean(value?.client_secret),
          team_id: value?.team_id ?? null,
          key_id: value?.key_id ?? null,
          graph_api_version: value?.graph_api_version ?? null,
          redirect_uri: this.redirectUri(provider),
        }
      }),
    )
  }

  async update(
    provider: SocialProvider,
    raw: UpdateSocialProvider,
    actorId: string,
    audit: AuditContext,
  ): Promise<SocialProviderSettings[]> {
    const input = updateSocialProviderSchema.parse(raw)
    // Apple form_post needs a secure cross-site flow cookie. All providers use
    // production HTTPS; loopback HTTP remains available for non-Apple development.
    const callback = new URL(this.redirectUri(provider))
    if (
      input.enabled &&
      callback.protocol !== "https:" &&
      (provider === "apple" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname))
    ) {
      throw new AppError("VALIDATION_ERROR")
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))`
      const row = await tx.systemSetting.findUnique({
        where: { id: SOCIAL_SETTINGS_ID },
        select: { settingsJson: true },
      })
      const envelope = this.readEnvelope(row?.settingsJson)
      const current = envelope[provider]
      if ((current?.revision ?? 0) !== input.expected_revision)
        throw new AppError("CONFLICT")
      if (
        current?.client_id &&
        (current.client_id !== input.client_id ||
          (provider === "apple" && current.team_id !== input.team_id))
      ) {
        if (await tx.socialAccount.count({ where: { provider } }))
          throw new AppError("SOCIAL_CLIENT_IN_USE")
      }
      const next = configurationSchema.parse({
        enabled: input.enabled,
        client_id: input.client_id,
        team_id: input.team_id,
        key_id: input.key_id,
        graph_api_version: input.graph_api_version,
        revision: input.expected_revision + 1,
        client_secret: input.client_secret ?? current?.client_secret ?? "",
      })
      if (next.enabled) {
        if (!next.client_secret) throw new AppError("VALIDATION_ERROR")
        if (provider === "apple") {
          if (!next.team_id || !next.key_id)
            throw new AppError("VALIDATION_ERROR")
          try {
            await importPKCS8(next.client_secret, "ES256")
          } catch {
            throw new AppError("VALIDATION_ERROR")
          }
        }
        if (provider === "facebook" && !next.graph_api_version)
          throw new AppError("VALIDATION_ERROR")
      }
      const settingsJson = {
        ...jsonObject(row?.settingsJson),
        [KEY]: encryptJson(
          { ...envelope, [provider]: next },
          this.config.credentialMasterKey,
          this.config.credentialKeyId,
          CONTEXT,
        ),
      }
      await tx.systemSetting.upsert({
        where: { id: SOCIAL_SETTINGS_ID },
        create: { id: SOCIAL_SETTINGS_ID, settingsJson, updatedBy: actorId },
        update: { settingsJson, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "social_authentication_settings_updated",
          targetType: "authentication_provider",
          targetId: provider,
          result: "success",
          metadataJson: {
            provider,
            enabled: next.enabled,
            revision: next.revision,
            secret_replaced: input.client_secret !== undefined,
          },
          ipAddress: audit.ipAddress ?? null,
          userAgent: audit.userAgent ?? null,
        },
      })
    })
    return this.getAdminSettings()
  }
}

function jsonObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}
}
