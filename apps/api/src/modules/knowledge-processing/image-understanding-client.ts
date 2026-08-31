import {
  imageUnderstandingDescriptionSchema,
  type ImageUnderstandingDescription,
} from "@linksense/shared"
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai"
import sharp from "sharp"
import { ZodError } from "zod"

import type {
  ImageUnderstandingConfigurationProbe,
  ResolvedImageUnderstandingRuntime,
} from "../system/image-understanding-settings.js"
import { createProviderLanguageModel } from "../../adapters/provider-language-model.js"
import { KnowledgeProcessingError } from "./errors.js"
import { hasReasoningEvidence } from "./image-thinking-policy.js"

export type ImageUnderstandingInput = {
  image: Buffer
  pageNumber: number | null
  headings: readonly string[]
  captions: readonly string[]
  nearbyText: string
}

export interface ImageUnderstandingClient extends ImageUnderstandingConfigurationProbe {
  describe(
    input: ImageUnderstandingInput,
    runtime: ResolvedImageUnderstandingRuntime,
    signal?: AbortSignal,
  ): Promise<ImageUnderstandingDescription>
}

const PROBE_IMAGE_SIZE = 64
const MAX_OUTPUT_VALIDATION_ATTEMPTS = 3

export class VercelAiImageUnderstandingClient implements ImageUnderstandingClient {
  async probe(runtime: ResolvedImageUnderstandingRuntime): Promise<void> {
    await this.describe(
      {
        image: await createConfigurationProbePng(),
        pageNumber: 1,
        headings: ["Configuration probe"],
        captions: ["A generated two-color test pattern."],
        nearbyText:
          "This is a non-business configuration probe. Do not infer identities.",
      },
      runtime,
    )
  }

  async describe(
    input: ImageUnderstandingInput,
    runtime: ResolvedImageUnderstandingRuntime,
    signal?: AbortSignal,
  ): Promise<ImageUnderstandingDescription> {
    let retryFeedback: string | undefined
    for (
      let attempt = 0;
      attempt < MAX_OUTPUT_VALIDATION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await generateDescription(input, runtime, retryFeedback, signal)
      } catch (error) {
        if (error instanceof KnowledgeProcessingError) throw error
        if (signal?.aborted) {
          throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
        }
        if (isInvalidOutputError(error)) {
          if (attempt < MAX_OUTPUT_VALIDATION_ATTEMPTS - 1) {
            retryFeedback = describeInvalidOutputError(error)
            continue
          }
          throw new KnowledgeProcessingError(
            "KNOWLEDGE_IMAGE_MODEL_OUTPUT_INVALID",
            { cause: error },
          )
        }
        throw new KnowledgeProcessingError("KNOWLEDGE_IMAGE_MODEL_UNAVAILABLE", {
          cause: error,
          retryable: true,
        })
      }
    }
    throw new KnowledgeProcessingError("KNOWLEDGE_IMAGE_MODEL_OUTPUT_INVALID")
  }
}

async function generateDescription(
  input: ImageUnderstandingInput,
  runtime: ResolvedImageUnderstandingRuntime,
  retryFeedback: string | undefined,
  signal?: AbortSignal,
): Promise<ImageUnderstandingDescription> {
  const result = await generateText({
    model: createLanguageModel(runtime),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: createPrompt(input, retryFeedback),
          },
          {
            type: "file",
            data: input.image,
            mediaType: "image/png",
            filename: "linksense-image-understanding.png",
          },
        ],
      },
    ],
    output: Output.json({
      name: "concise_document_image_description",
      description:
        "One concise, factual description used as Markdown image alternative text and retrieval text.",
    }),
    providerOptions: createImageUnderstandingProviderOptions(runtime),
    temperature: 0,
    maxOutputTokens: 300,
    maxRetries: 1,
    timeout: { totalMs: 60_000 },
    ...(signal ? { abortSignal: signal } : {}),
  })
  if (
    (result.warnings?.length ?? 0) > 0 ||
    hasReasoningEvidence({
      reasoning: result.reasoning,
      reasoningText: result.reasoningText,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
    })
  ) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_IMAGE_MODEL_THINKING_NOT_DISABLED",
    )
  }
  return imageUnderstandingDescriptionSchema.parse(result.output)
}

function isInvalidOutputError(error: unknown): boolean {
  return (
    error instanceof ZodError ||
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error)
  )
}

function describeInvalidOutputError(error: unknown): string {
  if (error instanceof ZodError) {
    const issues = error.issues.slice(0, 5).map((issue) => {
      const path = issue.path.length === 0 ? "root" : issue.path.join(".")
      return `${path}: ${issue.message}`
    })
    return `The previous response failed schema validation: ${issues.join("; ")}.`
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    const cause = error.cause instanceof Error ? error.cause.message : null
    return cause
      ? `The previous response was not valid JSON: ${cause.slice(0, 500)}.`
      : "The previous response could not be parsed as one JSON object."
  }
  return "The previous response did not contain a usable JSON value."
}

function createLanguageModel(runtime: ResolvedImageUnderstandingRuntime) {
  const fetch = runtime.baseUrl
    ? createScopedFetch(
        runtime.baseUrl,
        runtime.thinkingStrategy === "vllm_qwen_disabled",
      )
    : undefined
  return createProviderLanguageModel(
    {
      provider: runtime.provider,
      model: runtime.model,
      apiKey: runtime.apiKey,
      baseUrl: runtime.baseUrl,
      project: runtime.project,
      location: runtime.location,
    },
    {
      ...(fetch ? { fetch } : {}),
      openAICompatibleName: "linksense-vllm-qwen",
      supportsStructuredOutputs: false,
    },
  )
}

export function createImageUnderstandingProviderOptions(
  runtime: ResolvedImageUnderstandingRuntime,
) {
  switch (runtime.thinkingStrategy) {
    case "non_reasoning_model":
      return {}
    case "openai_none":
      return {
        [runtime.provider === "azure_openai" ? "azure" : "openai"]: {
          reasoningEffort: "none",
        },
      }
    case "anthropic_disabled":
      return { anthropic: { thinking: { type: "disabled" } } }
    case "google_zero_budget":
      return {
        [runtime.provider === "google_vertex" ? "googleVertex" : "google"]: {
          thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
        },
      }
    case "alibaba_disabled":
      return { alibaba: { enableThinking: false } }
    case "deepseek_disabled":
      return { deepseek: { thinking: { type: "disabled" } } }
    case "openrouter_none":
      return { openrouter: { reasoning: { effort: "none" } } }
    case "vllm_qwen_disabled":
      return {}
  }
}

function createPrompt(
  input: ImageUnderstandingInput,
  retryFeedback: string | undefined,
): string {
  const page = input.pageNumber === null ? "unknown" : String(input.pageNumber)
  const headings = input.headings.join(" > ") || "(none)"
  const captions = input.captions.join(" | ") || "(none)"
  const nearby = input.nearbyText.trim().slice(0, 4_000) || "(none)"
  return [
    "Write one concise, factual, self-contained description of this document image.",
    "The description will be used directly as both Markdown image alternative text and retrieval text.",
    'Return only one JSON object exactly like {"description":"..."}.',
    "Do not return an array, JSON Schema, Markdown, labels, or reasoning.",
    "Use one complete sentence, preferably no more than 240 characters.",
    "Include clearly visible text, controls, states, or relationships only when they help identify the image.",
    "Use the primary language of the nearby document text when it is clear; otherwise use English.",
    "Do not add Markdown, labels, bullets, page numbers, heading metadata, or prefixes such as 'Image description'.",
    "Use the document context only to disambiguate what is visibly present.",
    "Do not expose chain-of-thought or reasoning.",
    "Never infer a person's name, identity, ethnicity, health, beliefs, or other sensitive traits from appearance.",
    "A name may be mentioned only when it is explicitly supplied by the document text below and the image-document relationship is clear.",
    `Page: ${page}`,
    `Heading path: ${headings}`,
    `Caption: ${captions}`,
    `Nearby document text: ${nearby}`,
    ...(retryFeedback
      ? [
          "Correction required:",
          retryFeedback,
          'Generate a completely new response containing exactly one object with only the string field "description".',
        ]
      : []),
  ].join("\n")
}

async function createConfigurationProbePng(): Promise<Buffer> {
  const pixels = Buffer.alloc(PROBE_IMAGE_SIZE * PROBE_IMAGE_SIZE * 3)
  for (let y = 0; y < PROBE_IMAGE_SIZE; y += 1) {
    for (let x = 0; x < PROBE_IMAGE_SIZE; x += 1) {
      const offset = (y * PROBE_IMAGE_SIZE + x) * 3
      const left = x < PROBE_IMAGE_SIZE / 2
      const top = y < PROBE_IMAGE_SIZE / 2
      const primaryBlock = left === top
      pixels[offset] = primaryBlock ? 39 : 235
      pixels[offset + 1] = primaryBlock ? 99 : 124
      pixels[offset + 2] = primaryBlock ? 235 : 39
    }
  }
  return sharp(pixels, {
    raw: {
      width: PROBE_IMAGE_SIZE,
      height: PROBE_IMAGE_SIZE,
      channels: 3,
    },
    failOn: "error",
  })
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      palette: false,
    })
    .toBuffer()
}

function createScopedFetch(
  baseUrl: string,
  forceQwenThinkingDisabled: boolean,
): typeof fetch {
  const allowed = new URL(baseUrl)
  return async (input, init) => {
    const requested = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    )
    if (
      requested.protocol !== allowed.protocol ||
      requested.host !== allowed.host ||
      !requested.pathname.startsWith(normalizedBasePath(allowed.pathname))
    ) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED",
      )
    }
    if (!forceQwenThinkingDisabled || typeof init?.body !== "string") {
      return fetch(input, { ...init, redirect: "error" })
    }
    const body = parseRequestBody(init.body)
    const current = asRecord(body.chat_template_kwargs)
    return fetch(input, {
      ...init,
      redirect: "error",
      body: JSON.stringify({
        ...body,
        enable_thinking: false,
        chat_template_kwargs: {
          ...current,
          enable_thinking: false,
        },
      }),
    })
  }
}

function normalizedBasePath(pathname: string): string {
  return pathname.endsWith("/") ? pathname : `${pathname}/`
}

function parseRequestBody(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return { ...parsed }
    }
  } catch {
    // The stable error intentionally carries no request body.
  }
  throw new KnowledgeProcessingError(
    "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED",
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : {}
}
