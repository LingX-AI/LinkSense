import {
  sensitiveDataSettingsSchema,
  updateSensitiveDataSettingsSchema,
  type SensitiveDataSettings,
  type UpdateSensitiveDataSettings,
} from "@linksense/shared"
import { z } from "zod"

import type { AppConfig } from "../../config.js"
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"
import { decryptJson, encryptJson, sha256 } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import type { AuditContext } from "../audit/service.js"
import type { ModelProviderSettingsService } from "../system/model-provider-settings.js"

const systemSettingsId = "00000000-0000-4000-8000-000000000001"
const settingsKey = "sensitive_data_settings_encrypted"
const encryptionContext = "linksense-sensitive-data-settings"
const storedSettingsSchema = sensitiveDataSettingsSchema
  .omit({ decision_key_configured: true })
  .extend({
    decisionApiKey: z.string().nullable(),
    modelBindings: z.record(z.string(), z.string()),
  })

export type StoredSensitiveDataSettings = z.infer<typeof storedSettingsSchema>

const defaults: StoredSensitiveDataSettings = {
  enabled: false,
  revision: 0,
  inspection: "turn_start",
  local_model_ids: [],
  default_model_id: null,
  decision_endpoint: null,
  decision_model_id: null,
  detection_prompt: null,
  decisionApiKey: null,
  modelBindings: {},
}

export class SensitiveDataSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Pick<AppConfig, "credentialMasterKey" | "credentialKeyId">,
    private readonly models: Pick<ModelProviderSettingsService, "getAdminSettings">,
  ) {}

  async read(): Promise<StoredSensitiveDataSettings> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: systemSettingsId },
      select: { settingsJson: true },
    })
    return this.decode(objectSettings(row?.settingsJson))
  }

  async getAdminSettings(): Promise<SensitiveDataSettings> {
    return projectSettings(await this.read())
  }

  async update(
    actorId: string,
    input: UpdateSensitiveDataSettings,
    audit: AuditContext,
  ): Promise<SensitiveDataSettings> {
    const { expected_revision, decision_api_key, detection_prompt, ...settings } =
      updateSensitiveDataSettingsSchema.parse(input)
    const providers = settings.local_model_ids.length > 0
      ? (await this.models.getAdminSettings()).providers
      : []
    const modelBindings = Object.fromEntries(settings.local_model_ids.map((id) => {
      const channel = providers.find((provider) =>
        provider.models.some((model) => model.kind === "chat" && model.id === id),
      )
      if (!channel?.base_url || !channel.api_key_configured) {
        throw new AppError("VALIDATION_ERROR")
      }
      return [id, sensitiveDataModelBinding(channel.id, channel.base_url)]
    }))
    const stored = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))`
      const row = await tx.systemSetting.findUnique({
        where: { id: systemSettingsId },
        select: { settingsJson: true },
      })
      const raw = objectSettings(row?.settingsJson)
      const current = this.decode(raw)
      if (current.revision !== expected_revision) throw new AppError("CONFLICT")
      const next: StoredSensitiveDataSettings = {
        ...settings,
        detection_prompt: detection_prompt === undefined ? current.detection_prompt : detection_prompt,
        revision: current.revision + 1,
        decisionApiKey: decision_api_key ?? (settings.decision_endpoint === current.decision_endpoint &&
          settings.decision_model_id === current.decision_model_id ? current.decisionApiKey : null),
        modelBindings,
      }
      const settingsJson = {
        ...raw,
        [settingsKey]: encryptJson(next, this.config.credentialMasterKey, this.config.credentialKeyId, encryptionContext),
      }
      await tx.systemSetting.upsert({
        where: { id: systemSettingsId },
        create: { id: systemSettingsId, settingsJson, updatedBy: actorId },
        update: { settingsJson, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "sensitive_data_settings_updated",
          targetType: "system_settings",
          targetId: systemSettingsId,
          result: "success",
          metadataJson: { enabled: next.enabled, inspection: next.inspection, revision: next.revision },
          ipAddress: audit.ipAddress ?? null,
          userAgent: audit.userAgent ?? null,
        },
      })
      return next
    })
    return projectSettings(stored)
  }

  private decode(raw: Prisma.JsonObject): StoredSensitiveDataSettings {
    if (raw[settingsKey] === undefined) return defaults
    return storedSettingsSchema.parse(decryptJson<unknown>(
      z.string().parse(raw[settingsKey]), this.config.credentialMasterKey,
      this.config.credentialKeyId, encryptionContext,
    ))
  }
}

function objectSettings(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}
}

function projectSettings(stored: StoredSensitiveDataSettings): SensitiveDataSettings {
  return {
    enabled: stored.enabled,
    revision: stored.revision,
    inspection: stored.inspection,
    local_model_ids: stored.local_model_ids,
    default_model_id: stored.default_model_id,
    decision_endpoint: stored.decision_endpoint,
    decision_model_id: stored.decision_model_id,
    detection_prompt: stored.detection_prompt,
    decision_key_configured: stored.decisionApiKey !== null,
  }
}

export function sensitiveDataModelBinding(channelId: string, baseUrl: string): string {
  return sha256(JSON.stringify([channelId, new URL(baseUrl).href]))
}
