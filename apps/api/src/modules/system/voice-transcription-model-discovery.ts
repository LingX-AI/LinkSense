import { z } from "zod"
import {
  modelIdentifierSchema,
  type DiscoverModelProviderResult,
  type DiscoverVoiceTranscriptionModelsInput,
} from "@linksense/shared"

import { AppError } from "../../lib/errors.js"
import { createBoundedModelProviderFetch } from "./model-provider-probe.js"

const MODEL_LIMIT = 100
const compatibleListSchema = z.object({
  data: z.array(z.object({
    id: modelIdentifierSchema,
    name: z.string().nullish(),
    display_name: z.string().nullish(),
  })).max(10_000),
  has_more: z.boolean().optional(),
})
const deepgramListSchema = z.object({
  stt: z.array(z.object({
    canonical_name: modelIdentifierSchema,
    batch: z.boolean(),
  })).max(10_000),
})

export async function discoverVoiceTranscriptionModels(
  input: DiscoverVoiceTranscriptionModelsInput & { api_key: string },
  fetcher: typeof fetch = fetch,
  parentSignal?: AbortSignal,
): Promise<DiscoverModelProviderResult> {
  if (!["openai", "openai_compatible", "dashscope", "groq", "deepgram"].includes(input.provider)) {
    return { status: "manual_required", models: [], truncated: false }
  }

  try {
    const signal = AbortSignal.any([AbortSignal.timeout(12_000), ...(parentSignal ? [parentSignal] : [])])
    const isDeepgram = input.provider === "deepgram"
    const url = new URL(`${input.base_url.replace(/\/+$/u, "")}/${isDeepgram ? "v1/models" : "models"}`)
    const response = await createBoundedModelProviderFetch(input.base_url, fetcher, signal)(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: `${isDeepgram ? "Token" : "Bearer"} ${input.api_key}` },
      signal,
    })
    if (response.status === 404 || response.status === 405) {
      return { status: "manual_required", models: [], truncated: false }
    }
    if (!response.ok) throw new Error("model catalog unavailable")
    const payload: unknown = await response.json()
    const parsed = isDeepgram ? deepgramListSchema.parse(payload) : compatibleListSchema.parse(payload)
    const candidates = "stt" in parsed
      ? parsed.stt.filter((model) => model.batch).map((model) => ({
          id: model.canonical_name,
          display_name: model.canonical_name,
        }))
      : parsed.data.map((model) => ({ id: model.id, display_name: model.display_name ?? model.name ?? model.id }))
    const unique = [...new Map(candidates.map((model) => [model.id, model])).values()]
    return {
      status: "supported",
      truncated: ("has_more" in parsed && Boolean(parsed.has_more)) || unique.length > MODEL_LIMIT,
      models: unique.slice(0, MODEL_LIMIT).map((model) => ({
        id: model.id,
        display_name: (model.display_name.trim() || model.id).slice(0, 120),
        context_window: null,
        supports_image_input: null,
      })),
    }
  } catch {
    throw new AppError("MODEL_PROVIDER_DISCOVERY_FAILED")
  }
}
