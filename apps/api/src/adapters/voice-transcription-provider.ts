import { createAssemblyAI } from "@ai-sdk/assemblyai"
import { createAzure } from "@ai-sdk/azure"
import { createDeepgram } from "@ai-sdk/deepgram"
import { createElevenLabs } from "@ai-sdk/elevenlabs"
import { createFal } from "@ai-sdk/fal"
import { createGladia } from "@ai-sdk/gladia"
import { createGroq } from "@ai-sdk/groq"
import { createOpenAI } from "@ai-sdk/openai"
import { createRevai } from "@ai-sdk/revai"
import { transcribe, type TranscriptionModel } from "ai"

import type {
  VoiceTranscriptionProvider,
  VoiceTranscriptionProviderOptions,
} from "@linksense/shared"

import type { VoiceTranscriptionInput } from "../modules/voice/service.js"
import { DashScopeAsrClient, DashScopeAsrError } from "./dashscope-asr.js"

const TRANSCRIPTION_TIMEOUT_MS = 30_000

const FIXED_PROVIDER_BASE_URLS = {
  deepgram: "https://api.deepgram.com",
  assemblyai: "https://api.assemblyai.com",
  elevenlabs: "https://api.elevenlabs.io",
  revai: "https://api.rev.ai",
  gladia: "https://api.gladia.io",
  fal: "https://queue.fal.run",
} as const

export type VoiceTranscriptionRuntime = {
  provider: VoiceTranscriptionProvider
  providerOptions: VoiceTranscriptionProviderOptions
  baseUrl: string
  apiKey: string
  model: string
}

export type VoiceTranscriptionRunner = (
  runtime: VoiceTranscriptionRuntime,
  input: VoiceTranscriptionInput,
) => Promise<string>

export function createVoiceTranscriptionRunner(
  fetchImpl: typeof fetch = fetch,
): VoiceTranscriptionRunner {
  return async (runtime, input) => {
    if (runtime.provider === "dashscope") {
      let text = ""
      const client = new DashScopeAsrClient({
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        fetchImpl,
      })
      for await (const delta of client.streamTranscription(input)) text += delta
      return text.trim()
    }

    const requestController = new AbortController()
    let timedOut = false
    const abortFromCaller = () => requestController.abort()
    if (input.signal?.aborted) abortFromCaller()
    else input.signal?.addEventListener("abort", abortFromCaller, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      requestController.abort()
    }, TRANSCRIPTION_TIMEOUT_MS)
    timeout.unref()

    try {
      const providerOptions = createProviderOptions(
        runtime.provider,
        input.language,
      )
      const result = await transcribe({
        model: createTranscriptionModel(runtime, fetchImpl),
        audio: decodeAudioDataUrl(input.audioDataUrl),
        ...(providerOptions ? { providerOptions } : {}),
        maxRetries: 0,
        abortSignal: requestController.signal,
      })
      return result.text.trim()
    } catch (error) {
      if (timedOut) throw new VoiceTranscriptionProviderError("timeout")
      if (input.signal?.aborted) {
        throw new VoiceTranscriptionProviderError("aborted")
      }
      throw new VoiceTranscriptionProviderError("upstream", { cause: error })
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener("abort", abortFromCaller)
    }
  }
}

export type VoiceTranscriptionProviderFailureReason =
  | "not_configured"
  | "timeout"
  | "aborted"
  | "upstream"
  | "no_content"

export class VoiceTranscriptionProviderError extends Error {
  constructor(
    readonly reason: VoiceTranscriptionProviderFailureReason,
    options?: ErrorOptions,
  ) {
    super(`voice_transcription_${reason}`, options)
    this.name = "VoiceTranscriptionProviderError"
  }
}

function createTranscriptionModel(
  runtime: VoiceTranscriptionRuntime,
  fetchImpl: typeof fetch,
): TranscriptionModel {
  const common = { apiKey: runtime.apiKey }
  switch (runtime.provider) {
    case "openai":
      return createOpenAI({
        ...common,
        baseURL: runtime.baseUrl,
        fetch: fetchImpl,
      }).transcription(runtime.model)
    case "openai_compatible":
      return createOpenAI({
        ...common,
        baseURL: runtime.baseUrl,
        name: "openai-compatible",
        fetch: fetchImpl,
      }).transcription(runtime.model)
    case "azure_openai":
      return createAzure({
        ...common,
        baseURL: runtime.baseUrl,
        apiVersion: runtime.providerOptions.api_version ?? "preview",
        fetch: fetchImpl,
      }).transcription(runtime.model)
    case "groq":
      return createGroq({
        ...common,
        baseURL: runtime.baseUrl,
        fetch: fetchImpl,
      }).transcription(runtime.model)
    case "deepgram":
      return createDeepgram({
        ...common,
        fetch: rewriteProviderFetch(
          FIXED_PROVIDER_BASE_URLS.deepgram,
          runtime.baseUrl,
          fetchImpl,
        ),
      }).transcription(runtime.model)
    case "assemblyai":
      return createAssemblyAI({
        ...common,
        fetch: rewriteProviderFetch(
          FIXED_PROVIDER_BASE_URLS.assemblyai,
          runtime.baseUrl,
          fetchImpl,
        ),
      }).transcription(resolveAssemblyAiModel(runtime.model))
    case "elevenlabs":
      return createElevenLabs({
        ...common,
        fetch: rewriteProviderFetch(
          FIXED_PROVIDER_BASE_URLS.elevenlabs,
          runtime.baseUrl,
          fetchImpl,
        ),
      }).transcription(resolveElevenLabsModel(runtime.model))
    case "revai":
      return createRevai({
        ...common,
        fetch: rewriteProviderFetch(
          FIXED_PROVIDER_BASE_URLS.revai,
          runtime.baseUrl,
          fetchImpl,
        ),
      }).transcription(resolveRevAiModel(runtime.model))
    case "gladia":
      if (runtime.model !== "default") {
        throw new VoiceTranscriptionProviderError("upstream")
      }
      return createGladia({
        ...common,
        fetch: rewriteProviderFetch(
          FIXED_PROVIDER_BASE_URLS.gladia,
          runtime.baseUrl,
          fetchImpl,
        ),
      }).transcription()
    case "fal":
      return createFal({
        ...common,
        fetch: rewriteProviderFetch(
          FIXED_PROVIDER_BASE_URLS.fal,
          runtime.baseUrl,
          fetchImpl,
        ),
      }).transcription(runtime.model)
    case "dashscope":
      throw new DashScopeAsrError("invalid_response")
  }
}

function createProviderOptions(
  provider: Exclude<VoiceTranscriptionProvider, "dashscope">,
  locale: VoiceTranscriptionInput["language"],
): Record<string, Record<string, string>> | undefined {
  if (!locale) return undefined
  const language = locale === "zh-CN" ? "zh" : "en"
  switch (provider) {
    case "openai":
    case "openai_compatible":
    case "azure_openai":
      return { openai: { language } }
    case "groq":
      return { groq: { language } }
    case "deepgram":
      return { deepgram: { language } }
    case "assemblyai":
      return { assemblyai: { languageCode: language } }
    case "elevenlabs":
      return { elevenlabs: { languageCode: language } }
    case "revai":
      return { revai: { language } }
    case "gladia":
      return { gladia: { language } }
    case "fal":
      return { fal: { language } }
  }
}

function decodeAudioDataUrl(dataUrl: string): Uint8Array {
  const separator = dataUrl.indexOf(",")
  if (separator < 0) throw new VoiceTranscriptionProviderError("upstream")
  return Buffer.from(dataUrl.slice(separator + 1), "base64")
}

function rewriteProviderFetch(
  defaultBaseUrl: string,
  configuredBaseUrl: string,
  fetchImpl: typeof fetch,
): typeof fetch {
  const normalizedDefault = defaultBaseUrl.replace(/\/+$/u, "")
  const normalizedConfigured = configuredBaseUrl.replace(/\/+$/u, "")
  return (input, init) => {
    const originalUrl =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.toString()
          : input
    const rewrittenUrl = originalUrl.startsWith(normalizedDefault)
      ? `${normalizedConfigured}${originalUrl.slice(normalizedDefault.length)}`
      : originalUrl
    if (input instanceof Request) {
      return fetchImpl(new Request(rewrittenUrl, input), init)
    }
    return fetchImpl(rewrittenUrl, init)
  }
}

function resolveAssemblyAiModel(model: string) {
  switch (model) {
    case "universal-2":
    case "universal-3-pro":
    case "universal-3-5-pro":
    case "slam-1":
    case "best":
      return model
    default:
      throw new VoiceTranscriptionProviderError("upstream")
  }
}

function resolveElevenLabsModel(model: string) {
  switch (model) {
    case "scribe_v1":
    case "scribe_v1_experimental":
    case "scribe_v2":
      return model
    default:
      throw new VoiceTranscriptionProviderError("upstream")
  }
}

function resolveRevAiModel(model: string) {
  switch (model) {
    case "machine":
    case "low_cost":
    case "fusion":
      return model
    default:
      throw new VoiceTranscriptionProviderError("upstream")
  }
}
