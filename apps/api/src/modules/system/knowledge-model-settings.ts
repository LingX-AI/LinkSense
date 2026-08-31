import {
  knowledgeModelSettingsSchema,
  modelIdentifierSchema,
  modelProviderBaseUrlSchema,
  modelTokenPricingSchema,
  updateKnowledgeModelSettingsSchema,
  type KnowledgeModelSettings,
  type ModelTokenPricing,
  type UpdateKnowledgeModelSettings,
} from "@linksense/shared"
import { z } from "zod"

import {
  requireFullAppConfig,
  type AppConfig,
  type FullAppConfig,
} from "../../config.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { decryptJson, encryptJson } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import type { AuditContext } from "../audit/service.js"
import { createEmbeddingProfileHash } from "../knowledge-processing/embedding.js"
import { isKnowledgeProcessingError } from "../knowledge-processing/errors.js"
import type {
  ManagedModelReferenceReader,
  ManagedModelRuntimeSettingsReader,
  ResolvedManagedModelRuntime,
} from "./model-provider-settings.js"

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const ENCRYPTED_SETTINGS_KEY = "knowledge_model_settings_encrypted"
const ENCRYPTION_KEY_ID_KEY = "knowledge_model_settings_key_id"
const ENCRYPTION_CONTEXT = "linksense:knowledge-model-settings:v1"

const storedKnowledgeModelSettingsV1Schema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().positive(),
  embedding: z.strictObject({
    baseUrl: modelProviderBaseUrlSchema,
    apiKey: z.string().min(1).max(16_384).nullable(),
    model: modelIdentifierSchema,
  }),
  rerank: z.strictObject({
    enabled: z.boolean(),
    baseUrl: modelProviderBaseUrlSchema.nullable(),
    apiKey: z.string().min(1).max(16_384).nullable(),
    model: modelIdentifierSchema.nullable(),
    maximumInputTokens: z.number().int().positive().max(1_000_000),
    timeoutMs: z.number().int().positive().max(300_000),
  }),
})

const storedKnowledgeModelSettingsV2Schema = z.strictObject({
  version: z.literal(2),
  revision: z.number().int().positive(),
  embedding: z.strictObject({
    baseUrl: modelProviderBaseUrlSchema,
    apiKey: z.string().min(1).max(16_384).nullable(),
    model: modelIdentifierSchema,
    pricing: modelTokenPricingSchema,
  }),
  rerank: z.strictObject({
    enabled: z.boolean(),
    baseUrl: modelProviderBaseUrlSchema.nullable(),
    apiKey: z.string().min(1).max(16_384).nullable(),
    model: modelIdentifierSchema.nullable(),
    pricing: modelTokenPricingSchema,
    maximumInputTokens: z.number().int().positive().max(1_000_000),
    timeoutMs: z.number().int().positive().max(300_000),
  }),
})

const storedKnowledgeModelSettingsSchema = z.strictObject({
  version: z.literal(3),
  revision: z.number().int().positive(),
  embeddingModel: modelIdentifierSchema,
  rerankEnabled: z.boolean(),
  rerankModel: modelIdentifierSchema.nullable(),
})

type StoredKnowledgeModelSettings = z.infer<
  typeof storedKnowledgeModelSettingsSchema
>

export type ResolvedKnowledgeModelRuntime = {
  revision: number
  embedding: {
    baseUrl: string
    apiKey?: string
    model: string
    dimensions: number
    maximumInputTokens: number
    profileHash: string
    pricing: ModelTokenPricing
  }
  rerank: {
    baseUrl: string
    apiKey?: string
    model: string
    maximumInputTokens: number
    timeoutMs: number
    pricing: ModelTokenPricing
  } | null
}

export interface KnowledgeModelConfigurationProbe {
  probe(runtime: ResolvedKnowledgeModelRuntime): Promise<void>
}

export interface KnowledgeModelSettingsReader {
  resolveRuntime(): Promise<ResolvedKnowledgeModelRuntime>
  getCurrentEmbeddingProfileHash?(): string | undefined
}

export class KnowledgeModelSettingsService
  implements KnowledgeModelSettingsReader, ManagedModelReferenceReader
{
  currentEmbeddingProfileHash: string | undefined
  private readonly config: FullAppConfig

  constructor(
    private readonly prisma: PrismaClient,
    config: AppConfig,
    private readonly probe: KnowledgeModelConfigurationProbe,
    private readonly modelSettings: ManagedModelRuntimeSettingsReader
  ) {
    this.config = requireFullAppConfig(config)
    this.currentEmbeddingProfileHash = undefined
  }

  async getAdminSettings(): Promise<KnowledgeModelSettings> {
    const stored = await this.readStoredSettings()
    this.currentEmbeddingProfileHash = stored
      ? createEmbeddingProfileHash(
          stored.embeddingModel,
          this.config.knowledge.embedding.dimensions
        )
      : undefined
    return projectAdminSettings(stored, this.config)
  }

  getCurrentEmbeddingProfileHash(): string | undefined {
    return this.currentEmbeddingProfileHash
  }

  async getReferencedModelIds(): Promise<ReadonlySet<string>> {
    const stored = await this.readStoredSettings()
    return new Set(
      stored
        ? [
            stored.embeddingModel,
            ...(stored.rerankModel ? [stored.rerankModel] : []),
          ]
        : []
    )
  }

  async resolveRuntime(): Promise<ResolvedKnowledgeModelRuntime> {
    const stored = await this.readStoredSettings()
    if (!stored) throw new AppError("KNOWLEDGE_MODEL_NOT_CONFIGURED")
    const runtime = await this.projectRuntime(stored)
    this.currentEmbeddingProfileHash = runtime.embedding.profileHash
    return runtime
  }

  async update(
    actorId: string,
    rawInput: UpdateKnowledgeModelSettings,
    context: AuditContext
  ): Promise<KnowledgeModelSettings> {
    const input = updateKnowledgeModelSettingsSchema.parse(rawInput)
    const current = await this.readStoredSettings()
    if ((current?.revision ?? 0) !== input.expected_revision) {
      throw new AppError("CONFLICT")
    }

    const candidate = createStoredSettings(input, current)
    try {
      await this.probe.probe(await this.projectRuntime(candidate))
    } catch (error) {
      throw mapKnowledgeModelProbeError(error)
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
          action: "knowledge_model_settings_updated",
          targetType: "knowledge_model",
          targetId: "link-sense",
          result: "success",
          metadataJson: {
            revision: finalSettings.revision,
            embedding_model: finalSettings.embeddingModel,
            rerank_enabled: finalSettings.rerankEnabled,
            rerank_model: finalSettings.rerankModel,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return finalSettings
    })

    this.currentEmbeddingProfileHash = createEmbeddingProfileHash(
      saved.embeddingModel,
      this.config.knowledge.embedding.dimensions
    )
    return projectAdminSettings(saved, this.config)
  }

  private async projectRuntime(
    stored: StoredKnowledgeModelSettings
  ): Promise<ResolvedKnowledgeModelRuntime> {
    const [embedding, rerank] = await Promise.all([
      this.modelSettings.resolveManagedModel(
        stored.embeddingModel,
        "embedding"
      ),
      stored.rerankEnabled && stored.rerankModel
        ? this.modelSettings.resolveManagedModel(stored.rerankModel, "reranker")
        : Promise.resolve(null),
    ])
    return projectRuntime(stored, embedding, rerank, this.config)
  }

  private async readStoredSettings(): Promise<StoredKnowledgeModelSettings | null> {
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

function mapKnowledgeModelProbeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return new AppError("KNOWLEDGE_MODEL_VALIDATION_FAILED")
  }
  if (!isKnowledgeProcessingError(error)) {
    return new AppError("KNOWLEDGE_MODEL_VALIDATION_FAILED")
  }
  switch (error.code) {
    case "KNOWLEDGE_EXTERNAL_SERVICE_AUTHENTICATION_FAILED":
      return new AppError("KNOWLEDGE_MODEL_AUTHENTICATION_FAILED")
    case "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE":
      return new AppError("KNOWLEDGE_MODEL_SERVICE_UNAVAILABLE")
    case "KNOWLEDGE_EXTERNAL_RESPONSE_INVALID":
    case "KNOWLEDGE_EMBEDDING_RESPONSE_INVALID":
    case "EMBEDDING_DIMENSION_MISMATCH":
    case "KNOWLEDGE_RERANK_RESPONSE_INVALID":
      return new AppError("KNOWLEDGE_MODEL_RESPONSE_INVALID")
    default:
      return new AppError("KNOWLEDGE_MODEL_VALIDATION_FAILED")
  }
}

function createStoredSettings(
  input: z.output<typeof updateKnowledgeModelSettingsSchema>,
  current: StoredKnowledgeModelSettings | null
): StoredKnowledgeModelSettings {
  return storedKnowledgeModelSettingsSchema.parse({
    version: 3,
    revision: (current?.revision ?? 0) + 1,
    embeddingModel: input.embedding.model,
    rerankEnabled: input.rerank.enabled,
    rerankModel: input.rerank.model,
  })
}

function projectRuntime(
  stored: StoredKnowledgeModelSettings,
  embedding: ResolvedManagedModelRuntime,
  rerank: ResolvedManagedModelRuntime | null,
  config: FullAppConfig
): ResolvedKnowledgeModelRuntime {
  const embeddingModel = embedding.model
  const rerankModel = rerank?.model ?? null
  if (embeddingModel.kind !== "embedding") {
    throw new AppError("KNOWLEDGE_MODEL_NOT_CONFIGURED")
  }
  if (rerankModel !== null && rerankModel.kind !== "reranker") {
    throw new AppError("KNOWLEDGE_MODEL_NOT_CONFIGURED")
  }
  return {
    revision: combineRevisions(
      stored.revision,
      embedding.revision,
      rerank?.revision
    ),
    embedding: {
      baseUrl: embedding.channel.baseUrl,
      ...(embedding.channel.apiKey ? { apiKey: embedding.channel.apiKey } : {}),
      model: embedding.model.id,
      dimensions: config.knowledge.embedding.dimensions,
      maximumInputTokens: config.knowledge.embedding.maxInputTokens,
      profileHash: createEmbeddingProfileHash(
        embedding.model.id,
        config.knowledge.embedding.dimensions
      ),
      pricing: inputOnlyPricing(embeddingModel.input_price_per_million),
    },
    rerank:
      rerank === null || rerankModel === null
        ? null
        : {
            baseUrl: rerank.channel.baseUrl,
            ...(rerank.channel.apiKey ? { apiKey: rerank.channel.apiKey } : {}),
            model: rerank.model.id,
            maximumInputTokens: config.knowledge.rerank.maxInputTokens,
            timeoutMs: config.knowledge.rerank.timeoutMs,
            pricing: inputOnlyPricing(rerankModel.input_price_per_million),
          },
  }
}

function combineRevisions(...values: Array<number | undefined>): number {
  let result = 0
  for (const value of values) {
    result = result * 1_000_003 + (value ?? 0)
  }
  return result
}

function projectAdminSettings(
  stored: StoredKnowledgeModelSettings | null,
  config: FullAppConfig
): KnowledgeModelSettings {
  return knowledgeModelSettingsSchema.parse({
    revision: stored?.revision ?? 0,
    embedding: {
      configured: stored !== null,
      model: stored?.embeddingModel ?? null,
      dimensions: config.knowledge.embedding.dimensions,
      maximum_input_tokens: config.knowledge.embedding.maxInputTokens,
    },
    rerank: {
      enabled: stored?.rerankEnabled ?? false,
      model: stored?.rerankModel ?? null,
      maximum_input_tokens: config.knowledge.rerank.maxInputTokens,
      timeout_ms: config.knowledge.rerank.timeoutMs,
    },
  })
}

function readStoredSettings(
  settingsJson: Record<string, unknown>,
  masterKey: string,
  expectedKeyId: string
): StoredKnowledgeModelSettings | null {
  const encrypted = settingsJson[ENCRYPTED_SETTINGS_KEY]
  const keyId = settingsJson[ENCRYPTION_KEY_ID_KEY]
  if (encrypted === undefined && keyId === undefined) return null
  if (typeof encrypted !== "string" || keyId !== expectedKeyId) {
    throw new AppError("KNOWLEDGE_MODEL_VALIDATION_FAILED")
  }
  try {
    const decrypted = decryptJson<unknown>(
      encrypted,
      masterKey,
      expectedKeyId,
      ENCRYPTION_CONTEXT
    )
    const current = storedKnowledgeModelSettingsSchema.safeParse(decrypted)
    if (current.success) return current.data
    const version2 = storedKnowledgeModelSettingsV2Schema.safeParse(decrypted)
    const legacy = version2.success
      ? version2.data
      : storedKnowledgeModelSettingsV1Schema.parse(decrypted)
    return storedKnowledgeModelSettingsSchema.parse({
      version: 3,
      revision: legacy.revision,
      embeddingModel: legacy.embedding.model,
      rerankEnabled: legacy.rerank.enabled,
      rerankModel: legacy.rerank.model,
    })
  } catch {
    throw new AppError("KNOWLEDGE_MODEL_VALIDATION_FAILED")
  }
}

function inputOnlyPricing(inputPricePerMillion: string): ModelTokenPricing {
  return {
    input_price_per_million: inputPricePerMillion,
    cached_input_price_per_million: inputPricePerMillion,
    output_price_per_million: "0",
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : {}
}
