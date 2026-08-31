import { createAlibaba } from "@ai-sdk/alibaba"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createGoogle } from "@ai-sdk/google"
import { createGoogleVertex } from "@ai-sdk/google-vertex"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type {
  ModelProviderProtocolMode,
  ModelServiceProvider,
} from "@linksense/shared"
import type { LanguageModel } from "ai"

export type ProviderLanguageModelRuntime = {
  provider: ModelServiceProvider
  model: string
  apiKey: string
  baseUrl?: string | null
  project?: string | null
  location?: string | null
  protocolMode?: ModelProviderProtocolMode
}

export type ProviderLanguageModelOptions = {
  fetch?: typeof fetch
  openAICompatibleName?: string
  supportsStructuredOutputs?: boolean
}

export function createProviderLanguageModel(
  runtime: ProviderLanguageModelRuntime,
  options: ProviderLanguageModelOptions = {},
): LanguageModel {
  switch (runtime.provider) {
    case "openai": {
      const provider = createOpenAI({
        apiKey: runtime.apiKey,
        ...(runtime.baseUrl ? { baseURL: runtime.baseUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
      return runtime.protocolMode === "chat_completions_bridge"
        ? provider.chat(runtime.model)
        : provider(runtime.model)
    }
    case "azure_openai": {
      const provider = createAzure({
        apiKey: runtime.apiKey,
        baseURL: requiredBaseUrl(runtime),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
      return runtime.protocolMode === "chat_completions_bridge"
        ? provider.chat(runtime.model)
        : provider(runtime.model)
    }
    case "anthropic":
      return createAnthropic({
        apiKey: runtime.apiKey,
        ...(runtime.baseUrl ? { baseURL: runtime.baseUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })(runtime.model)
    case "google":
      return createGoogle({
        apiKey: runtime.apiKey,
        ...(runtime.baseUrl ? { baseURL: runtime.baseUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })(runtime.model)
    case "google_vertex":
      return createGoogleVertex({
        apiKey: runtime.apiKey,
        ...(runtime.project ? { project: runtime.project } : {}),
        ...(runtime.location ? { location: runtime.location } : {}),
        ...(runtime.baseUrl ? { baseURL: runtime.baseUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })(runtime.model)
    case "alibaba":
      return createAlibaba({
        apiKey: runtime.apiKey,
        ...(runtime.baseUrl ? { baseURL: runtime.baseUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })(runtime.model)
    case "deepseek":
      return createDeepSeek({
        apiKey: runtime.apiKey,
        ...(runtime.baseUrl ? { baseURL: runtime.baseUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })(runtime.model)
    case "openrouter":
      return createOpenRouter({
        apiKey: runtime.apiKey,
        compatibility: "strict",
        ...(runtime.baseUrl ? { baseURL: runtime.baseUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })(runtime.model)
    case "openai_compatible":
      return createOpenAICompatible({
        name: options.openAICompatibleName ?? "linksense-openai-compatible",
        apiKey: runtime.apiKey,
        baseURL: requiredBaseUrl(runtime),
        supportsStructuredOutputs: options.supportsStructuredOutputs ?? false,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })(runtime.model)
  }
}

function requiredBaseUrl(runtime: ProviderLanguageModelRuntime): string {
  if (!runtime.baseUrl) {
    throw new Error("provider base URL is required")
  }
  return runtime.baseUrl
}
