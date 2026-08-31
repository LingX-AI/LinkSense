import { createHash } from "node:crypto"

import {
  imageThinkingPolicySchema,
  imageThinkingStrategySchema,
  imageUnderstandingProviderSchema,
  imageUnderstandingSettingsSchema,
  imageUnderstandingSnapshotSchema,
  updateImageUnderstandingSelectionSchema,
  type ImageThinkingStrategy,
  type ImageUnderstandingProvider,
  type ImageUnderstandingSettings,
  type ImageUnderstandingSnapshot,
  type UpdateImageUnderstandingSelection,
} from "@linksense/shared"
import { z } from "zod"

import type { AppConfig } from "../../config.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { decryptJson, encryptJson } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import type { AuditContext } from "../audit/service.js"
import { KnowledgeProcessingError } from "../knowledge-processing/errors.js"
import { resolveImageThinkingStrategy } from "../knowledge-processing/image-thinking-policy.js"
import type {
  ManagedModelReferenceReader,
  ManagedModelRuntimeSettingsReader,
  ResolvedManagedModelRuntime,
} from "./model-provider-settings.js"

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const ENCRYPTED_SETTINGS_KEY = "image_understanding_settings_encrypted"
const ENCRYPTION_KEY_ID_KEY = "image_understanding_settings_key_id"
const ENCRYPTION_CONTEXT = "linksense:image-understanding-settings:v1"

export const IMAGE_UNDERSTANDING_PROMPT_VERSION = "image-alt-description-3"
export const IMAGE_UNDERSTANDING_OUTPUT_SCHEMA_VERSION =
  "image-understanding-output-2"

const storedImageUnderstandingSettingsV1Schema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  provider: imageUnderstandingProviderSchema.nullable(),
  baseUrl: z.string().max(2_048).nullable(),
  apiKey: z.string().min(1).max(16_384).nullable(),
  model: z.string().trim().min(1).max(240).nullable(),
  project: z.string().trim().min(1).max(240).nullable(),
  location: z.string().trim().min(1).max(120).nullable(),
  thinkingPolicy: imageThinkingPolicySchema,
  thinkingStrategy: imageThinkingStrategySchema.nullable(),
})

const storedImageUnderstandingSettingsSchema = z.strictObject({
  version: z.literal(2),
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  model: z.string().trim().min(1).max(240).nullable(),
})

type StoredImageUnderstandingSettings = z.infer<
  typeof storedImageUnderstandingSettingsSchema
>
type LegacyStoredImageUnderstandingSettings = z.infer<
  typeof storedImageUnderstandingSettingsV1Schema
>

export type ResolvedImageUnderstandingRuntime = {
  revision: number
  provider: ImageUnderstandingProvider
  baseUrl: string | null
  apiKey: string
  model: string
  project: string | null
  location: string | null
  thinkingStrategy: ImageThinkingStrategy
  promptVersion: typeof IMAGE_UNDERSTANDING_PROMPT_VERSION
  outputSchemaVersion: typeof IMAGE_UNDERSTANDING_OUTPUT_SCHEMA_VERSION
  configDigest: string
}

export interface ImageUnderstandingConfigurationProbe {
  probe(runtime: ResolvedImageUnderstandingRuntime): Promise<void>
}

export interface ImageUnderstandingSettingsReader {
  getSnapshot(): Promise<ImageUnderstandingSnapshot>
  resolveRuntime(
    snapshot: ImageUnderstandingSnapshot
  ): Promise<ResolvedImageUnderstandingRuntime | null>
}

export class ImageUnderstandingSettingsService
  implements ImageUnderstandingSettingsReader, ManagedModelReferenceReader
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly probe: ImageUnderstandingConfigurationProbe,
    private readonly modelSettings: ManagedModelRuntimeSettingsReader
  ) {}

  async getAdminSettings(): Promise<ImageUnderstandingSettings> {
    const stored = await this.readStoredSettings()
    const resolution = await this.resolveSelectedRuntime(stored)
    return projectAdminSettings(stored, resolution.runtime)
  }

  async getReferencedModelIds(): Promise<ReadonlySet<string>> {
    const stored = await this.readStoredSettings()
    return new Set(stored?.model ? [stored.model] : [])
  }

  async getSnapshot(): Promise<ImageUnderstandingSnapshot> {
    const stored = await this.readStoredSettings()
    const resolution = await this.resolveSelectedRuntime(stored)
    return createResolvedSnapshot(stored, resolution.runtime)
  }

  async resolveRuntime(
    snapshot: ImageUnderstandingSnapshot
  ): Promise<ResolvedImageUnderstandingRuntime | null> {
    const expected = imageUnderstandingSnapshotSchema.parse(snapshot)
    const stored = await this.readStoredSettings()
    const resolution = await this.resolveSelectedRuntime(stored)
    if (
      resolution.modelMissing &&
      stored?.enabled &&
      stored.model === expected.model
    ) {
      throw new KnowledgeProcessingError("KNOWLEDGE_IMAGE_MODEL_NOT_FOUND")
    }
    const actual = createResolvedSnapshot(stored, resolution.runtime)
    if (actual.config_digest !== expected.config_digest) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED"
      )
    }
    if (!expected.enabled) return null
    if (!resolution.runtime) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED"
      )
    }
    return resolution.runtime
  }

  async update(
    actorId: string,
    rawInput: UpdateImageUnderstandingSelection,
    context: AuditContext
  ): Promise<ImageUnderstandingSettings> {
    const input = updateImageUnderstandingSelectionSchema.parse(rawInput)
    const current = await this.readStoredSettings()
    if ((current?.revision ?? 0) !== input.expected_revision) {
      throw new AppError("CONFLICT")
    }
    const next = createStoredSettings(input, current)
    const candidateRuntime = (await this.resolveSelectedRuntime(next)).runtime
    if (next.enabled) {
      if (!candidateRuntime) {
        throw new AppError("IMAGE_UNDERSTANDING_MODEL_VALIDATION_FAILED")
      }
      try {
        await this.probe.probe(candidateRuntime)
      } catch {
        throw new AppError("IMAGE_UNDERSTANDING_MODEL_VALIDATION_FAILED")
      }
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
        select: { settingsJson: true },
      })
      const settingsJson = asObject(row?.settingsJson)
      const latest = readStoredSettings(
        settingsJson,
        this.config.credentialMasterKey,
        this.config.credentialKeyId
      )
      if ((latest?.revision ?? 0) !== input.expected_revision) {
        throw new AppError("CONFLICT")
      }
      const finalSettings = createStoredSettings(input, latest)
      const encrypted = encryptJson(
        finalSettings,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        ENCRYPTION_CONTEXT
      )
      const nextSettingsJson = {
        ...settingsJson,
        [ENCRYPTED_SETTINGS_KEY]: encrypted,
        [ENCRYPTION_KEY_ID_KEY]: this.config.credentialKeyId,
      }
      await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: {
          id: SYSTEM_SETTINGS_ID,
          settingsJson: nextSettingsJson,
          updatedBy: actorId,
        },
        update: { settingsJson: nextSettingsJson, updatedBy: actorId },
      })
      await tx.auditLog.create({
        data: {
          actorId,
          action: "image_understanding_settings_updated",
          targetType: "image_understanding",
          targetId: "link-sense",
          result: "success",
          metadataJson: {
            revision: finalSettings.revision,
            enabled: finalSettings.enabled,
            model: finalSettings.model,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return finalSettings
    })
    return projectAdminSettings(
      saved,
      (await this.resolveSelectedRuntime(saved)).runtime
    )
  }

  private async resolveSelectedRuntime(
    stored: StoredImageUnderstandingSettings | null
  ): Promise<{
    runtime: ResolvedImageUnderstandingRuntime | null
    modelMissing: boolean
  }> {
    if (!stored?.model) return { runtime: null, modelMissing: false }
    try {
      const resolved = await this.modelSettings.resolveManagedModel(
        stored.model,
        "chat"
      )
      return { runtime: createRuntime(stored, resolved), modelMissing: false }
    } catch (error) {
      return {
        runtime: null,
        modelMissing:
          error instanceof AppError && error.code === "MODEL_SELECTION_INVALID",
      }
    }
  }

  private async readStoredSettings(): Promise<StoredImageUnderstandingSettings | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { settingsJson: true },
    })
    return readStoredSettings(
      asObject(row?.settingsJson),
      this.config.credentialMasterKey,
      this.config.credentialKeyId
    )
  }
}

function createStoredSettings(
  input: z.output<typeof updateImageUnderstandingSelectionSchema>,
  current: StoredImageUnderstandingSettings | null
): StoredImageUnderstandingSettings {
  return storedImageUnderstandingSettingsSchema.parse({
    version: 2,
    revision: (current?.revision ?? 0) + 1,
    enabled: input.enabled,
    model: input.model,
  })
}

function createRuntime(
  stored: StoredImageUnderstandingSettings,
  resolved: ResolvedManagedModelRuntime
): ResolvedImageUnderstandingRuntime {
  if (
    resolved.model.kind !== "chat" ||
    !resolved.model.supports_image_input ||
    !resolved.channel.apiKey
  ) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED"
    )
  }
  const thinkingStrategy = resolveImageThinkingStrategy({
    provider: resolved.channel.provider,
    model: resolved.model.id,
  })
  if (!thinkingStrategy) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED"
    )
  }
  const snapshot = createSnapshot({
    enabled: stored.enabled,
    revision: combineRevisions(stored.revision, resolved.revision),
    provider: resolved.channel.provider,
    model: resolved.model.id,
    baseUrl: resolved.channel.baseUrl,
    thinkingStrategy,
  })
  return {
    revision: snapshot.revision,
    provider: resolved.channel.provider,
    baseUrl: resolved.channel.baseUrl,
    apiKey: resolved.channel.apiKey,
    model: resolved.model.id,
    project: resolved.channel.providerProject,
    location: resolved.channel.providerLocation,
    thinkingStrategy,
    promptVersion: IMAGE_UNDERSTANDING_PROMPT_VERSION,
    outputSchemaVersion: IMAGE_UNDERSTANDING_OUTPUT_SCHEMA_VERSION,
    configDigest: snapshot.config_digest,
  }
}

function createResolvedSnapshot(
  stored: StoredImageUnderstandingSettings | null,
  runtime: ResolvedImageUnderstandingRuntime | null
): ImageUnderstandingSnapshot {
  if (!stored || !runtime) {
    return createSnapshot({
      enabled: stored?.enabled ?? false,
      revision: stored?.revision ?? 0,
      provider: null,
      model: stored?.model ?? null,
      baseUrl: null,
      thinkingStrategy: null,
    })
  }
  return imageUnderstandingSnapshotSchema.parse({
    enabled: stored.enabled,
    revision: runtime.revision,
    provider: runtime.provider,
    model: runtime.model,
    endpoint_identifier: endpointIdentifier(runtime.provider, runtime.baseUrl),
    thinking_policy: "disabled_required",
    thinking_strategy: runtime.thinkingStrategy,
    prompt_version: runtime.promptVersion,
    output_schema_version: runtime.outputSchemaVersion,
    config_digest: runtime.configDigest,
  })
}

/** Retained for deterministic snapshot unit tests and legacy-data migration tests. */
export function createImageUnderstandingSnapshot(
  stored: LegacyStoredImageUnderstandingSettings | null
): ImageUnderstandingSnapshot {
  return createSnapshot({
    enabled: stored?.enabled ?? false,
    revision: stored?.revision ?? 0,
    provider: stored?.provider ?? null,
    model: stored?.model ?? null,
    baseUrl: stored?.baseUrl ?? null,
    thinkingStrategy: stored?.thinkingStrategy ?? null,
  })
}

function createSnapshot(input: {
  enabled: boolean
  revision: number
  provider: ImageUnderstandingProvider | null
  model: string | null
  baseUrl: string | null
  thinkingStrategy: ImageThinkingStrategy | null
}): ImageUnderstandingSnapshot {
  const snapshotWithoutDigest = {
    enabled: input.enabled,
    revision: input.revision,
    provider: input.provider,
    model: input.model,
    endpoint_identifier:
      input.provider === null
        ? null
        : endpointIdentifier(input.provider, input.baseUrl),
    thinking_policy: "disabled_required" as const,
    thinking_strategy: input.thinkingStrategy,
    prompt_version: IMAGE_UNDERSTANDING_PROMPT_VERSION,
    output_schema_version: IMAGE_UNDERSTANDING_OUTPUT_SCHEMA_VERSION,
  }
  return imageUnderstandingSnapshotSchema.parse({
    ...snapshotWithoutDigest,
    config_digest: createHash("sha256")
      .update(JSON.stringify(snapshotWithoutDigest))
      .digest("hex"),
  })
}

function endpointIdentifier(
  provider: ImageUnderstandingProvider,
  baseUrl: string | null
): string {
  return baseUrl ?? `provider-default:${provider}`
}

function projectAdminSettings(
  stored: StoredImageUnderstandingSettings | null,
  runtime: ResolvedImageUnderstandingRuntime | null
): ImageUnderstandingSettings {
  return imageUnderstandingSettingsSchema.parse({
    configured: runtime !== null,
    enabled: stored?.enabled ?? false,
    revision: stored?.revision ?? 0,
    provider: runtime?.provider ?? null,
    base_url: runtime?.baseUrl ?? null,
    api_key_configured: Boolean(runtime?.apiKey),
    model: stored?.model ?? null,
    project: runtime?.project ?? null,
    location: runtime?.location ?? null,
    thinking_policy: "disabled_required",
    thinking_strategy: runtime?.thinkingStrategy ?? null,
  })
}

function readStoredSettings(
  settingsJson: Record<string, unknown>,
  masterKey: string,
  expectedKeyId: string
): StoredImageUnderstandingSettings | null {
  const encrypted = settingsJson[ENCRYPTED_SETTINGS_KEY]
  if (encrypted === undefined) return null
  if (
    typeof encrypted !== "string" ||
    settingsJson[ENCRYPTION_KEY_ID_KEY] !== expectedKeyId
  ) {
    throw new AppError("IMAGE_UNDERSTANDING_MODEL_VALIDATION_FAILED")
  }
  try {
    const decrypted = decryptJson<unknown>(
      encrypted,
      masterKey,
      expectedKeyId,
      ENCRYPTION_CONTEXT
    )
    const current = storedImageUnderstandingSettingsSchema.safeParse(decrypted)
    if (current.success) return current.data
    const legacy = storedImageUnderstandingSettingsV1Schema.parse(decrypted)
    return storedImageUnderstandingSettingsSchema.parse({
      version: 2,
      revision: legacy.revision,
      enabled: legacy.enabled,
      model: legacy.model,
    })
  } catch {
    throw new AppError("IMAGE_UNDERSTANDING_MODEL_VALIDATION_FAILED")
  }
}

function combineRevisions(
  selectionRevision: number,
  modelRevision: number
): number {
  return selectionRevision * 1_000_003 + modelRevision
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : {}
}
