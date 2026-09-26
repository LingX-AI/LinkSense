import { randomUUID } from "node:crypto"

import {
  generatedImagePayloadSchema,
  imageGenerationInternalResultSchema,
  imageGenerationPricePerImageSchema,
  imageGenerationProviderDefinitions,
  imageGenerationProviderOptionsSchema,
  imageGenerationProviderSchema,
  imageGenerationRequestSchema,
  imageGenerationSettingsSchema,
  pricingCurrency,
  updateImageGenerationSettingsSchema,
  type JsonValue,
  type ImageGenerationInternalResult,
  type ImageGenerationProvider,
  type ImageGenerationProviderOptions,
  type ImageGenerationRequest,
  type ImageGenerationSettings,
  type UpdateImageGenerationSettings,
} from "@linksense/shared"
import { z } from "zod"

import type { AppConfig } from "../../config.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { decryptJson, encryptJson } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import { detectSafeRasterImage } from "../../lib/safe-raster-image.js"
import type { AuditContext } from "../audit/service.js"
import type { ModelUsageRecorder } from "../usage/model-usage.js"
import {
  ImageTransparencyValidationError,
  prepareGeneratedImage,
  type ImageTransparencyStrategy,
} from "./image-transparency.js"

const SYSTEM_SETTINGS_ID = "00000000-0000-4000-8000-000000000001"
const ENCRYPTED_SETTINGS_KEY = "image_generation_settings_encrypted"
const ENCRYPTION_KEY_ID_KEY = "image_generation_settings_key_id"
const ENCRYPTION_CONTEXT = "linksense:image-generation-settings:v1"
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_BASE64_CHARACTERS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4
const MAX_PROVIDER_IMAGE_REFS = 10
const ALIBABA_BAILIAN_MAX_SEED = 2_147_483_647
const STABILITY_MAX_SEED = 4_294_967_294
const GOOGLE_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const
const GOOGLE_FLASH_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9",
] as const
const STABILITY_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "9:21",
  "21:9",
] as const
const REPLICATE_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "9:21",
  "16:9",
  "21:9",
] as const

const storedImageGenerationSettingsSchema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  provider: imageGenerationProviderSchema.nullable(),
  providerOptions: imageGenerationProviderOptionsSchema,
  apiKey: z.string().min(1).max(16_384).nullable(),
  model: z.string().trim().min(1).max(240).nullable(),
  pricePerImage: imageGenerationPricePerImageSchema,
})

type StoredImageGenerationSettings = z.infer<
  typeof storedImageGenerationSettingsSchema
>

type ResolvedImageGenerationRuntime = {
  revision: number
  provider: ImageGenerationProvider
  providerOptions: ImageGenerationProviderOptions
  baseUrl: string
  apiKey: string
  model: string
  pricePerImage: string
}

type ImageGenerationFetch = typeof fetch

type ProviderImage = {
  bytes: Buffer
  mimeType: "image/png" | "image/jpeg" | "image/webp"
}

export class ImageGenerationSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly usageRecorder: ModelUsageRecorder,
    private readonly fetchImpl: ImageGenerationFetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getAdminSettings(): Promise<ImageGenerationSettings> {
    return projectAdminSettings(await this.readStoredSettings())
  }

  async update(
    actorId: string,
    rawInput: UpdateImageGenerationSettings,
    context: AuditContext,
  ): Promise<ImageGenerationSettings> {
    const input = updateImageGenerationSettingsSchema.parse(rawInput)
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
      if (
        next.enabled &&
        current?.provider &&
        next.provider !== current.provider &&
        input.api_key === undefined
      ) {
        throw new AppError("VALIDATION_ERROR")
      }
      if (next.enabled && next.apiKey === null) {
        throw new AppError("VALIDATION_ERROR")
      }
      const encrypted = encryptJson(
        next,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        ENCRYPTION_CONTEXT,
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
          action: "image_generation_settings_updated",
          targetType: "image_generation",
          targetId: "link-sense",
          result: "success",
          metadataJson: {
            revision: next.revision,
            enabled: next.enabled,
            provider: next.provider,
            model: next.model,
            price_per_image: next.pricePerImage,
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

  async generate(input: {
    ownerId: string
    conversationId: string
    turnId: string
    request: z.input<typeof imageGenerationRequestSchema>
    signal?: AbortSignal
  }): Promise<ImageGenerationInternalResult> {
    const request = imageGenerationRequestSchema.parse(input.request)
    const [runtime, turn] = await Promise.all([
      this.resolveRuntime(),
      this.prisma.conversationTurn.findFirst({
        where: {
          id: input.turnId,
          conversationId: input.conversationId,
          submittedBy: input.ownerId,
          status: "running",
        },
        select: { id: true },
      }),
    ])
    if (!turn) throw new AppError("IMAGE_GENERATION_TURN_INACTIVE")

    const maxImages = providerMaxImages(runtime.provider, runtime.model)
    const count = Math.min(request.count, maxImages)
    const transparencyStrategy = resolveTransparencyStrategy(runtime, request)
    const providerRequest = prepareProviderRequest(
      { ...request, count },
      transparencyStrategy,
    )
    const images = await generateWithProvider(
      runtime,
      providerRequest,
      transparencyStrategy,
      this.fetchImpl,
      input.signal,
    )
    if (images.length === 0) {
      throw new AppError("IMAGE_GENERATION_OUTPUT_INVALID")
    }
    const selectedImages = images.slice(0, count)
    const imageCount = selectedImages.length
    const unitPrice = runtime.pricePerImage
    const totalCost = multiplyPrice(unitPrice, imageCount)
    try {
      await this.usageRecorder.recordModelUsage({
        requestId: randomUUID(),
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        operation: "image_generation",
        workload: "image_generation",
        modelKind: "image",
        model: runtime.model,
        measurementMethod: "provider",
        tokenUsage: {
          totalTokens: imageCount,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: imageCount,
          reasoningOutputTokens: 0,
        },
        pricing: {
          input_price_per_million: "0",
          cached_input_price_per_million: "0",
          output_price_per_million: pricePerImageAsPerMillion(unitPrice),
        },
        observedAt: this.now(),
      })
    } catch {
      throw new AppError("IMAGE_GENERATION_RECORDING_FAILED")
    }

    let preparedImages
    try {
      preparedImages = await Promise.all(
        selectedImages.map((image) =>
          prepareGeneratedImage(image, transparencyStrategy),
        ),
      )
    } catch (error) {
      if (error instanceof ImageTransparencyValidationError) {
        throw new AppError("IMAGE_GENERATION_TRANSPARENCY_INVALID")
      }
      throw error
    }
    const normalized = preparedImages.map((image, index) =>
      generatedImagePayloadSchema.parse({
        data_base64: image.bytes.toString("base64"),
        mime_type: image.mimeType,
        display_name: generatedImageName(runtime.model, index, image.mimeType),
        has_transparency: image.hasTransparency,
      }),
    )
    return imageGenerationInternalResultSchema.parse({
      success: true,
      provider: runtime.provider,
      model: runtime.model,
      image_count: imageCount,
      unit_price: unitPrice,
      total_cost: totalCost,
      currency: pricingCurrency,
      transparency: projectTransparencyResult(transparencyStrategy),
      images: normalized,
    })
  }

  private async resolveRuntime(): Promise<ResolvedImageGenerationRuntime> {
    const stored = await this.readStoredSettings()
    if (!stored?.enabled || !stored.provider || !stored.model || !stored.apiKey) {
      throw new AppError("IMAGE_GENERATION_NOT_CONFIGURED")
    }
    return {
      revision: stored.revision,
      provider: stored.provider,
      providerOptions: stored.providerOptions,
      baseUrl: resolveProviderBaseUrl(stored.provider, stored.providerOptions),
      apiKey: stored.apiKey,
      model: stored.model,
      pricePerImage: stored.pricePerImage,
    }
  }

  private async readStoredSettings(): Promise<StoredImageGenerationSettings | null> {
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

function createStoredSettings(
  input: z.output<typeof updateImageGenerationSettingsSchema>,
  current: StoredImageGenerationSettings | null,
): StoredImageGenerationSettings {
  return storedImageGenerationSettingsSchema.parse({
    version: 1,
    revision: (current?.revision ?? 0) + 1,
    enabled: input.enabled,
    provider: input.provider,
    providerOptions: normalizedProviderOptions(
      input.provider,
      input.provider_options,
    ),
    apiKey: input.api_key ?? current?.apiKey ?? null,
    model: input.model,
    pricePerImage: input.price_per_image,
  })
}

function normalizedProviderOptions(
  provider: ImageGenerationProvider | null,
  options: ImageGenerationProviderOptions,
): ImageGenerationProviderOptions {
  const definition = imageGenerationProviderDefinitions.find(
    (candidate) => candidate.key === provider,
  )
  return imageGenerationProviderOptionsSchema.parse({
    workspace_id: options.workspace_id,
    region:
      options.region ??
      (provider === "alibaba_bailian"
        ? definition?.default_region ?? "cn-beijing"
        : null),
  })
}

function readStoredSettings(
  raw: Record<string, unknown>,
  masterKey: string,
  expectedKeyId: string,
): StoredImageGenerationSettings | null {
  const encrypted = raw[ENCRYPTED_SETTINGS_KEY]
  const keyId = raw[ENCRYPTION_KEY_ID_KEY]
  if (encrypted === undefined && keyId === undefined) return null
  if (typeof encrypted !== "string" || typeof keyId !== "string") {
    throw new Error("image generation settings envelope is incomplete")
  }
  if (keyId !== expectedKeyId) {
    throw new Error("image generation settings encryption key mismatch")
  }
  return storedImageGenerationSettingsSchema.parse(
    decryptJson<unknown>(encrypted, masterKey, expectedKeyId, ENCRYPTION_CONTEXT),
  )
}

function projectAdminSettings(
  stored: StoredImageGenerationSettings | null,
): ImageGenerationSettings {
  return imageGenerationSettingsSchema.parse({
    configured: stored?.apiKey !== null && stored?.apiKey !== undefined,
    revision: stored?.revision ?? 0,
    enabled: stored?.enabled ?? false,
    provider: stored?.provider ?? null,
    provider_options:
      stored?.providerOptions ?? imageGenerationProviderOptionsSchema.parse({}),
    base_url:
      stored?.provider && stored.enabled
        ? resolveProviderBaseUrl(stored.provider, stored.providerOptions)
        : stored?.provider
          ? resolveProviderBaseUrl(stored.provider, stored.providerOptions)
          : null,
    api_key_configured: stored?.apiKey !== null && stored?.apiKey !== undefined,
    model: stored?.model ?? null,
    price_per_image: stored?.pricePerImage ?? "0",
    currency: pricingCurrency,
    providers: imageGenerationProviderDefinitions,
  })
}

export function resolveProviderBaseUrl(
  provider: ImageGenerationProvider,
  options: ImageGenerationProviderOptions,
): string {
  const definition = imageGenerationProviderDefinitions.find(
    (candidate) => candidate.key === provider,
  )
  if (!definition) throw new AppError("VALIDATION_ERROR")
  if (provider !== "alibaba_bailian") return definition.base_url
  const workspaceId = options.workspace_id
  const region = options.region ?? definition.default_region ?? "cn-beijing"
  if (!workspaceId) return definition.base_url
  return `https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
}

function resolveTransparencyStrategy(
  runtime: ResolvedImageGenerationRuntime,
  request: ImageGenerationRequest,
): ImageTransparencyStrategy {
  if (request.background === "opaque") return { kind: "none" }

  const nativeSupported = supportsNativeTransparency(runtime)
  if (request.transparency_mode === "native") {
    if (!nativeSupported) {
      throw new AppError("IMAGE_GENERATION_TRANSPARENCY_UNSUPPORTED")
    }
    return { kind: "native" }
  }
  if (request.transparency_mode === "auto" && nativeSupported) {
    return { kind: "native" }
  }
  return {
    kind: "chroma_key",
    chromaKey: request.chroma_key ?? "green",
  }
}

function supportsNativeTransparency(
  runtime: ResolvedImageGenerationRuntime,
): boolean {
  if (runtime.provider !== "openai") return false
  return /^gpt-image-(?:1(?:\.5)?|1-mini)(?:$|-)/u.test(runtime.model)
}

function prepareProviderRequest(
  request: ImageGenerationRequest,
  strategy: ImageTransparencyStrategy,
): ImageGenerationRequest {
  if (strategy.kind !== "chroma_key") return request
  const keyHex = strategy.chromaKey === "magenta" ? "#ff00ff" : "#00ff00"
  const keyName = strategy.chromaKey === "magenta" ? "magenta" : "green"
  return {
    ...request,
    prompt: `${request.prompt}\n\nTransparent-background delivery requirements: Render the requested foreground subject fully inside the canvas with clear padding around it. Use a perfectly flat, uniform ${keyName} (${keyHex}) background across the entire canvas, including every corner. Do not add scenery, gradients, shadows, reflections, texture, border, vignette, glow, color cast, or background objects. Keep the foreground visually distinct from ${keyHex}. The solid background is a technical chroma key and will be removed after generation.`,
  }
}

function projectTransparencyResult(strategy: ImageTransparencyStrategy): {
  requested: boolean
  strategy: "none" | "native" | "chroma_key"
  chroma_key: "green" | "magenta" | null
} {
  if (strategy.kind === "none") {
    return { requested: false, strategy: "none", chroma_key: null }
  }
  if (strategy.kind === "native") {
    return { requested: true, strategy: "native", chroma_key: null }
  }
  return {
    requested: true,
    strategy: "chroma_key",
    chroma_key: strategy.chromaKey,
  }
}

async function generateWithProvider(
  runtime: ResolvedImageGenerationRuntime,
  request: ImageGenerationRequest,
  transparencyStrategy: ImageTransparencyStrategy,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  switch (runtime.provider) {
    case "alibaba_bailian":
      return generateWithAlibaba(runtime, request, fetchImpl, signal)
    case "openai":
      return generateWithOpenAI(
        runtime,
        request,
        transparencyStrategy,
        fetchImpl,
        signal,
      )
    case "together":
      return generateWithTogether(runtime, request, fetchImpl, signal)
    case "google_gemini":
      return generateWithGoogle(runtime, request, fetchImpl, signal)
    case "stability":
      return generateWithStability(runtime, request, fetchImpl, signal)
    case "fal":
      return generateWithFal(runtime, request, fetchImpl, signal)
    case "replicate":
      return generateWithReplicate(runtime, request, fetchImpl, signal)
    default:
      throw new AppError("IMAGE_GENERATION_UNAVAILABLE")
  }
}

async function generateWithAlibaba(
  runtime: ResolvedImageGenerationRuntime,
  request: ImageGenerationRequest,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  if (
    request.seed !== undefined &&
    request.seed > ALIBABA_BAILIAN_MAX_SEED
  ) {
    throw new AppError("VALIDATION_ERROR", {
      field: "seed",
      max: ALIBABA_BAILIAN_MAX_SEED,
    })
  }
  const response = await fetchImpl(
    runtime.baseUrl,
    withAbortSignal(
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: runtime.model,
          input: {
            messages: [
              {
                role: "user",
                content: [{ text: request.prompt }],
              },
            ],
          },
          parameters: {
            prompt_extend: true,
            n: request.count,
            ...(request.size ? { size: request.size.replace("x", "*") } : {}),
            ...(request.negative_prompt
              ? { negative_prompt: request.negative_prompt }
              : {}),
            ...(request.seed === undefined ? {} : { seed: request.seed }),
          },
        }),
      },
      signal,
    ),
  )
  return imagesFromJsonResponse(response, fetchImpl, signal)
}

async function generateWithOpenAI(
  runtime: ResolvedImageGenerationRuntime,
  request: ImageGenerationRequest,
  transparencyStrategy: ImageTransparencyStrategy,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  const response = await fetchImpl(
    `${runtime.baseUrl}/images/generations`,
    withAbortSignal(
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: runtime.model,
          prompt: request.prompt,
          n: request.count,
          ...(request.size ? { size: request.size } : {}),
          ...(openAiUsesImplicitBase64(runtime.model)
            ? {}
            : { response_format: "b64_json" }),
          ...(transparencyStrategy.kind === "native"
            ? { background: "transparent", output_format: "png" }
            : {}),
        }),
      },
      signal,
    ),
  )
  return imagesFromJsonResponse(response, fetchImpl, signal)
}

async function generateWithTogether(
  runtime: ResolvedImageGenerationRuntime,
  request: ImageGenerationRequest,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  const dimensions = parseImageDimensions(request.size)
  const response = await fetchImpl(
    `${runtime.baseUrl}/images/generations`,
    withAbortSignal(
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: runtime.model,
          prompt: request.prompt,
          n: request.count,
          response_format: "base64",
          output_format: "png",
          ...(dimensions ?? {}),
          ...(request.negative_prompt
            ? { negative_prompt: request.negative_prompt }
            : {}),
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        }),
      },
      signal,
    ),
  )
  return imagesFromJsonResponse(response, fetchImpl, signal)
}

async function generateWithGoogle(
  runtime: ResolvedImageGenerationRuntime,
  request: ImageGenerationRequest,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  const endpoint = new URL(
    `/v1/models/${encodeURIComponent(runtime.model)}:generateContent`,
    runtime.baseUrl,
  )
  const aspectRatio = closestAspectRatio(
    request.size,
    googleImageAspectRatios(runtime.model),
  )
  const imageSize = googleImageSize(runtime.model, request.size)
  const response = await fetchImpl(
    endpoint,
    withAbortSignal(
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": runtime.apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            ...(aspectRatio || imageSize
              ? {
                  responseFormat: {
                    image: {
                      ...(aspectRatio ? { aspectRatio } : {}),
                      ...(imageSize ? { imageSize } : {}),
                    },
                  },
                }
              : {}),
            ...(request.seed === undefined ? {} : { seed: request.seed }),
          },
        }),
      },
      signal,
    ),
  )
  return imagesFromGoogleResponse(response, fetchImpl, signal)
}

async function generateWithStability(
  runtime: ResolvedImageGenerationRuntime,
  request: ImageGenerationRequest,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  if (request.seed !== undefined && request.seed > STABILITY_MAX_SEED) {
    throw new AppError("VALIDATION_ERROR", {
      field: "seed",
      max: STABILITY_MAX_SEED,
    })
  }
  const form = new FormData()
  form.set("prompt", request.prompt)
  form.set("output_format", "png")
  const aspectRatio = closestAspectRatio(
    request.size,
    STABILITY_IMAGE_ASPECT_RATIOS,
  )
  if (aspectRatio) form.set("aspect_ratio", aspectRatio)
  if (request.negative_prompt) form.set("negative_prompt", request.negative_prompt)
  if (request.seed !== undefined) form.set("seed", String(request.seed))
  const target = stabilityGenerationTarget(runtime.model)
  if (target.model) form.set("model", target.model)
  const endpoint = `${runtime.baseUrl}/v2beta/stable-image/generate/${target.path}`
  const response = await fetchImpl(
    endpoint,
    withAbortSignal(
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.apiKey}`,
          accept: "image/*",
        },
        body: form,
      },
      signal,
    ),
  )
  if (!response.ok) throw await providerErrorFromResponse(response)
  return [await imageFromBinaryResponse(response)]
}

async function generateWithFal(
  runtime: ResolvedImageGenerationRuntime,
  request: ImageGenerationRequest,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  const dimensions = parseImageDimensions(request.size)
  const response = await fetchImpl(
    `${runtime.baseUrl}/${runtime.model}`,
    withAbortSignal(
      {
        method: "POST",
        headers: {
          authorization: `Key ${runtime.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: request.prompt,
          num_images: request.count,
          output_format: "png",
          ...(dimensions ? { image_size: dimensions } : {}),
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        }),
      },
      signal,
    ),
  )
  return imagesFromJsonResponse(response, fetchImpl, signal)
}

async function generateWithReplicate(
  runtime: ResolvedImageGenerationRuntime,
  request: ImageGenerationRequest,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  const aspectRatio = closestAspectRatio(
    request.size,
    REPLICATE_IMAGE_ASPECT_RATIOS,
  )
  const response = await fetchImpl(
    `${runtime.baseUrl}/models/${runtime.model}/predictions`,
    withAbortSignal(
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.apiKey}`,
          "content-type": "application/json",
          prefer: "wait=60",
        },
        body: JSON.stringify({
          input: {
            prompt: request.prompt,
            num_outputs: request.count,
            output_format: "png",
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(request.seed === undefined ? {} : { seed: request.seed }),
          },
        }),
      },
      signal,
    ),
  )
  const prediction = await jsonResponse(response)
  const completed = await pollReplicatePrediction(
    prediction,
    runtime.apiKey,
    fetchImpl,
    signal,
  )
  return imagesFromRefs(
    extractReplicateOutputRefs(completed),
    fetchImpl,
    signal,
  )
}

async function pollReplicatePrediction(
  initial: unknown,
  apiKey: string,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<unknown> {
  let prediction = initial
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = objectValue(prediction, "status")
    if (status === "succeeded") return prediction
    if (status === "failed" || status === "canceled") {
      const providerMessage = firstSanitizedString(
        1_000,
        objectValue(prediction, "error"),
      )
      const providerRequestId = firstSanitizedString(
        240,
        objectValue(prediction, "id"),
      )
      throw new AppError("IMAGE_GENERATION_PROVIDER_REJECTED", {
        provider_code: `replicate_${String(status)}`,
        ...(providerMessage ? { provider_message: providerMessage } : {}),
        ...(providerRequestId
          ? { provider_request_id: providerRequestId }
          : {}),
      })
    }
    const getUrl = objectValue(objectValue(prediction, "urls"), "get")
    if (typeof getUrl !== "string") break
    await delay(1_000, signal)
    const response = await fetchImpl(
      getUrl,
      withAbortSignal(
        { headers: { authorization: `Bearer ${apiKey}` } },
        signal,
      ),
    )
    prediction = await jsonResponse(response)
  }
  throw new AppError("IMAGE_GENERATION_UNAVAILABLE")
}

async function imagesFromJsonResponse(
  response: Response,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  return imagesFromRefs(extractImageRefs(await jsonResponse(response)), fetchImpl, signal)
}

async function imagesFromGoogleResponse(
  response: Response,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  return imagesFromRefs(
    extractGoogleImageRefs(await jsonResponse(response)),
    fetchImpl,
    signal,
  )
}

async function imagesFromRefs(
  refs: ImageRef[],
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  const images = await Promise.all(
    refs.map((ref) => imageFromRef(ref, fetchImpl, signal)),
  )
  return images.filter((image): image is ProviderImage => image !== null)
}

async function jsonResponse(response: Response): Promise<unknown> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (response.ok) throw new AppError("IMAGE_GENERATION_OUTPUT_INVALID")
    throw providerResponseError(response, null)
  }
  if (!response.ok) throw providerResponseError(response, body)
  return body
}

async function imageFromRef(
  ref: ImageRef,
  fetchImpl: ImageGenerationFetch,
  signal?: AbortSignal,
): Promise<ProviderImage | null> {
  if (ref.base64) {
    const match = /^data:([^;]+);base64,(.+)$/u.exec(ref.base64)
    const payload = match?.[2] ?? ref.base64
    if (payload.length > MAX_IMAGE_BASE64_CHARACTERS) {
      throw new AppError("IMAGE_GENERATION_OUTPUT_INVALID")
    }
    const bytes = Buffer.from(payload, "base64")
    return providerImageFromBytes(bytes)
  }
  if (!ref.url) return null
  const response = await fetchImpl(ref.url, withAbortSignal({}, signal))
  if (!response.ok) throw new AppError("IMAGE_GENERATION_OUTPUT_INVALID")
  return imageFromBinaryResponse(response)
}

async function imageFromBinaryResponse(response: Response): Promise<ProviderImage> {
  const bytes = Buffer.from(await response.arrayBuffer())
  return providerImageFromBytes(bytes)
}

function providerImageFromBytes(bytes: Buffer): ProviderImage {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError("IMAGE_GENERATION_OUTPUT_INVALID")
  }
  const detectedMimeType = detectSafeRasterImage(bytes)
  if (
    detectedMimeType !== "image/png" &&
    detectedMimeType !== "image/jpeg" &&
    detectedMimeType !== "image/webp"
  ) {
    throw new AppError("IMAGE_GENERATION_OUTPUT_INVALID")
  }
  return { bytes, mimeType: detectedMimeType }
}

type ImageRef = { url?: string; base64?: string; mimeType?: string }

function extractImageRefs(value: unknown): ImageRef[] {
  const refs: ImageRef[] = []
  visitImageRefs(value, refs, new Set<string>())
  return refs
}

function extractGoogleImageRefs(value: unknown): ImageRef[] {
  const refs: ImageRef[] = []
  const seen = new Set<string>()
  const candidates = objectValue(value, "candidates")
  if (!Array.isArray(candidates)) return refs
  for (const candidate of candidates) {
    const parts = objectValue(objectValue(candidate, "content"), "parts")
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      if (objectValue(part, "thought") === true) continue
      const inlineData =
        objectValue(part, "inlineData") ?? objectValue(part, "inline_data")
      const data = objectValue(inlineData, "data")
      if (typeof data !== "string") continue
      const mimeType =
        objectValue(inlineData, "mimeType") ??
        objectValue(inlineData, "mime_type")
      appendImageRef(
        {
          base64: data,
          ...(typeof mimeType === "string" ? { mimeType } : {}),
        },
        refs,
        seen,
      )
    }
  }
  return refs
}

function extractReplicateOutputRefs(prediction: unknown): ImageRef[] {
  const refs: ImageRef[] = []
  const seen = new Set<string>()
  visitReplicateOutput(objectValue(prediction, "output"), refs, seen)
  return refs
}

function visitReplicateOutput(
  value: unknown,
  refs: ImageRef[],
  seen: Set<string>,
): void {
  if (typeof value === "string") {
    appendImageRefCandidate(value, refs, seen)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) visitReplicateOutput(item, refs, seen)
    return
  }
  visitImageRefs(value, refs, seen)
}

function visitImageRefs(
  value: unknown,
  refs: ImageRef[],
  seen: Set<string>,
): void {
  if (refs.length >= MAX_PROVIDER_IMAGE_REFS) return
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) visitImageRefs(item, refs, seen)
    return
  }
  const record = value as Record<string, unknown>
  const inlineData = objectValue(record, "inlineData")
  const inlineDataMime = objectValue(inlineData, "mimeType")
  const inlineDataData = objectValue(inlineData, "data")
  if (typeof inlineDataData === "string") {
    appendImageRef(
      {
        base64: inlineDataData,
        ...(typeof inlineDataMime === "string"
          ? { mimeType: inlineDataMime }
          : {}),
      },
      refs,
      seen,
    )
  }
  for (const key of [
    "b64_json",
    "base64",
    "data_base64",
    "image_base64",
  ]) {
    const data = record[key]
    if (typeof data === "string") {
      appendImageRef({ base64: data }, refs, seen)
    }
  }
  for (const key of ["image", "image_url", "uri"]) {
    appendImageRefCandidate(record[key], refs, seen)
  }
  if (isLikelyImageRecord(record)) {
    appendImageRefCandidate(record.url, refs, seen)
  }
  for (const item of Object.values(record)) visitImageRefs(item, refs, seen)
}

function appendImageRefCandidate(
  value: unknown,
  refs: ImageRef[],
  seen: Set<string>,
): void {
  if (typeof value !== "string") return
  if (/^https?:\/\//iu.test(value)) {
    appendImageRef({ url: value }, refs, seen)
    return
  }
  if (/^data:image\/[a-z0-9.+-]+;base64,/iu.test(value)) {
    appendImageRef({ base64: value }, refs, seen)
  }
}

function appendImageRef(
  ref: ImageRef,
  refs: ImageRef[],
  seen: Set<string>,
): void {
  if (refs.length >= MAX_PROVIDER_IMAGE_REFS) return
  const key = ref.url ? `url:${ref.url}` : `base64:${ref.base64 ?? ""}`
  if (seen.has(key)) return
  seen.add(key)
  refs.push(ref)
}

function isLikelyImageRecord(record: Record<string, unknown>): boolean {
  if (typeof record.url !== "string") return false
  const contentType = firstSanitizedString(
    120,
    record.content_type,
    record.mime_type,
    record.mimeType,
  )
  if (contentType?.toLowerCase().startsWith("image/")) return true
  if (
    typeof record.width === "number" ||
    typeof record.height === "number" ||
    "revised_prompt" in record
  ) {
    return true
  }
  return Object.keys(record).length === 1
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined
}

async function providerErrorFromResponse(
  response: Response,
): Promise<AppError> {
  try {
    const contentType = response.headers.get("content-type") ?? ""
    const body = contentType.toLowerCase().includes("json")
      ? await response.json()
      : await response.text()
    return providerResponseError(response, body)
  } catch {
    return providerResponseError(response, null)
  }
}

function providerResponseError(response: Response, body: unknown): AppError {
  const retryable =
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500
  return new AppError(
    retryable
      ? "IMAGE_GENERATION_UNAVAILABLE"
      : "IMAGE_GENERATION_PROVIDER_REJECTED",
    providerRejectedParams(response, body),
  )
}

function providerRejectedParams(
  response: Response,
  body: unknown,
): Record<string, JsonValue> | undefined {
  const record = asObject(body)
  const nestedError = asObject(record.error)
  const providerCode = firstSanitizedString(
    240,
    record.code,
    record.Code,
    record.error_code,
    record.name,
    nestedError.code,
    nestedError.type,
  )
  const providerMessage = firstSanitizedString(
    1_000,
    record.message,
    record.Message,
    nestedError.message,
    providerErrorDetail(record.errors),
    providerErrorDetail(record.detail),
    providerErrorDetail(record.error),
    typeof body === "string" ? body : undefined,
    response.statusText,
  )
  const providerRequestId = firstSanitizedString(
    240,
    record.request_id,
    record.requestId,
    record.RequestId,
    record.id,
    response.headers.get("x-request-id"),
    response.headers.get("x-acs-request-id"),
  )
  const params: Record<string, JsonValue> = {}
  if (providerCode) params.provider_code = providerCode
  if (providerMessage) params.provider_message = providerMessage
  if (providerRequestId) params.provider_request_id = providerRequestId
  return Object.keys(params).length > 0 ? params : undefined
}

function providerErrorDetail(value: unknown): string | null {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    const messages = value
      .map((item) => providerErrorDetail(item))
      .filter((item): item is string => item !== null)
    return messages.length > 0 ? messages.join("; ") : null
  }
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return firstSanitizedString(
    1_000,
    record.message,
    record.msg,
    record.detail,
    record.reason,
    record.title,
  )
}

function firstSanitizedString(
  maxLength: number,
  ...values: unknown[]
): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue
    const normalized = value
      .split("")
      .map((character) => (isControlCharacter(character) ? " " : character))
      .join("")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, maxLength)
    if (normalized) return normalized
  }
  return null
}

function isControlCharacter(value: string): boolean {
  const code = value.charCodeAt(0)
  return code <= 31 || code === 127
}

function generatedImageName(
  model: string,
  index: number,
  mimeType: ProviderImage["mimeType"],
): string {
  const extension =
    mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png"
  return `${model.replace(/[^A-Za-z0-9._-]+/gu, "-")}-${index + 1}.${extension}`
}

function providerMaxImages(
  provider: ImageGenerationProvider,
  model: string,
): number {
  if (provider === "openai" && model.startsWith("dall-e-3")) return 1
  return (
    imageGenerationProviderDefinitions.find((candidate) => candidate.key === provider)
      ?.max_images ?? 1
  )
}

function openAiUsesImplicitBase64(model: string): boolean {
  return model.startsWith("gpt-image-") || model.startsWith("chatgpt-image-")
}

function parseImageDimensions(
  size: string | undefined,
): { width: number; height: number } | null {
  if (!size) return null
  const match = /^(\d+)x(\d+)$/u.exec(size)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null
  return { width, height }
}

function closestAspectRatio(
  size: string | undefined,
  supported: readonly string[],
): string | null {
  const dimensions = parseImageDimensions(size)
  if (!dimensions) return null
  const requestedRatio = dimensions.width / dimensions.height
  let closest: string | null = null
  let closestDistance = Number.POSITIVE_INFINITY
  for (const ratio of supported) {
    const match = /^(\d+):(\d+)$/u.exec(ratio)
    if (!match) continue
    const candidateRatio = Number(match[1]) / Number(match[2])
    const distance = Math.abs(Math.log(requestedRatio / candidateRatio))
    if (distance < closestDistance) {
      closest = ratio
      closestDistance = distance
    }
  }
  return closest
}

function googleImageAspectRatios(model: string): readonly string[] {
  return model.startsWith("gemini-3.1-flash")
    ? GOOGLE_FLASH_IMAGE_ASPECT_RATIOS
    : GOOGLE_IMAGE_ASPECT_RATIOS
}

function googleImageSize(
  model: string,
  size: string | undefined,
): "512" | "1K" | "2K" | "4K" | null {
  const dimensions = parseImageDimensions(size)
  if (!dimensions || model === "gemini-2.5-flash-image") return null
  if (model === "gemini-3.1-flash-lite-image") return "1K"
  const longestEdge = Math.max(dimensions.width, dimensions.height)
  if (model === "gemini-3.1-flash-image" && longestEdge <= 512) return "512"
  if (longestEdge <= 1_024) return "1K"
  if (longestEdge <= 2_048) return "2K"
  return "4K"
}

function stabilityGenerationTarget(model: string): {
  path: "core" | "ultra" | "sd3"
  model?: string
} {
  if (model === "stable-image-core" || model === "core") {
    return { path: "core" }
  }
  if (model === "stable-image-ultra" || model === "ultra") {
    return { path: "ultra" }
  }
  if (model.startsWith("sd3")) return { path: "sd3", model }
  throw new AppError("VALIDATION_ERROR", {
    field: "model",
    provider: "stability",
  })
}

function multiplyPrice(price: string, count: number): string {
  return microsToPrice(priceToMicros(price) * BigInt(count))
}

function pricePerImageAsPerMillion(price: string): string {
  return microsToPrice(priceToMicros(price) * 1_000_000n)
}

function priceToMicros(value: string): bigint {
  const normalized = imageGenerationPricePerImageSchema.parse(value)
  const [whole = "0", fraction = ""] = normalized.split(".")
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0")
}

function microsToPrice(value: bigint): string {
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, "0")
  const trimmed = fraction.replace(/0+$/u, "")
  return trimmed ? `${whole}.${trimmed}` : whole.toString()
}

function withAbortSignal(init: RequestInit, signal?: AbortSignal): RequestInit {
  return signal ? { ...init, signal } : init
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new AppError("IMAGE_GENERATION_UNAVAILABLE")
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new AppError("IMAGE_GENERATION_UNAVAILABLE"))
      },
      { once: true },
    )
  })
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
