import { z } from "zod"
import {
  modelIdentifierSchema,
  type DiscoverImageGenerationModelsInput,
  type DiscoverModelProviderResult,
} from "@linksense/shared"

import { AppError } from "../../lib/errors.js"
import { createBoundedModelProviderFetch } from "./model-provider-probe.js"

const MODEL_LIMIT = 100
const modelSchema = z.object({
  id: modelIdentifierSchema,
  name: z.string().nullish(),
  display_name: z.string().nullish(),
  type: z.string().optional(),
})
const compatibleListSchema = z.union([
  z.object({ data: z.array(modelSchema).max(10_000), has_more: z.boolean().optional() }),
  z.array(modelSchema).max(10_000).transform((data) => ({ data, has_more: false })),
])
const bailianListSchema = z.object({
  output: z.object({
    total: z.number().int().nonnegative(),
    models: z.array(z.object({
      model: modelIdentifierSchema,
      name: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      inference_metadata: z.object({ response_modality: z.array(z.string()) }).optional(),
    })).max(10_000),
  }),
})
const googleListSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    displayName: z.string().optional(),
    supportedGenerationMethods: z.array(z.string()).optional(),
  })).max(10_000),
  nextPageToken: z.string().optional(),
})
const falListSchema = z.object({
  models: z.array(z.object({
    endpoint_id: modelIdentifierSchema,
    metadata: z.object({ display_name: z.string().optional(), category: z.string().optional() }).optional(),
  })).max(10_000),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullable().optional(),
})
const replicateListSchema = z.object({
  models: z.array(z.object({ owner: z.string(), name: z.string() })).max(10_000),
})

export async function discoverImageGenerationModels(
  input: DiscoverImageGenerationModelsInput & { api_key: string },
  fetcher: typeof fetch = fetch,
  parentSignal?: AbortSignal,
): Promise<DiscoverModelProviderResult> {
  if (input.provider === "stability") return { status: "manual_required", models: [], truncated: false }
  const scope = new URL(input.base_url)
  let endpoint = "models"
  const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${input.api_key}` }
  if (input.provider === "alibaba_bailian") {
    const servicePath = scope.pathname.indexOf("/api/v1/services/")
    if (servicePath < 0) return { status: "manual_required", models: [], truncated: false }
    scope.pathname = `${scope.pathname.slice(0, servicePath)}/api/v1`
  } else if (input.provider === "google_gemini") {
    scope.pathname = `${scope.pathname.replace(/\/+$/u, "")}/v1beta`
    delete headers.authorization
    headers["x-goog-api-key"] = input.api_key
  } else if (input.provider === "fal") {
    headers.authorization = `Key ${input.api_key}`
    if (scope.href === "https://fal.run/") {
      scope.href = "https://api.fal.ai/v1"
      // The public catalog needs no credentials on the separate platform host.
      delete headers.authorization
    }
  } else if (input.provider === "replicate") {
    endpoint = "collections/text-to-image"
  }
  const url = new URL(`${scope.href.replace(/\/+$/u, "")}/${endpoint}`)
  if (input.provider === "alibaba_bailian") {
    url.searchParams.set("capabilities", "IG")
    url.searchParams.set("page_no", "1")
    url.searchParams.set("page_size", String(MODEL_LIMIT))
  } else if (input.provider === "google_gemini") {
    url.searchParams.set("pageSize", "1000")
  } else if (input.provider === "fal") {
    url.searchParams.set("category", "text-to-image")
    url.searchParams.set("status", "active")
    url.searchParams.set("limit", String(MODEL_LIMIT))
  }
  try {
    const signal = AbortSignal.any([AbortSignal.timeout(12_000), ...(parentSignal ? [parentSignal] : [])])
    const response = await createBoundedModelProviderFetch(scope.href, fetcher, signal)(url, { method: "GET", headers, signal })
    if (response.status === 404 || response.status === 405) return { status: "manual_required", models: [], truncated: false }
    if (!response.ok) throw new AppError("MODEL_PROVIDER_DISCOVERY_FAILED")
    const payload: unknown = await response.json()
    let models: Array<{ id: string; display_name?: string | null | undefined }>
    let truncated = false
    switch (input.provider) {
      case "alibaba_bailian": {
        const { output } = bailianListSchema.parse(payload)
        models = output.models.filter((model) =>
          (!model.capabilities && !model.inference_metadata) || model.capabilities?.includes("IG") || model.inference_metadata?.response_modality.includes("Image"),
        ).map((model) => ({ id: model.model, display_name: model.name }))
        truncated = output.total > output.models.length
        break
      }
      case "google_gemini": {
        const result = googleListSchema.parse(payload)
        // shortcut: Google's catalog has no output modality; keep its published image model IDs.
        models = result.models.filter((model) => /image/iu.test(model.name) &&
          model.supportedGenerationMethods?.includes("generateContent"),
        ).map((model) => ({ id: modelIdentifierSchema.parse(model.name.replace(/^models\//u, "")), display_name: model.displayName }))
        truncated = Boolean(result.nextPageToken)
        break
      }
      case "fal": {
        const result = falListSchema.parse(payload)
        models = result.models.filter((model) => !model.metadata?.category || model.metadata.category === "text-to-image")
          .map((model) => ({ id: model.endpoint_id, display_name: model.metadata?.display_name }))
        truncated = Boolean(result.has_more || result.next_cursor)
        break
      }
      case "replicate": {
        models = replicateListSchema.parse(payload).models.map((model) => ({ id: modelIdentifierSchema.parse(`${model.owner}/${model.name}`) }))
        break
      }
      default: {
        const result = compatibleListSchema.parse(payload)
        models = result.data.filter((model) => !["chat", "language", "text", "completion", "text-generation", "embedding", "rerank", "audio", "video", "transcription", "moderation"].includes(model.type ?? ""))
          .map((model) => ({ id: model.id, display_name: model.display_name ?? model.name }))
        truncated = Boolean(result.has_more)
      }
    }
    const unique = [...new Map(models.map((model) => [model.id, model])).values()]
    return {
      status: "supported", truncated: truncated || unique.length > MODEL_LIMIT,
      models: unique.slice(0, MODEL_LIMIT).map((model) => ({
        id: model.id, display_name: (model.display_name?.trim() || model.id).slice(0, 120),
        context_window: null, supports_image_input: null,
      })),
    }
  } catch {
    throw new AppError("MODEL_PROVIDER_DISCOVERY_FAILED")
  }
}
