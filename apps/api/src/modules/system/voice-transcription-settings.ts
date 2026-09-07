import {
  modelIdentifierSchema,
  modelProviderBaseUrlSchema,
  updateVoiceTranscriptionSettingsSchema,
  voiceTranscriptionAvailabilitySchema,
  voiceTranscriptionProviderDefinitions,
  voiceTranscriptionProviderOptionsSchema,
  voiceTranscriptionProviderSchema,
  voiceTranscriptionSettingsSchema,
  type UpdateVoiceTranscriptionSettings,
  type VoiceTranscriptionAvailability,
  type VoiceTranscriptionSettings,
} from "@linksense/shared"
import { z } from "zod"

import {
  createVoiceTranscriptionRunner,
  VoiceTranscriptionProviderError,
  type VoiceTranscriptionRunner,
  type VoiceTranscriptionRuntime,
} from "../../adapters/voice-transcription-provider.js"
import type { AppConfig } from "../../config.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { decryptJson, encryptJson } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import type { AuditContext } from "../audit/service.js"
import type {
  VoiceTranscriptionInput,
  VoiceTranscriptionProvider,
} from "../voice/service.js"

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const ENCRYPTED_SETTINGS_KEY = "voice_transcription_settings_encrypted"
const ENCRYPTION_KEY_ID_KEY = "voice_transcription_settings_key_id"
const ENCRYPTION_CONTEXT = "linksense:voice-transcription-settings:v1"

const storedVoiceTranscriptionSettingsSchema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  provider: voiceTranscriptionProviderSchema.nullable(),
  providerOptions: voiceTranscriptionProviderOptionsSchema,
  baseUrl: modelProviderBaseUrlSchema.nullable(),
  apiKey: z.string().min(1).max(16_384).nullable(),
  model: modelIdentifierSchema.nullable(),
})

type StoredVoiceTranscriptionSettings = z.infer<
  typeof storedVoiceTranscriptionSettingsSchema
>

export class VoiceTranscriptionSettingsService
  implements VoiceTranscriptionProvider
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly runner: VoiceTranscriptionRunner =
      createVoiceTranscriptionRunner(),
  ) {}

  async getAdminSettings(): Promise<VoiceTranscriptionSettings> {
    return projectAdminSettings(await this.readStoredSettings())
  }

  async getAvailability(): Promise<VoiceTranscriptionAvailability> {
    return voiceTranscriptionAvailabilitySchema.parse({
      available: isRuntimeAvailable(await this.readStoredSettings()),
    })
  }

  async update(
    actorId: string,
    rawInput: UpdateVoiceTranscriptionSettings,
    context: AuditContext,
  ): Promise<VoiceTranscriptionSettings> {
    const input = updateVoiceTranscriptionSettingsSchema.parse(rawInput)
    const stored = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
        select: { settingsJson: true },
      })
      const currentRaw = asObject(row?.settingsJson)
      const current = readStoredSettings(
        currentRaw,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
      )
      if ((current?.revision ?? 0) !== input.expected_revision) {
        throw new AppError("CONFLICT")
      }
      const next = createStoredSettings(input, current)
      if (next.enabled && !next.apiKey) throw new AppError("VALIDATION_ERROR")

      const settingsJson = {
        ...currentRaw,
        [ENCRYPTED_SETTINGS_KEY]: encryptJson(
          next,
          this.config.credentialMasterKey,
          this.config.credentialKeyId,
          ENCRYPTION_CONTEXT,
        ),
        [ENCRYPTION_KEY_ID_KEY]: this.config.credentialKeyId,
      }
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson,
          updatedBy: actorId,
        },
        update: { settingsJson, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "voice_transcription_settings_updated",
          targetType: "voice_transcription",
          targetId: "link-sense",
          result: "success",
          metadataJson: {
            revision: next.revision,
            enabled: next.enabled,
            provider: next.provider,
            model: next.model,
            api_key_replaced: input.api_key !== undefined,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return next
    })
    return projectAdminSettings(stored)
  }

  async *streamTranscription(
    input: VoiceTranscriptionInput,
  ): AsyncGenerator<string> {
    const text = (await this.runner(await this.resolveRuntime(), input)).trim()
    if (!text) throw new VoiceTranscriptionProviderError("no_content")
    yield text
  }

  private async resolveRuntime(): Promise<VoiceTranscriptionRuntime> {
    const stored = await this.readStoredSettings()
    if (!isRuntimeAvailable(stored)) {
      throw new VoiceTranscriptionProviderError("not_configured")
    }
    return {
      provider: stored.provider,
      providerOptions: stored.providerOptions,
      baseUrl: stored.baseUrl,
      apiKey: stored.apiKey,
      model: stored.model,
    }
  }

  private async readStoredSettings(): Promise<StoredVoiceTranscriptionSettings | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { settingsJson: true },
    })
    return readStoredSettings(
      asObject(row?.settingsJson),
      this.config.credentialMasterKey,
      this.config.credentialKeyId,
    )
  }
}

function isRuntimeAvailable(
  stored: StoredVoiceTranscriptionSettings | null,
): stored is StoredVoiceTranscriptionSettings & {
  provider: NonNullable<StoredVoiceTranscriptionSettings["provider"]>
  baseUrl: string
  apiKey: string
  model: string
} {
  return Boolean(
    stored?.enabled &&
      stored.provider &&
      stored.baseUrl &&
      stored.apiKey &&
      stored.model &&
      (stored.provider !== "azure_openai" ||
        stored.providerOptions.api_version),
  )
}

function createStoredSettings(
  input: z.output<typeof updateVoiceTranscriptionSettingsSchema>,
  current: StoredVoiceTranscriptionSettings | null,
): StoredVoiceTranscriptionSettings {
  const providerChanged = current?.provider !== input.provider
  return storedVoiceTranscriptionSettingsSchema.parse({
    version: 1,
    revision: (current?.revision ?? 0) + 1,
    enabled: input.enabled,
    provider: input.provider,
    providerOptions: input.provider_options,
    baseUrl: input.base_url,
    apiKey: input.api_key ?? (providerChanged ? null : current?.apiKey) ?? null,
    model: input.model,
  })
}

function readStoredSettings(
  raw: Record<string, unknown>,
  masterKey: string,
  expectedKeyId: string,
): StoredVoiceTranscriptionSettings | null {
  const encrypted = raw[ENCRYPTED_SETTINGS_KEY]
  const keyId = raw[ENCRYPTION_KEY_ID_KEY]
  if (encrypted === undefined && keyId === undefined) return null
  if (typeof encrypted !== "string" || typeof keyId !== "string") {
    throw new Error("voice transcription settings envelope is incomplete")
  }
  if (keyId !== expectedKeyId) {
    throw new Error("voice transcription settings encryption key mismatch")
  }
  return storedVoiceTranscriptionSettingsSchema.parse(
    decryptJson<unknown>(encrypted, masterKey, expectedKeyId, ENCRYPTION_CONTEXT),
  )
}

function projectAdminSettings(
  stored: StoredVoiceTranscriptionSettings | null,
): VoiceTranscriptionSettings {
  return voiceTranscriptionSettingsSchema.parse({
    configured: Boolean(stored?.apiKey),
    revision: stored?.revision ?? 0,
    enabled: stored?.enabled ?? false,
    provider: stored?.provider ?? null,
    provider_options:
      stored?.providerOptions ?? voiceTranscriptionProviderOptionsSchema.parse({}),
    base_url: stored?.baseUrl ?? null,
    api_key_configured: Boolean(stored?.apiKey),
    model: stored?.model ?? null,
    providers: voiceTranscriptionProviderDefinitions,
  })
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {}
}
