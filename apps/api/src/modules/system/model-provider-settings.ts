import { createHash } from "node:crypto"

import {
  deleteModelProviderSchema,
  deleteModelProviderModelSchema,
  genericModelReasoningProfile,
  isConversationModel,
  managedPricedModelSchema,
  managedModelSchema,
  modelIdentifierSchema,
  modelTokenPricingSchema,
  modelProviderBaseUrlSchema,
  modelProviderIdentifierSchema,
  modelProviderNameSchema,
  modelProviderProtocolModeSchema,
  modelServiceProviderSchema,
  modelProviderSettingsSchema,
  reasoningEffortSchema,
  updateModelAvailabilitySchema,
  updateModelPreferenceSchema,
  updateModelProviderSettingsSchema,
  type ManagedModel,
  type ManagedConversationModel,
  type ManagedModelKind,
  type ManagedPricedModel,
  type DeleteModelProvider,
  type DeleteModelProviderModel,
  type DiscoveredModelCatalog,
  type ModelPreference,
  type ModelProviderProtocolMode,
  type ModelProviderSettings,
  type ModelTokenPricing,
  type ReasoningEffort,
  type UpdateModelAvailability,
  type UpdateModelPreference,
  type UpdateModelProviderSettings,
} from "@linksense/shared"
import { z } from "zod"

import type { AppConfig } from "../../config.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { decryptJson, encryptJson } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import type { AuditContext } from "../audit/service.js"
import {
  HttpModelProviderCatalogClient,
  parseOpenAiCompatibleModelCatalog,
  type ModelProviderCatalogClient,
} from "./model-provider-catalog.js"

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const ENCRYPTED_SETTINGS_KEY = "model_provider_settings_encrypted"
const ENCRYPTION_KEY_ID_KEY = "model_provider_settings_key_id"
const ENCRYPTION_CONTEXT = "linksense:model-provider-settings:v1"
const LEGACY_KNOWLEDGE_SETTINGS_KEY = "knowledge_model_settings_encrypted"
const LEGACY_KNOWLEDGE_KEY_ID_KEY = "knowledge_model_settings_key_id"
const LEGACY_KNOWLEDGE_CONTEXT = "linksense:knowledge-model-settings:v1"
const LEGACY_IMAGE_SETTINGS_KEY = "image_understanding_settings_encrypted"
const LEGACY_IMAGE_KEY_ID_KEY = "image_understanding_settings_key_id"
const LEGACY_IMAGE_CONTEXT = "linksense:image-understanding-settings:v1"
type ParsedModelProviderSettingsUpdate = z.infer<
  typeof updateModelProviderSettingsSchema
>
type ParsedManagedModelProviderUpdate =
  ParsedModelProviderSettingsUpdate["providers"][number]

const legacyKnowledgeSettingsSchema = z.object({
  revision: z.number().int().positive(),
  embedding: z.object({
    baseUrl: modelProviderBaseUrlSchema,
    apiKey: z.string().min(1).max(16_384).nullable(),
    model: modelIdentifierSchema,
    pricing: z.object({ input_price_per_million: z.string() }).optional(),
  }),
  rerank: z.object({
    enabled: z.boolean(),
    baseUrl: modelProviderBaseUrlSchema.nullable(),
    apiKey: z.string().min(1).max(16_384).nullable(),
    model: modelIdentifierSchema.nullable(),
    pricing: z.object({ input_price_per_million: z.string() }).optional(),
  }),
})

const legacyImageSettingsSchema = z.object({
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  provider: z
    .enum([
      "openai",
      "azure_openai",
      "anthropic",
      "google",
      "google_vertex",
      "alibaba",
      "deepseek",
      "openrouter",
      "openai_compatible",
    ])
    .nullable(),
  baseUrl: z.string().max(2_048).nullable(),
  apiKey: z.string().min(1).max(16_384).nullable(),
  model: modelIdentifierSchema.nullable(),
  project: z.string().trim().min(1).max(240).nullable(),
  location: z.string().trim().min(1).max(120).nullable(),
})

const legacyManagedPricedModelSchema = z.strictObject({
  ...managedModelSchema.shape,
  ...modelTokenPricingSchema.shape,
})

const legacyV6ProviderFields = {
  provider: modelServiceProviderSchema,
  provider_project: z.string().trim().min(1).max(240).nullable(),
  provider_location: z.string().trim().min(1).max(120).nullable(),
} as const

const legacyV6ModelIdentity = {
  id: modelIdentifierSchema,
  display_name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  ...legacyV6ProviderFields,
  input_price_per_million:
    modelTokenPricingSchema.shape.input_price_per_million,
} as const

const legacyV6ManagedModelSchema = z.union([
  z.strictObject({
    ...legacyV6ModelIdentity,
    kind: z.literal("chat"),
    cached_input_price_per_million:
      modelTokenPricingSchema.shape.cached_input_price_per_million,
    output_price_per_million:
      modelTokenPricingSchema.shape.output_price_per_million,
    supports_image_input: z.boolean(),
    supported_reasoning_efforts: z.array(reasoningEffortSchema).min(1),
    default_reasoning_effort: reasoningEffortSchema,
  }),
  z.strictObject({
    ...legacyV6ModelIdentity,
    kind: z.literal("embedding"),
  }),
  z.strictObject({
    ...legacyV6ModelIdentity,
    kind: z.literal("reranker"),
  }),
])

const storedModelProviderSettingsV1Schema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().positive(),
  baseUrl: modelProviderBaseUrlSchema,
  apiKey: z.string().min(1).max(16_384),
  models: z.array(managedModelSchema).min(1).max(100),
  defaultModel: z.string().min(1).max(240),
})

const storedModelProviderSettingsV2Schema = z.strictObject({
  version: z.literal(2),
  revision: z.number().int().positive(),
  baseUrl: modelProviderBaseUrlSchema,
  protocolMode: modelProviderProtocolModeSchema,
  apiKey: z.string().min(1).max(16_384),
  models: z.array(managedModelSchema).min(1).max(100),
  defaultModel: z.string().min(1).max(240),
})

const storedModelProviderV3Schema = z.strictObject({
  id: modelProviderIdentifierSchema,
  baseUrl: modelProviderBaseUrlSchema,
  protocolMode: modelProviderProtocolModeSchema,
  apiKey: z.string().min(1).max(16_384),
  models: z.array(managedModelSchema).min(1).max(100),
})

const storedModelProviderSettingsV3Schema = z.strictObject({
  version: z.literal(3),
  revision: z.number().int().positive(),
  providers: z.array(storedModelProviderV3Schema).min(1).max(20),
  defaultModel: z.string().min(1).max(240),
})

const storedModelProviderV4Schema = z.strictObject({
  id: modelProviderIdentifierSchema,
  name: modelProviderNameSchema.nullable(),
  baseUrl: modelProviderBaseUrlSchema,
  protocolMode: modelProviderProtocolModeSchema,
  apiKey: z.string().min(1).max(16_384),
  models: z.array(managedModelSchema).min(1).max(100),
})

const storedModelProviderSettingsV4Schema = z.strictObject({
  version: z.literal(4),
  revision: z.number().int().positive(),
  providers: z.array(storedModelProviderV4Schema).min(1).max(20),
  defaultModel: z.string().min(1).max(240),
})

const storedModelProviderV5Schema = z.strictObject({
  id: modelProviderIdentifierSchema,
  name: modelProviderNameSchema.nullable(),
  baseUrl: modelProviderBaseUrlSchema,
  protocolMode: modelProviderProtocolModeSchema,
  apiKey: z.string().min(1).max(16_384),
  models: z.array(legacyManagedPricedModelSchema).min(1).max(100),
})

const storedModelProviderSettingsV5Schema = z.strictObject({
  version: z.literal(5),
  revision: z.number().int().positive(),
  providers: z.array(storedModelProviderV5Schema).min(1).max(20),
  defaultModel: z.string().min(1).max(240),
})

const storedModelProviderV6Schema = z.strictObject({
  id: modelProviderIdentifierSchema,
  name: modelProviderNameSchema.nullable(),
  baseUrl: modelProviderBaseUrlSchema,
  protocolMode: modelProviderProtocolModeSchema,
  apiKey: z.string().min(1).max(16_384).nullable(),
  models: z.array(legacyV6ManagedModelSchema).min(1).max(100),
})

const storedModelProviderSettingsV6Schema = z.strictObject({
  version: z.literal(6),
  revision: z.number().int().positive(),
  providers: z.array(storedModelProviderV6Schema).min(1).max(20),
  defaultModel: modelIdentifierSchema.nullable(),
})

const storedModelProviderSchema = z.strictObject({
  id: modelProviderIdentifierSchema,
  name: modelProviderNameSchema.nullable(),
  provider: modelServiceProviderSchema,
  providerProject: z.string().trim().min(1).max(240).nullable(),
  providerLocation: z.string().trim().min(1).max(120).nullable(),
  baseUrl: modelProviderBaseUrlSchema,
  protocolMode: modelProviderProtocolModeSchema,
  apiKey: z.string().min(1).max(16_384).nullable(),
  models: z.array(managedPricedModelSchema).max(100),
})

const storedModelProviderSettingsV7Schema = z.strictObject({
  version: z.literal(7),
  revision: z.number().int().positive(),
  providers: z.array(storedModelProviderSchema).min(1).max(20),
  defaultModel: modelIdentifierSchema.nullable(),
})

const storedModelProviderSettingsV8Schema = z.strictObject({
  version: z.literal(8),
  revision: z.number().int().positive(),
  providers: z.array(storedModelProviderSchema).min(1).max(20),
  defaultModel: modelIdentifierSchema.nullable(),
  titleModel: modelIdentifierSchema.nullable(),
})

const storedModelProviderSettingsSchema = z.object({
  version: z.literal(9),
  revision: z.number().int().positive(),
  providers: z.array(storedModelProviderSchema).min(1).max(20),
  defaultModel: modelIdentifierSchema.nullable(),
  titleModel: modelIdentifierSchema.nullable(),
})

type StoredModelProviderSettings = z.infer<
  typeof storedModelProviderSettingsSchema
>

export type ResolvedModelRuntime = {
  model: string
  reasoningEffort: ReasoningEffort
  provider: {
    revision: number
    baseUrl: string
    protocolMode: ModelProviderProtocolMode
    apiKey: string
    pricing?: ModelTokenPricing
    modelContextWindow?: number
    modelAutoCompactTokenLimit?: number
  }
}

export type ResolvedModelTransitionRuntime = Omit<
  ResolvedModelRuntime,
  "reasoningEffort"
>

export type ResolvedManagedModelRuntime = {
  revision: number
  model: ManagedPricedModel
  channel: {
    id: string
    name: string | null
    provider: z.infer<typeof modelServiceProviderSchema>
    providerProject: string | null
    providerLocation: string | null
    baseUrl: string
    protocolMode: ModelProviderProtocolMode
    apiKey?: string
  }
}

export interface ManagedModelRuntimeSettingsReader {
  resolveManagedModel(
    modelId: string,
    expectedKind?: ManagedModelKind
  ): Promise<ResolvedManagedModelRuntime>
}

export interface TaskTitleModelSettingsReader {
  resolveTaskTitleModel(): Promise<ResolvedManagedModelRuntime | null>
}

export interface ManagedModelReferenceReader {
  getReferencedModelIds(): Promise<ReadonlySet<string>>
}

export interface ModelRuntimeSettingsReader {
  resolveRuntime(
    userId: string,
    conversationId?: string
  ): Promise<ResolvedModelRuntime>
  resolveRuntimeForSelection(
    model: string,
    reasoningEffort: ReasoningEffort
  ): Promise<ResolvedModelRuntime>
  resolveModelTransitionRuntime(
    model: string
  ): Promise<ResolvedModelTransitionRuntime>
}

export class ModelProviderSettingsService
  implements
    ModelRuntimeSettingsReader,
    ManagedModelRuntimeSettingsReader,
    TaskTitleModelSettingsReader
{
  private readonly referenceReaders: ManagedModelReferenceReader[] = []

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly modelCatalogClient: ModelProviderCatalogClient =
      new HttpModelProviderCatalogClient(
        undefined,
        undefined,
        config.nodeEnv === "development"
      )
  ) {}

  registerReferenceReader(reader: ManagedModelReferenceReader): void {
    this.referenceReaders.push(reader)
  }

  async getAdminSettings(): Promise<ModelProviderSettings> {
    const stored = await this.readStoredSettings()
    return projectAdminSettings(stored)
  }

  async discoverModels(
    providerId: string,
    signal?: AbortSignal
  ): Promise<DiscoveredModelCatalog> {
    const id = modelProviderIdentifierSchema.parse(providerId)
    const stored = await this.readStoredSettingsForMetadata()
    const provider = stored?.providers.find((candidate) => candidate.id === id)
    if (!provider) throw new AppError("NOT_FOUND")
    if (!provider.apiKey) {
      throw new AppError("MODEL_CATALOG_CREDENTIAL_REQUIRED")
    }
    const models = await this.modelCatalogClient.listModels(
      {
        provider: provider.provider,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        providerProject: provider.providerProject,
        providerLocation: provider.providerLocation,
      },
      signal
    )
    return { provider_id: provider.id, models: [...models] }
  }

  async update(
    actorId: string,
    rawInput: UpdateModelProviderSettings,
    context: AuditContext
  ): Promise<ModelProviderSettings> {
    const input = updateModelProviderSettingsSchema.parse(rawInput)
    const currentForMetadata = await this.readStoredSettingsForMetadata()
    const enrichedProviders = await this.enrichProvidersWithContextWindows(
      input.providers,
      currentForMetadata
    )
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
        this.config.credentialKeyId
      )
      const currentRevision = current?.revision ?? 0
      if (currentRevision !== input.expected_revision) {
        throw new AppError("CONFLICT")
      }
      const replacedApiKeyCount = input.providers.filter(
        (provider) => provider.api_key !== undefined
      ).length
      const nextTitleModel =
        input.title_model !== undefined
          ? input.title_model
          : current?.titleModel ?? input.default_model

      const next = storedModelProviderSettingsSchema.parse({
        version: 9,
        revision: currentRevision + 1,
        providers: enrichedProviders.map((provider) => {
          const currentProvider = current?.providers.find(
            (candidate) => candidate.id === provider.id
          )
          const apiKey = provider.api_key ?? currentProvider?.apiKey
          if (
            !apiKey &&
            provider.models.some(
              (model) =>
                (model.kind === "chat" && model.enabled) ||
                model.id === nextTitleModel
            )
          ) {
            throw new AppError("VALIDATION_ERROR")
          }
          return {
            id: provider.id,
            name: provider.name ?? currentProvider?.name ?? null,
            provider: provider.provider,
            providerProject: provider.provider_project,
            providerLocation: provider.provider_location,
            baseUrl: provider.base_url,
            protocolMode:
              provider.protocol_mode ??
              currentProvider?.protocolMode ??
              "native_responses",
            apiKey: apiKey ?? null,
            models: provider.models,
          }
        }),
        defaultModel: input.default_model,
        titleModel: nextTitleModel,
      })
      assertValidStoredSettings(next)
      const encrypted = encryptJson(
        next,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        ENCRYPTION_CONTEXT
      )
      const settingsJson = {
        ...currentRaw,
        [ENCRYPTED_SETTINGS_KEY]: encrypted,
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
          action: "model_provider_settings_updated",
          targetType: "model_provider",
          targetId: "link-sense",
          result: "success",
          metadataJson: {
            revision: next.revision,
            default_model: next.defaultModel,
            title_model: next.titleModel,
            provider_count: next.providers.length,
            model_count: allModels(next).length,
            enabled_model_count: allModels(next).filter(
              (model) => model.enabled
            ).length,
            api_key_replaced: replacedApiKeyCount > 0,
            api_key_replaced_count: replacedApiKeyCount,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return next
    })
    return projectAdminSettings(stored)
  }

  async updateModelAvailability(
    actorId: string,
    rawInput: UpdateModelAvailability,
    context: AuditContext
  ): Promise<ModelProviderSettings> {
    const input = updateModelAvailabilitySchema.parse(rawInput)
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
        this.config.credentialKeyId
      )
      if (!current) throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED")
      if (current.revision !== input.expected_revision) {
        throw new AppError("CONFLICT")
      }

      const currentModel = allModels(current).find(
        (model) => model.id === input.model_id
      )
      if (!currentModel) throw new AppError("MODEL_SELECTION_INVALID")
      if (currentModel.kind !== "chat") {
        throw new AppError("MODEL_SELECTION_INVALID")
      }
      if (currentModel.enabled === input.enabled) return current
      if (
        !input.enabled &&
        conversationModels(current).filter((model) => model.enabled).length ===
          1
      ) {
        throw new AppError("LAST_ENABLED_MODEL_REQUIRED")
      }
      const providers = current.providers.map((provider) => ({
        ...provider,
        models: provider.models.map((model) =>
          model.id === input.model_id
            ? { ...model, enabled: input.enabled }
            : model
        ),
      }))
      const enabledChatModels = providers
        .flatMap((provider) => provider.models)
        .filter(
          (model): model is ManagedConversationModel =>
            model.kind === "chat" && model.enabled
        )
      const next = storedModelProviderSettingsSchema.parse({
        ...current,
        revision: current.revision + 1,
        providers,
        defaultModel:
          current.defaultModel === input.model_id && !input.enabled
            ? (enabledChatModels[0]?.id ?? null)
            : current.defaultModel,
        titleModel: current.titleModel,
      })
      assertValidStoredSettings(next)

      const encrypted = encryptJson(
        next,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        ENCRYPTION_CONTEXT
      )
      const settingsJson = {
        ...currentRaw,
        [ENCRYPTED_SETTINGS_KEY]: encrypted,
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
          action: "model_provider_model_availability_updated",
          targetType: "model_provider",
          targetId: "link-sense",
          result: "success",
          metadataJson: {
            revision: next.revision,
            provider_count: next.providers.length,
            model_count: allModels(next).length,
            enabled_model_count: allModels(next).filter(
              (model) => model.enabled
            ).length,
            model_enabled: input.enabled,
            api_key_replaced: false,
            api_key_replaced_count: 0,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return next
    })
    return projectAdminSettings(stored)
  }

  async deleteModel(
    actorId: string,
    rawInput: DeleteModelProviderModel,
    context: AuditContext
  ): Promise<ModelProviderSettings> {
    const input = deleteModelProviderModelSchema.parse(rawInput)
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
        this.config.credentialKeyId
      )
      if (!current) throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED")
      if (current.revision !== input.expected_revision) {
        throw new AppError("CONFLICT")
      }

      const provider = current.providers.find((candidate) =>
        candidate.models.some((model) => model.id === input.model_id)
      )
      const model = provider?.models.find(
        (candidate) => candidate.id === input.model_id
      )
      if (!provider || !model) throw new AppError("MODEL_SELECTION_INVALID")
      if (provider.models.length === 1) {
        throw new AppError("VALIDATION_ERROR")
      }
      if (
        model.kind === "chat" &&
        model.enabled &&
        conversationModels(current).filter((candidate) => candidate.enabled)
          .length === 1
      ) {
        throw new AppError("LAST_ENABLED_MODEL_REQUIRED")
      }
      if (
        current.titleModel === input.model_id ||
        (await this.isModelReferenced(input.model_id))
      ) {
        throw new AppError("MODEL_IN_USE_BY_SYSTEM_SETTING")
      }

      const providers = current.providers.map((candidate) =>
        candidate.id === provider.id
          ? {
              ...candidate,
              models: candidate.models.filter(
                (candidateModel) => candidateModel.id !== input.model_id
              ),
            }
          : candidate
      )
      const enabledChatModels = providers
        .flatMap((candidate) => candidate.models)
        .filter(
          (candidate): candidate is ManagedConversationModel =>
            candidate.kind === "chat" && candidate.enabled
        )
      const next = storedModelProviderSettingsSchema.parse({
        ...current,
        revision: current.revision + 1,
        providers,
        defaultModel:
          current.defaultModel === input.model_id
            ? (enabledChatModels[0]?.id ?? null)
            : current.defaultModel,
        titleModel: current.titleModel,
      })
      assertValidStoredSettings(next)

      const encrypted = encryptJson(
        next,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        ENCRYPTION_CONTEXT
      )
      const settingsJson = {
        ...currentRaw,
        [ENCRYPTED_SETTINGS_KEY]: encrypted,
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
          action: "model_provider_model_deleted",
          targetType: "model_provider_model",
          targetId: input.model_id,
          result: "success",
          metadataJson: {
            revision: next.revision,
            provider_id: provider.id,
            provider_count: next.providers.length,
            model_count: allModels(next).length,
            enabled_model_count: allModels(next).filter(
              (candidate) => candidate.enabled
            ).length,
            default_model: next.defaultModel,
            api_key_replaced: false,
            api_key_replaced_count: 0,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return next
    })
    return projectAdminSettings(stored)
  }

  async deleteProvider(
    actorId: string,
    rawInput: DeleteModelProvider,
    context: AuditContext
  ): Promise<ModelProviderSettings> {
    const input = deleteModelProviderSchema.parse(rawInput)
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
        this.config.credentialKeyId
      )
      if (!current) throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED")
      if (current.revision !== input.expected_revision) {
        throw new AppError("CONFLICT")
      }

      const provider = current.providers.find(
        (candidate) => candidate.id === input.provider_id
      )
      if (!provider) throw new AppError("MODEL_SELECTION_INVALID")
      if (current.providers.length === 1) {
        throw new AppError("VALIDATION_ERROR")
      }

      const providers = current.providers.filter(
        (candidate) => candidate.id !== provider.id
      )
      const remainingModels = providers.flatMap((candidate) => candidate.models)
      const enabledChatModels = remainingModels.filter(
        (model): model is ManagedConversationModel =>
          model.kind === "chat" && model.enabled
      )
      if (
        (remainingModels.length > 0 &&
          !remainingModels.some((model) => model.enabled)) ||
        (provider.models.some(
          (model) => model.kind === "chat" && model.enabled
        ) &&
          enabledChatModels.length === 0)
      ) {
        throw new AppError("LAST_ENABLED_MODEL_REQUIRED")
      }
      if (
        provider.models.some((model) => model.id === current.titleModel) ||
        (await this.isAnyModelReferenced(
          provider.models.map((model) => model.id)
        ))
      ) {
        throw new AppError("MODEL_IN_USE_BY_SYSTEM_SETTING")
      }

      const next = storedModelProviderSettingsSchema.parse({
        ...current,
        revision: current.revision + 1,
        providers,
        defaultModel: provider.models.some(
          (model) => model.id === current.defaultModel
        )
          ? (enabledChatModels[0]?.id ?? null)
          : current.defaultModel,
        titleModel: current.titleModel,
      })
      assertValidStoredSettings(next)

      const encrypted = encryptJson(
        next,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        ENCRYPTION_CONTEXT
      )
      const settingsJson = {
        ...currentRaw,
        [ENCRYPTED_SETTINGS_KEY]: encrypted,
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
          action: "model_provider_deleted",
          targetType: "model_provider",
          targetId: provider.id,
          result: "success",
          metadataJson: {
            revision: next.revision,
            deleted_model_count: provider.models.length,
            provider_count: next.providers.length,
            model_count: allModels(next).length,
            enabled_model_count: allModels(next).filter(
              (model) => model.enabled
            ).length,
            default_model: next.defaultModel,
            api_key_replaced: false,
            api_key_replaced_count: 0,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return next
    })
    return projectAdminSettings(stored)
  }

  async getPreference(
    userId: string,
    conversationId?: string
  ): Promise<ModelPreference> {
    const [stored, source] = await Promise.all([
      this.readStoredSettings(),
      this.readPreferenceSource(userId, conversationId),
    ])
    if (!source.user) throw new AppError("AUTH_REQUIRED")
    if (conversationId && !source.conversation) {
      throw new AppError("CONVERSATION_NOT_FOUND")
    }
    if (!stored || stored.defaultModel === null) return unconfiguredPreference()
    const selection = resolveSelection(
      stored,
      source.conversation?.preferredModel ??
        source.latestTurn?.model ??
        source.user.preferredModel,
      source.user.preferredReasoningEffort
    )
    return {
      configured: true,
      models: conversationModels(stored)
        .filter((model) => model.enabled)
        .map(projectSelectableModel),
      default_model: stored.defaultModel,
      selected_model: selection.model,
      selected_reasoning_effort: selection.reasoningEffort,
    }
  }

  async updatePreference(
    userId: string,
    rawInput: UpdateModelPreference,
    context: AuditContext,
    conversationId?: string
  ): Promise<ModelPreference> {
    const input = updateModelPreferenceSchema.parse(rawInput)
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      await tx.$queryRaw`
        SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE
      `
      if (conversationId) {
        await tx.$queryRaw`
          SELECT id
          FROM conversations
          WHERE id = ${conversationId}::uuid AND owner_id = ${userId}::uuid
          FOR UPDATE
        `
      }
      const [row, user, conversation] = await Promise.all([
        tx.systemSetting.findUnique({
          where: { id: SYSTEM_SETTINGS_ID },
          select: { settingsJson: true },
        }),
        tx.user.findFirst({
          where: { id: userId, status: "active" },
          select: { id: true },
        }),
        conversationId
          ? tx.conversation.findFirst({
              where: { id: conversationId, ownerId: userId },
              select: { id: true },
            })
          : Promise.resolve(null),
      ])
      if (!user) throw new AppError("AUTH_REQUIRED")
      if (conversationId && !conversation) {
        throw new AppError("CONVERSATION_NOT_FOUND")
      }
      const storedRaw = readStoredSettings(
        asObject(row?.settingsJson),
        this.config.credentialMasterKey,
        this.config.credentialKeyId
      )
      const stored = storedRaw
      if (!stored) throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED")
      assertSelectionAvailable(
        stored,
        input.selected_model,
        input.selected_reasoning_effort
      )
      await tx.user.update({
        where: { id: userId },
        data: {
          preferredModel: input.selected_model,
          preferredReasoningEffort: input.selected_reasoning_effort,
        },
      })
      if (conversationId) {
        await tx.conversation.update({
          where: { id: conversationId },
          data: { preferredModel: input.selected_model },
        })
      }
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: conversationId
            ? "conversation_model_preference_updated"
            : "model_preference_updated",
          targetType: conversationId ? "conversation" : "user",
          targetId: conversationId ?? userId,
          result: "success",
          metadataJson: {
            model: input.selected_model,
            reasoning_effort: input.selected_reasoning_effort,
            ...(conversationId ? { conversation_id: conversationId } : {}),
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      return {
        configured: true,
        models: conversationModels(stored)
          .filter((model) => model.enabled)
          .map(projectSelectableModel),
        default_model: stored.defaultModel,
        selected_model: input.selected_model,
        selected_reasoning_effort: input.selected_reasoning_effort,
      }
    })
  }

  async resolveRuntime(
    userId: string,
    conversationId?: string
  ): Promise<ResolvedModelRuntime> {
    const [stored, source] = await Promise.all([
      this.readStoredSettings(),
      this.readPreferenceSource(userId, conversationId),
    ])
    if (!source.user) throw new AppError("USER_DISABLED")
    if (conversationId && !source.conversation) {
      throw new AppError("CONVERSATION_NOT_FOUND")
    }
    if (!stored || stored.defaultModel === null) {
      throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED")
    }
    const selection = resolveSelection(
      stored,
      source.conversation?.preferredModel ??
        source.latestTurn?.model ??
        source.user.preferredModel,
      source.user.preferredReasoningEffort
    )
    return projectRuntime(stored, selection.model, selection.reasoningEffort)
  }

  async resolveRuntimeForSelection(
    model: string,
    reasoningEffort: ReasoningEffort
  ): Promise<ResolvedModelRuntime> {
    const stored = await this.readStoredSettings()
    if (!stored) throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED")
    assertSelectionAvailable(stored, model, reasoningEffort)
    return projectRuntime(stored, model, reasoningEffort)
  }

  async resolveModelTransitionRuntime(
    model: string
  ): Promise<ResolvedModelTransitionRuntime> {
    const stored = await this.readStoredSettings()
    if (!stored) throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED")
    return projectModelTransitionRuntime(stored, model)
  }

  async resolveManagedModel(
    modelId: string,
    expectedKind?: ManagedModelKind
  ): Promise<ResolvedManagedModelRuntime> {
    const stored = await this.readStoredSettings()
    if (!stored) throw new AppError("MODEL_PROVIDER_NOT_CONFIGURED")
    return projectManagedRuntime(stored, modelId, expectedKind)
  }

  async resolveTaskTitleModel(): Promise<ResolvedManagedModelRuntime | null> {
    const stored = await this.readStoredSettings()
    if (!stored?.titleModel) return null
    return projectManagedRuntime(stored, stored.titleModel, "chat")
  }

  private async readStoredSettingsForMetadata(): Promise<StoredModelProviderSettings | null> {
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

  private async enrichProvidersWithContextWindows(
    providers: ParsedManagedModelProviderUpdate[],
    current: StoredModelProviderSettings | null
  ): Promise<ParsedManagedModelProviderUpdate[]> {
    return await Promise.all(
      providers.map(async (provider) => {
        const currentProvider = current?.providers.find(
          (candidate) => candidate.id === provider.id
        )
        const apiKey = provider.api_key ?? currentProvider?.apiKey ?? null
        const needsContextWindow = provider.models.some(
          (model) => model.kind === "chat" && model.context_window === null
        )
        const discoveredModels =
          apiKey && needsContextWindow
            ? await this.modelCatalogClient
                .listModels({
                  provider: provider.provider,
                  baseUrl: provider.base_url,
                  apiKey,
                  providerProject: provider.provider_project,
                  providerLocation: provider.provider_location,
                })
                .catch(() => [])
            : []
        const probedContextWindows = new Map(
          discoveredModels.flatMap((model) =>
            model.context_window === null
              ? []
              : [[model.id, model.context_window] as const]
          )
        )
        return {
          ...provider,
          models: provider.models.map((model) => {
            if (model.kind !== "chat" || model.context_window !== null) {
              return model
            }
            const currentModel = currentProvider?.models.find(
              (candidate): candidate is ManagedConversationModel =>
                candidate.kind === "chat" && candidate.id === model.id
            )
            return {
              ...model,
              context_window:
                probedContextWindows.get(model.id) ??
                currentModel?.context_window ??
                null,
            }
          }),
        }
      })
    )
  }

  private async readStoredSettings(): Promise<StoredModelProviderSettings | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { settingsJson: true, updatedBy: true },
    })
    const settingsJson = asObject(row?.settingsJson)
    const stored = readStoredSettings(
      settingsJson,
      this.config.credentialMasterKey,
      this.config.credentialKeyId
    )
    const migration = mergeLegacyModelDefinitions(
      stored,
      settingsJson,
      this.config.credentialMasterKey,
      this.config.credentialKeyId
    )
    if (migration.changed) {
      await this.persistMigratedSettings(row?.updatedBy ?? null)
    }
    return migration.settings
  }

  private async persistMigratedSettings(
    updatedBy: string | null
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))
      `
      const row = await tx.systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
        select: { settingsJson: true, updatedBy: true },
      })
      const settingsJson = asObject(row?.settingsJson)
      const latest = readStoredSettings(
        settingsJson,
        this.config.credentialMasterKey,
        this.config.credentialKeyId
      )
      const migration = mergeLegacyModelDefinitions(
        latest,
        settingsJson,
        this.config.credentialMasterKey,
        this.config.credentialKeyId
      )
      if (!migration.changed || !migration.settings) return
      const encrypted = encryptJson(
        migration.settings,
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
          updatedBy,
        },
        update: {
          settingsJson: nextSettingsJson,
          updatedBy: row?.updatedBy ?? updatedBy,
        },
      })
    })
  }

  private async isModelReferenced(modelId: string): Promise<boolean> {
    return this.isAnyModelReferenced([modelId])
  }

  private async isAnyModelReferenced(
    modelIds: readonly string[]
  ): Promise<boolean> {
    const references = await Promise.all(
      this.referenceReaders.map((reader) => reader.getReferencedModelIds())
    )
    return references.some((referencedModelIds) =>
      modelIds.some((modelId) => referencedModelIds.has(modelId))
    )
  }

  private async readPreferenceSource(userId: string, conversationId?: string) {
    const [user, conversation, latestTurn] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId, status: "active" },
        select: {
          preferredModel: true,
          preferredReasoningEffort: true,
        },
      }),
      conversationId
        ? this.prisma.conversation.findFirst({
            where: { id: conversationId, ownerId: userId },
            select: { preferredModel: true },
          })
        : Promise.resolve(null),
      conversationId
        ? this.prisma.conversationTurn.findFirst({
            where: { conversationId, model: { not: null } },
            orderBy: { sequenceNo: "desc" },
            select: { model: true },
          })
        : Promise.resolve(null),
    ])
    return { user, conversation, latestTurn }
  }
}

function readStoredSettings(
  raw: Record<string, unknown>,
  masterKey: string,
  expectedKeyId: string
): StoredModelProviderSettings | null {
  const encrypted = raw[ENCRYPTED_SETTINGS_KEY]
  const keyId = raw[ENCRYPTION_KEY_ID_KEY]
  if (encrypted === undefined && keyId === undefined) return null
  if (typeof encrypted !== "string" || typeof keyId !== "string") {
    throw new Error("model provider settings envelope is incomplete")
  }
  if (keyId !== expectedKeyId) {
    throw new Error("model provider settings encryption key mismatch")
  }
  const decrypted = decryptJson<unknown>(
    encrypted,
    masterKey,
    expectedKeyId,
    ENCRYPTION_CONTEXT
  )
  const current = storedModelProviderSettingsSchema.safeParse(decrypted)
  const stored = current.success
    ? current.data
    : migrateStoredModelProviderSettings(decrypted)
  assertValidStoredSettings(stored)
  return stored
}

function migrateStoredModelProviderSettings(
  value: unknown
): StoredModelProviderSettings {
  const version8 = storedModelProviderSettingsV8Schema.safeParse(value)
  if (version8.success) {
    return storedModelProviderSettingsSchema.parse({
      ...version8.data,
      version: 9,
    })
  }

  const version7 = storedModelProviderSettingsV7Schema.safeParse(value)
  if (version7.success) {
    return storedModelProviderSettingsSchema.parse({
      ...version7.data,
      version: 9,
      titleModel: version7.data.defaultModel,
    })
  }

  const version6 = storedModelProviderSettingsV6Schema.safeParse(value)
  if (version6.success) {
    return migrateVersion6Settings(version6.data)
  }

  const version5 = storedModelProviderSettingsV5Schema.safeParse(value)
  if (version5.success) {
    return storedModelProviderSettingsSchema.parse({
      version: 9,
      revision: version5.data.revision,
      providers: version5.data.providers.map((provider) => ({
        ...provider,
        provider: "openai_compatible",
        providerProject: null,
        providerLocation: null,
        models: provider.models.map(migrateLegacyChatModel),
      })),
      defaultModel: version5.data.defaultModel,
      titleModel: version5.data.defaultModel,
    })
  }

  const version4 = storedModelProviderSettingsV4Schema.safeParse(value)
  if (version4.success) {
    return storedModelProviderSettingsSchema.parse({
      version: 9,
      revision: version4.data.revision,
      providers: version4.data.providers.map((provider) => ({
        ...provider,
        provider: "openai_compatible",
        providerProject: null,
        providerLocation: null,
        models: provider.models.map(migrateLegacyChatModel),
      })),
      defaultModel: version4.data.defaultModel,
      titleModel: version4.data.defaultModel,
    })
  }

  const version3 = storedModelProviderSettingsV3Schema.safeParse(value)
  if (version3.success) {
    return storedModelProviderSettingsSchema.parse({
      version: 9,
      revision: version3.data.revision,
      providers: version3.data.providers.map((provider) => ({
        ...provider,
        name: null,
        provider: "openai_compatible",
        providerProject: null,
        providerLocation: null,
        models: provider.models.map(migrateLegacyChatModel),
      })),
      defaultModel: version3.data.defaultModel,
      titleModel: version3.data.defaultModel,
    })
  }

  const version2 = storedModelProviderSettingsV2Schema.safeParse(value)
  const legacy = version2.success
    ? version2.data
    : storedModelProviderSettingsV1Schema.parse(value)
  return storedModelProviderSettingsSchema.parse({
    version: 9,
    revision: legacy.revision,
    providers: [
      {
        id: "provider-1",
        name: null,
        provider: "openai_compatible",
        providerProject: null,
        providerLocation: null,
        baseUrl: legacy.baseUrl,
        protocolMode: version2.success
          ? version2.data.protocolMode
          : "native_responses",
        apiKey: legacy.apiKey,
        models: legacy.models.map(migrateLegacyChatModel),
      },
    ],
    defaultModel: legacy.defaultModel,
    titleModel: legacy.defaultModel,
  })
}

function migrateVersion6Settings(
  legacy: z.infer<typeof storedModelProviderSettingsV6Schema>
): StoredModelProviderSettings {
  const providers = legacy.providers.flatMap((channel) => {
    const groups = new Map<
      string,
      {
        provider: z.infer<typeof modelServiceProviderSchema>
        providerProject: string | null
        providerLocation: string | null
        models: ManagedPricedModel[]
      }
    >()
    for (const legacyModel of channel.models) {
      const {
        provider,
        provider_project: providerProject,
        provider_location: providerLocation,
        ...model
      } = legacyModel
      const key = JSON.stringify([provider, providerProject, providerLocation])
      const group = groups.get(key) ?? {
        provider,
        providerProject,
        providerLocation,
        models: [],
      }
      group.models.push(managedPricedModelSchema.parse(model))
      groups.set(key, group)
    }
    return [...groups.entries()].map(([key, group], index) => ({
      id: index === 0 ? channel.id : legacyV6SplitChannelId(channel.id, key),
      name:
        index === 0
          ? channel.name
          : channel.name
            ? `${channel.name} (${group.provider})`.slice(0, 120)
            : null,
      provider: group.provider,
      providerProject: group.providerProject,
      providerLocation: group.providerLocation,
      baseUrl: channel.baseUrl,
      protocolMode: channel.protocolMode,
      apiKey: channel.apiKey,
      models: group.models,
    }))
  })
  return storedModelProviderSettingsSchema.parse({
    version: 9,
    revision: legacy.revision,
    providers,
    defaultModel: legacy.defaultModel,
    titleModel: legacy.defaultModel,
  })
}

export function parseOpenAiCompatibleModelContextWindows(
  payload: unknown
): ReadonlyMap<string, number> {
  const windows = new Map<string, number>()
  try {
    for (const model of parseOpenAiCompatibleModelCatalog(payload)) {
      if (model.context_window !== null) {
        windows.set(model.id, model.context_window)
      }
    }
  } catch {
    return new Map()
  }
  return windows
}

function legacyV6SplitChannelId(
  channelId: string,
  providerKey: string
): string {
  const digest = createHash("sha256")
    .update(`${channelId}\u0000${providerKey}`)
    .digest("hex")
    .slice(0, 16)
  return `migrated-v6-${digest}`
}

function assertValidStoredSettings(
  settings: StoredModelProviderSettings
): void {
  const parsed = updateModelProviderSettingsSchema.safeParse({
    expected_revision: settings.revision - 1,
    providers: settings.providers.map((provider) => ({
      id: provider.id,
      ...(provider.name ? { name: provider.name } : {}),
      provider: provider.provider,
      provider_project: provider.providerProject,
      provider_location: provider.providerLocation,
      base_url: provider.baseUrl,
      protocol_mode: provider.protocolMode,
      ...(provider.apiKey ? { api_key: provider.apiKey } : {}),
      models: provider.models,
    })),
    default_model: settings.defaultModel,
    title_model: settings.titleModel,
  })
  if (!parsed.success)
    throw new Error("stored model provider settings are invalid")
}

function projectAdminSettings(
  stored: StoredModelProviderSettings | null
): ModelProviderSettings {
  return modelProviderSettingsSchema.parse(
    stored
      ? {
          configured: true,
          revision: stored.revision,
          providers: stored.providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            provider: provider.provider,
            provider_project: provider.providerProject,
            provider_location: provider.providerLocation,
            base_url: provider.baseUrl,
            protocol_mode: provider.protocolMode,
            api_key_configured: provider.apiKey !== null,
            models: provider.models,
          })),
          default_model: stored.defaultModel,
          title_model: stored.titleModel,
        }
      : {
          configured: false,
          revision: 0,
          providers: [],
          default_model: null,
          title_model: null,
        }
  )
}

function unconfiguredPreference(): ModelPreference {
  return {
    configured: false,
    models: [],
    default_model: null,
    selected_model: null,
    selected_reasoning_effort: null,
  }
}

function resolveSelection(
  stored: StoredModelProviderSettings,
  preferredModel: string | null,
  preferredReasoningEffort: string | null
): { model: string; reasoningEffort: ReasoningEffort } {
  const models = conversationModels(stored)
  const selected =
    models.find((model) => model.enabled && model.id === preferredModel) ??
    models.find((model) => model.enabled && model.id === stored.defaultModel)
  if (!selected) throw new Error("configured default model is unavailable")
  const parsedEffort = reasoningEffortSchema.safeParse(preferredReasoningEffort)
  const reasoningEffort =
    parsedEffort.success &&
    selected.supported_reasoning_efforts.includes(parsedEffort.data)
      ? parsedEffort.data
      : selected.default_reasoning_effort
  return { model: selected.id, reasoningEffort }
}

function assertSelectionAvailable(
  stored: StoredModelProviderSettings,
  modelId: string,
  reasoningEffort: ReasoningEffort
): ManagedModel {
  const model = conversationModels(stored).find(
    (candidate) => candidate.enabled && candidate.id === modelId
  )
  if (!model || !model.supported_reasoning_efforts.includes(reasoningEffort)) {
    throw new AppError("MODEL_SELECTION_INVALID")
  }
  return model
}

function projectRuntime(
  stored: StoredModelProviderSettings,
  model: string,
  reasoningEffort: ReasoningEffort
): ResolvedModelRuntime {
  const provider = stored.providers.find((candidate) =>
    candidate.models.some(
      (managedModel) =>
        managedModel.kind === "chat" &&
        managedModel.enabled &&
        managedModel.id === model
    )
  )
  if (!provider || !provider.apiKey) {
    throw new Error("selected model provider is unavailable")
  }
  const selectedModel = provider.models.find(
    (managedModel) =>
      managedModel.kind === "chat" &&
      managedModel.enabled &&
      managedModel.id === model
  )
  if (!selectedModel || selectedModel.kind !== "chat") {
    throw new Error("selected model pricing is unavailable")
  }
  return {
    model,
    reasoningEffort,
    provider: {
      revision: stored.revision,
      baseUrl: provider.baseUrl,
      protocolMode: provider.protocolMode,
      apiKey: provider.apiKey,
      pricing: {
        input_price_per_million: selectedModel.input_price_per_million,
        cached_input_price_per_million:
          selectedModel.cached_input_price_per_million,
        output_price_per_million: selectedModel.output_price_per_million,
      },
      ...(selectedModel.context_window === null
        ? {}
        : { modelContextWindow: selectedModel.context_window }),
    },
  }
}

function projectModelTransitionRuntime(
  stored: StoredModelProviderSettings,
  model: string
): ResolvedModelTransitionRuntime {
  const provider = stored.providers.find((candidate) =>
    candidate.models.some(
      (managedModel) => managedModel.kind === "chat" && managedModel.id === model
    )
  )
  const selectedModel = provider?.models.find(
    (managedModel) => managedModel.kind === "chat" && managedModel.id === model
  )
  if (!provider?.apiKey || !selectedModel || selectedModel.kind !== "chat") {
    throw new AppError("MODEL_SELECTION_INVALID")
  }
  return {
    model,
    provider: {
      revision: stored.revision,
      baseUrl: provider.baseUrl,
      protocolMode: provider.protocolMode,
      apiKey: provider.apiKey,
      pricing: {
        input_price_per_million: selectedModel.input_price_per_million,
        cached_input_price_per_million:
          selectedModel.cached_input_price_per_million,
        output_price_per_million: selectedModel.output_price_per_million,
      },
      ...(selectedModel.context_window === null
        ? {}
        : { modelContextWindow: selectedModel.context_window }),
    },
  }
}

function allModels(stored: StoredModelProviderSettings): ManagedPricedModel[] {
  return stored.providers.flatMap((provider) => provider.models)
}

function projectManagedRuntime(
  stored: StoredModelProviderSettings,
  modelId: string,
  expectedKind?: ManagedModelKind
): ResolvedManagedModelRuntime {
  const channel = stored.providers.find((provider) =>
    provider.models.some((model) => model.id === modelId)
  )
  const model = channel?.models.find((candidate) => candidate.id === modelId)
  if (!channel || !model || (expectedKind && model.kind !== expectedKind)) {
    throw new AppError("MODEL_SELECTION_INVALID")
  }
  return {
    revision: stored.revision,
    model,
    channel: {
      id: channel.id,
      name: channel.name,
      provider: channel.provider,
      providerProject: channel.providerProject,
      providerLocation: channel.providerLocation,
      baseUrl: channel.baseUrl,
      protocolMode: channel.protocolMode,
      ...(channel.apiKey ? { apiKey: channel.apiKey } : {}),
    },
  }
}

function conversationModels(
  stored: StoredModelProviderSettings
): ManagedConversationModel[] {
  return allModels(stored).filter(isConversationModel)
}

function migrateLegacyChatModel(
  model: ManagedModel & Partial<z.infer<typeof modelTokenPricingSchema>>
): ManagedConversationModel {
  return {
    ...model,
    kind: "chat",
    supports_image_input: false,
    context_window: null,
    input_price_per_million: model.input_price_per_million ?? "0",
    cached_input_price_per_million: model.cached_input_price_per_million ?? "0",
    output_price_per_million: model.output_price_per_million ?? "0",
  }
}

function projectSelectableModel(model: ManagedConversationModel): ManagedModel {
  return {
    id: model.id,
    display_name: model.display_name,
    enabled: model.enabled,
    context_window: model.context_window,
    supported_reasoning_efforts: model.supported_reasoning_efforts,
    default_reasoning_effort: model.default_reasoning_effort,
  }
}

function mergeLegacyModelDefinitions(
  stored: StoredModelProviderSettings | null,
  settingsJson: Record<string, unknown>,
  masterKey: string,
  expectedKeyId: string
): { settings: StoredModelProviderSettings | null; changed: boolean } {
  const knowledge = readLegacyEnvelope(
    settingsJson,
    LEGACY_KNOWLEDGE_SETTINGS_KEY,
    LEGACY_KNOWLEDGE_KEY_ID_KEY,
    LEGACY_KNOWLEDGE_CONTEXT,
    legacyKnowledgeSettingsSchema,
    masterKey,
    expectedKeyId
  )
  const image = readLegacyEnvelope(
    settingsJson,
    LEGACY_IMAGE_SETTINGS_KEY,
    LEGACY_IMAGE_KEY_ID_KEY,
    LEGACY_IMAGE_CONTEXT,
    legacyImageSettingsSchema,
    masterKey,
    expectedKeyId
  )
  if (!knowledge && !image) return { settings: stored, changed: false }

  const providers =
    stored?.providers.map((provider) => ({
      ...provider,
      models: [...provider.models],
    })) ?? []
  const modelIds = new Set(
    providers.flatMap((provider) => provider.models.map((model) => model.id))
  )
  let defaultModel = stored?.defaultModel ?? null
  let titleModel = stored?.titleModel ?? defaultModel
  let changed = false

  const addChannel = (input: {
    purpose: string
    provider: z.infer<typeof modelServiceProviderSchema>
    providerProject?: string | null
    providerLocation?: string | null
    baseUrl: string
    apiKey: string | null
    model: ManagedPricedModel
  }) => {
    if (modelIds.has(input.model.id)) return
    const id = legacyChannelId(input.purpose, input.model.id, input.baseUrl)
    if (providers.some((provider) => provider.id === id)) return
    providers.push({
      id,
      name: null,
      provider: input.provider,
      providerProject: input.providerProject ?? null,
      providerLocation: input.providerLocation ?? null,
      baseUrl: input.baseUrl,
      protocolMode: "native_responses",
      apiKey: input.apiKey,
      models: [input.model],
    })
    modelIds.add(input.model.id)
    if (input.model.kind === "chat" && input.model.enabled && !defaultModel) {
      defaultModel = input.model.id
      titleModel = input.model.id
    }
    changed = true
  }

  if (knowledge) {
    addChannel({
      purpose: "embedding",
      provider: "openai_compatible",
      baseUrl: knowledge.embedding.baseUrl,
      apiKey: knowledge.embedding.apiKey,
      model: {
        id: knowledge.embedding.model,
        display_name: knowledge.embedding.model,
        enabled: true,
        kind: "embedding",
        input_price_per_million:
          knowledge.embedding.pricing?.input_price_per_million ?? "0",
      },
    })
    if (knowledge.rerank.baseUrl && knowledge.rerank.model) {
      addChannel({
        purpose: "reranker",
        provider: "openai_compatible",
        baseUrl: knowledge.rerank.baseUrl,
        apiKey: knowledge.rerank.apiKey,
        model: {
          id: knowledge.rerank.model,
          display_name: knowledge.rerank.model,
          enabled: true,
          kind: "reranker",
          input_price_per_million:
            knowledge.rerank.pricing?.input_price_per_million ?? "0",
        },
      })
    }
  }

  if (
    image?.provider &&
    image.model &&
    image.apiKey &&
    (image.provider !== "google_vertex" ||
      (image.project !== null && image.location !== null))
  ) {
    const baseUrl = image.baseUrl ?? defaultProviderBaseUrl(image.provider)
    if (baseUrl) {
      addChannel({
        purpose: "image",
        provider: image.provider,
        providerProject: image.project,
        providerLocation: image.location,
        baseUrl,
        apiKey: image.apiKey,
        model: {
          id: image.model,
          display_name: image.model,
          enabled: true,
          kind: "chat",
          input_price_per_million: "0",
          cached_input_price_per_million: "0",
          output_price_per_million: "0",
          supports_image_input: true,
          context_window: null,
          supported_reasoning_efforts: [
            ...genericModelReasoningProfile.supported_reasoning_efforts,
          ],
          default_reasoning_effort:
            genericModelReasoningProfile.default_reasoning_effort,
        },
      })
    }
  }

  if (!changed) return { settings: stored, changed: false }
  const settings = storedModelProviderSettingsSchema.parse({
    version: 9,
    revision: (stored?.revision ?? 0) + 1,
    providers,
    defaultModel,
    titleModel,
  })
  assertValidStoredSettings(settings)
  return { settings, changed: true }
}

function readLegacyEnvelope<T>(
  settingsJson: Record<string, unknown>,
  encryptedKey: string,
  keyIdKey: string,
  context: string,
  schema: z.ZodType<T>,
  masterKey: string,
  expectedKeyId: string
): T | null {
  const encrypted = settingsJson[encryptedKey]
  if (
    typeof encrypted !== "string" ||
    settingsJson[keyIdKey] !== expectedKeyId
  ) {
    return null
  }
  try {
    return schema.parse(
      decryptJson<unknown>(encrypted, masterKey, expectedKeyId, context)
    )
  } catch {
    return null
  }
}

function legacyChannelId(
  purpose: string,
  model: string,
  baseUrl: string
): string {
  const digest = createHash("sha256")
    .update(`${purpose}\u0000${model}\u0000${baseUrl}`)
    .digest("hex")
    .slice(0, 12)
  return `migrated-${purpose}-${digest}`
}

function defaultProviderBaseUrl(
  provider: Exclude<z.infer<typeof legacyImageSettingsSchema>["provider"], null>
): string | null {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1"
    case "anthropic":
      return "https://api.anthropic.com/v1"
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta"
    case "google_vertex":
      return "https://aiplatform.googleapis.com/v1"
    case "alibaba":
      return "https://dashscope.aliyuncs.com/compatible-mode/v1"
    case "deepseek":
      return "https://api.deepseek.com/v1"
    case "openrouter":
      return "https://openrouter.ai/api/v1"
    case "azure_openai":
    case "openai_compatible":
      return null
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
