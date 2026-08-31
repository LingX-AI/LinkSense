import { createHash } from "node:crypto"

import sharp from "sharp"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createAssetReferenceId } from "../src/modules/knowledge-processing/asset-processor.js"
import {
  buildImageProjection,
  type ImageProjectionAsset,
} from "../src/modules/knowledge-processing/image-projection.js"
import {
  createImageUnderstandingProviderOptions,
  type ImageUnderstandingClient,
  VercelAiImageUnderstandingClient,
} from "../src/modules/knowledge-processing/image-understanding-client.js"
import {
  hasReasoningEvidence,
  resolveImageThinkingStrategy,
} from "../src/modules/knowledge-processing/image-thinking-policy.js"
import { KnowledgeProcessingError } from "../src/modules/knowledge-processing/errors.js"
import type { HybridChunkResult } from "../src/modules/knowledge-processing/docling-hybrid.js"
import {
  createImageUnderstandingSnapshot,
  type ResolvedImageUnderstandingRuntime,
} from "../src/modules/system/image-understanding-settings.js"

const ORIGINAL_SHA256 = "a".repeat(64)
const FIRST_SAFE_SHA256 = "b".repeat(64)
const SECOND_SAFE_SHA256 = "c".repeat(64)
const THIRD_SAFE_SHA256 = "d".repeat(64)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("image-model configuration probe", () => {
  it("sends Alibaba a strictly decodable PNG above the Qwen minimum dimensions", async () => {
    let serializedRequestBody = ""
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        serializedRequestBody = String(init?.body ?? "")
        return new Response(
          JSON.stringify({
            id: "probe-response",
            created: 1,
            model: "qwen3.7-flash",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    description:
                      "A deterministic configuration image with contrasting color blocks.",
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 30,
              total_tokens: 50,
              completion_tokens_details: { reasoning_tokens: 0 },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }),
    )

    await new VercelAiImageUnderstandingClient().probe({
      ...runtime("alibaba", "qwen3.7-flash", "alibaba_disabled"),
      baseUrl: "https://models.example.test/v1",
    })

    expect(JSON.parse(serializedRequestBody)).toMatchObject({
      enable_thinking: false,
      response_format: { type: "json_object" },
    })
    expect(JSON.parse(serializedRequestBody)).not.toHaveProperty(
      "response_format.json_schema",
    )
    expect(serializedRequestBody).toContain(
      "used directly as both Markdown image alternative text and retrieval text",
    )
    expect(serializedRequestBody).toContain('\\"description\\"')
    expect(serializedRequestBody).not.toContain('"searchable_text"')
    expect(serializedRequestBody).not.toContain('"context_relation"')
    expect(serializedRequestBody).not.toContain('"decorative"')
    const imageMatch = /data:image\/png;base64,([A-Za-z0-9+/=]+)/u.exec(
      serializedRequestBody,
    )
    if (!imageMatch?.[1]) throw new Error("probe PNG data URL was not sent")
    const image = Buffer.from(imageMatch[1], "base64")
    const metadata = await sharp(image, { failOn: "error" }).metadata()
    await expect(
      sharp(image, { failOn: "error" }).raw().toBuffer(),
    ).resolves.not.toHaveLength(0)
    expect(metadata).toMatchObject({ format: "png" })
    expect(metadata.width).toBeGreaterThan(10)
    expect(metadata.height).toBeGreaterThan(10)
  })

  it("retries invalid output twice, includes validation feedback, and accepts the third response", async () => {
    const requestBodies: string[] = []
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_input, init) => {
        requestBodies.push(String(init?.body ?? ""))
        return imageModelResponse(
          JSON.stringify([{ description: "Unexpected array wrapper." }]),
        )
      })
      .mockImplementationOnce(async (_input, init) => {
        requestBodies.push(String(init?.body ?? ""))
        return imageModelResponse(JSON.stringify({ wrong_field: "Missing." }))
      })
      .mockImplementationOnce(async (_input, init) => {
        requestBodies.push(String(init?.body ?? ""))
        return imageModelResponse(
          JSON.stringify({ description: "A valid document image." }),
        )
      })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      new VercelAiImageUnderstandingClient().describe(
        imageUnderstandingInput(),
        runtime("openai_compatible", "qwen3.8-flash", "vllm_qwen_disabled"),
      ),
    ).resolves.toEqual({ description: "A valid document image." })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(requestBodies[0]).not.toContain("Correction required:")
    expect(requestBodies[1]).toContain("Correction required:")
    expect(requestBodies[1]).toContain(
      "previous response failed schema validation",
    )
    expect(requestBodies[1]).toContain("expected object, received array")
    expect(requestBodies[2]).toContain("Correction required:")
    expect(requestBodies[2]).toContain("description")
  })

  it("fails after retrying invalid JSON output exactly twice", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        imageModelResponse(
          JSON.stringify([
            {
              type: "object",
              properties: { description: { type: "string" } },
            },
          ]),
        ),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      new VercelAiImageUnderstandingClient().describe(
        imageUnderstandingInput(),
        runtime("openai_compatible", "qwen3.8-flash", "vllm_qwen_disabled"),
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_IMAGE_MODEL_OUTPUT_INVALID" })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe("knowledge image projection", () => {
  it("places multiple assets in the exact Hybrid docItems order without changing the display source", async () => {
    const input = projectionFixture()
    const client = disabledClient()

    const projection = await buildImageProjection({
      ...input,
      snapshot: createImageUnderstandingSnapshot(null),
      runtime: null,
      client,
      concurrency: 2,
      projectionMaximumTokens: 3_000,
    })

    expect(client.describe).not.toHaveBeenCalled()
    expect(projection.images).toHaveLength(2)
    expect(projection.chunks[0]?.text).toContain("Before")
    const secondImagePosition =
      projection.chunks[0]?.text.indexOf(input.assets[1]!.assetReferenceId) ??
      -1
    const firstImagePosition =
      projection.chunks[0]?.text.indexOf(input.assets[0]!.assetReferenceId) ??
      -1
    expect(secondImagePosition).toBeGreaterThan(-1)
    expect(firstImagePosition).toBeGreaterThan(secondImagePosition)
    expect(
      projection.chunks[0]?.text.match(/!\[Employee photographs\]\(kb-asset:\/\//gu),
    ).toHaveLength(2)
    expect(projection.chunks[0]?.text).not.toContain("> 图片描述：")
    expect(projection.chunks[0]?.text).not.toContain("> 可检索信息：")
    expect(projection.chunks[0]?.text).not.toContain("> 与正文关系：")
    expect(projection.chunks[0]?.text).not.toContain("> 文档上下文：")
    expect(input.hybrid.chunks[0]?.text).toBe(
      "# People\n\nBefore ![IMAGE] middle ![IMAGE] after",
    )
  })

  it("adds one objective multimodal description per image at that image's exact position", async () => {
    const input = projectionFixture()
    const client: ImageUnderstandingClient = {
      probe: vi.fn(async () => undefined),
      describe: vi.fn(async ({ image }) => {
        const marker = image.equals(Buffer.from("first")) ? "first" : "second"
        return {
          description: `${marker} factual description`,
        }
      }),
    }
    const snapshot = {
      ...createImageUnderstandingSnapshot(null),
      enabled: true,
      revision: 1,
      provider: "openai" as const,
      model: "gpt-4o",
      endpoint_identifier: "provider-default:openai",
      thinking_strategy: "non_reasoning_model" as const,
    }

    const projection = await buildImageProjection({
      ...input,
      snapshot,
      runtime: runtime("openai", "gpt-4o", "non_reasoning_model"),
      client,
      concurrency: 2,
      projectionMaximumTokens: 3_000,
    })

    expect(client.describe).toHaveBeenCalledTimes(2)
    expect(projection.chunks[0]?.text).toContain("second factual description")
    expect(projection.chunks[0]?.text).toContain("first factual description")
    expect(projection.chunks[0]?.text).not.toContain("> 图片描述：")
    expect(projection.chunks[0]?.text).not.toContain("> 可检索信息：")
    expect(projection.chunks[0]?.text).not.toContain("> 与正文关系：")
    expect(projection.chunks[0]?.text).not.toContain("> 文档上下文：")
    expect(
      projection.images.map((image) => image.description?.description),
    ).toEqual(["first factual description", "second factual description"])
  })

  it("fails closed instead of guessing when placeholder coverage is ambiguous", async () => {
    const input = projectionFixture()
    input.hybrid.chunks[0] = {
      ...input.hybrid.chunks[0]!,
      text: "Only one [IMAGE]",
      rawText: "Only one [IMAGE]",
    }

    await expect(
      buildImageProjection({
        ...input,
        snapshot: createImageUnderstandingSnapshot(null),
        runtime: null,
        client: disabledClient(),
        concurrency: 1,
        projectionMaximumTokens: 3_000,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_IMAGE_POSITION_INVALID" })
  })

  it("allows an unchunked non-body image while retaining exact asset reconciliation", async () => {
    const input = projectionFixture()
    const furnitureUri = "artifacts/header-logo.png"
    const pictures = Reflect.get(input.doclingJson, "pictures")
    if (!Array.isArray(pictures)) throw new Error("Missing fixture pictures")
    pictures.push({
      ...picture(2, furnitureUri, 1),
      content_layer: "furniture",
    })
    input.assets.push({
      assetReferenceId: createAssetReferenceId({
        originalSha256: ORIGINAL_SHA256,
        sourceUri: furnitureUri,
        safeSha256: THIRD_SAFE_SHA256,
      }),
      safeSha256: THIRD_SAFE_SHA256,
      bytes: Buffer.from("header-logo"),
    })
    const client = disabledClient()

    const projection = await buildImageProjection({
      ...input,
      snapshot: createImageUnderstandingSnapshot(null),
      runtime: null,
      client,
      concurrency: 2,
      projectionMaximumTokens: 3_000,
    })

    expect(client.describe).not.toHaveBeenCalled()
    expect(projection.images.map((image) => image.selfRef)).toEqual([
      "#/pictures/0",
      "#/pictures/1",
    ])
    expect(projection.chunks[0]?.text).not.toContain("![IMAGE]")
  })

  it("still rejects an unchunked body image", async () => {
    const input = projectionFixture()
    const bodyUri = "artifacts/unpositioned-body.png"
    const pictures = Reflect.get(input.doclingJson, "pictures")
    if (!Array.isArray(pictures)) throw new Error("Missing fixture pictures")
    pictures.push(picture(2, bodyUri, 1))
    input.assets.push({
      assetReferenceId: createAssetReferenceId({
        originalSha256: ORIGINAL_SHA256,
        sourceUri: bodyUri,
        safeSha256: THIRD_SAFE_SHA256,
      }),
      safeSha256: THIRD_SAFE_SHA256,
      bytes: Buffer.from("body-image"),
    })

    await expect(
      buildImageProjection({
        ...input,
        snapshot: createImageUnderstandingSnapshot(null),
        runtime: null,
        client: disabledClient(),
        concurrency: 2,
        projectionMaximumTokens: 3_000,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_IMAGE_POSITION_INVALID" })
  })

  it("still rejects an asset that has no Docling image candidate", async () => {
    const input = projectionFixture()
    input.assets.push({
      assetReferenceId: createAssetReferenceId({
        originalSha256: ORIGINAL_SHA256,
        sourceUri: "artifacts/orphan.png",
        safeSha256: THIRD_SAFE_SHA256,
      }),
      safeSha256: THIRD_SAFE_SHA256,
      bytes: Buffer.from("orphan"),
    })

    await expect(
      buildImageProjection({
        ...input,
        snapshot: createImageUnderstandingSnapshot(null),
        runtime: null,
        client: disabledClient(),
        concurrency: 2,
        projectionMaximumTokens: 3_000,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_IMAGE_POSITION_INVALID" })
  })

  it("honors cancellation before starting image-model calls", async () => {
    const input = projectionFixture()
    const controller = new AbortController()
    controller.abort()
    const client = disabledClient()
    const snapshot = {
      ...createImageUnderstandingSnapshot(null),
      enabled: true,
      revision: 1,
      provider: "openai" as const,
      model: "gpt-4o",
      endpoint_identifier: "provider-default:openai",
      thinking_strategy: "non_reasoning_model" as const,
    }

    await expect(
      buildImageProjection({
        ...input,
        snapshot,
        runtime: runtime("openai", "gpt-4o", "non_reasoning_model"),
        client,
        concurrency: 1,
        projectionMaximumTokens: 3_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_PROCESSING_CANCELLED" })
    expect(client.describe).not.toHaveBeenCalled()
  })

  it("cancels the remaining image calls after the first image fails", async () => {
    const input = projectionFixture()
    const client: ImageUnderstandingClient = {
      probe: vi.fn(async () => undefined),
      describe: vi.fn(async ({ image }, _runtime, signal) => {
        if (image.equals(Buffer.from("first"))) {
          throw new KnowledgeProcessingError(
            "KNOWLEDGE_IMAGE_MODEL_OUTPUT_INVALID",
          )
        }
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(
              new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED"),
            )
            return
          }
          signal?.addEventListener(
            "abort",
            () =>
              reject(
                new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED"),
              ),
            { once: true },
          )
          setTimeout(resolve, 1_000)
        })
        throw new Error("unexpected completed image call")
      }),
    }
    const snapshot = {
      ...createImageUnderstandingSnapshot(null),
      enabled: true,
      revision: 1,
      provider: "openai" as const,
      model: "gpt-4o",
      endpoint_identifier: "provider-default:openai",
      thinking_strategy: "non_reasoning_model" as const,
    }

    await expect(
      buildImageProjection({
        ...input,
        snapshot,
        runtime: runtime("openai", "gpt-4o", "non_reasoning_model"),
        client,
        concurrency: 2,
        projectionMaximumTokens: 3_000,
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_IMAGE_MODEL_OUTPUT_INVALID",
    })
    expect(client.describe).toHaveBeenCalledTimes(2)
  })
})

describe("image-model no-thinking policies", () => {
  it.each([
    ["openai", "gpt-4o", "non_reasoning_model"],
    ["azure_openai", "gpt-5.1", "openai_none"],
    ["anthropic", "claude-sonnet-4", "anthropic_disabled"],
    ["google", "gemini-2.5-flash", "google_zero_budget"],
    ["google_vertex", "gemini-2.5-flash-lite", "google_zero_budget"],
    ["alibaba", "qwen-vl-max", "alibaba_disabled"],
    ["deepseek", "deepseek-vl2", "deepseek_disabled"],
    ["openrouter", "google/gemini-2.5-flash", "openrouter_none"],
    ["openai_compatible", "qwen2.5-vl", "vllm_qwen_disabled"],
  ] as const)(
    "selects a verified adapter for %s/%s",
    (provider, model, expected) => {
      expect(resolveImageThinkingStrategy({ provider, model })).toBe(expected)
    },
  )

  it.each([
    ["openai", "o3"],
    ["alibaba", "qwq-32b"],
    ["deepseek", "deepseek-reasoner"],
    ["google", "gemini-2.5-pro"],
    ["google_vertex", "gemini-3.1-pro-preview"],
    ["openai_compatible", "unknown-vl"],
    ["openrouter", "google/gemini-2.5-pro"],
    ["openrouter", "unknown/vendor-model"],
  ] as const)(
    "rejects forced or unknown reasoning models for %s/%s",
    (provider, model) => {
      expect(resolveImageThinkingStrategy({ provider, model })).toBeNull()
    },
  )

  it("emits the provider-specific disable parameters", () => {
    expect(
      createImageUnderstandingProviderOptions(
        runtime("google", "gemini-2.5-flash", "google_zero_budget"),
      ),
    ).toEqual({
      google: {
        thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
      },
    })
    expect(
      createImageUnderstandingProviderOptions(
        runtime("google_vertex", "gemini-2.5-flash-lite", "google_zero_budget"),
      ),
    ).toEqual({
      googleVertex: {
        thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
      },
    })
    expect(
      createImageUnderstandingProviderOptions(
        runtime("alibaba", "qwen-vl-max", "alibaba_disabled"),
      ),
    ).toEqual({ alibaba: { enableThinking: false } })
    expect(
      createImageUnderstandingProviderOptions(
        runtime("openrouter", "qwen/qwen-vl", "openrouter_none"),
      ),
    ).toEqual({ openrouter: { reasoning: { effort: "none" } } })
  })

  it("accepts zero reasoning usage but detects any returned thought evidence", () => {
    expect(
      hasReasoningEvidence({
        usage: { outputTokenDetails: { reasoningTokens: 0 } },
      }),
    ).toBe(false)
    expect(
      hasReasoningEvidence({
        usage: { outputTokenDetails: { reasoningTokens: 1 } },
      }),
    ).toBe(true)
    expect(hasReasoningEvidence({ reasoningText: "hidden thought" })).toBe(true)
    expect(
      hasReasoningEvidence({
        reasoning: [{ type: "reasoning", text: "hidden thought" }],
      }),
    ).toBe(true)
  })
})

function projectionFixture(): {
  filename: string
  doclingJson: Record<string, unknown>
  originalSha256: string
  hybrid: HybridChunkResult
  assets: ImageProjectionAsset[]
} {
  const firstUri = "artifacts/first.png"
  const secondUri = "artifacts/second.png"
  return {
    filename: "resume.json",
    doclingJson: doclingDocument([
      picture(0, firstUri, 1),
      picture(1, secondUri, 2),
    ]),
    originalSha256: ORIGINAL_SHA256,
    hybrid: {
      filename: "resume.json",
      chunks: [
        {
          chunkIndex: 0,
          text: "# People\n\nBefore ![IMAGE] middle ![IMAGE] after",
          rawText: "Before ![IMAGE] middle ![IMAGE] after",
          numTokens: 12,
          headings: ["People"],
          captions: ["Employee photographs"],
          docItems: ["#/pictures/1", "#/pictures/0"],
          pageNumbers: [1, 2],
          metadata: {},
        },
      ],
    },
    assets: [
      {
        assetReferenceId: createAssetReferenceId({
          originalSha256: ORIGINAL_SHA256,
          sourceUri: firstUri,
          safeSha256: FIRST_SAFE_SHA256,
        }),
        safeSha256: FIRST_SAFE_SHA256,
        bytes: Buffer.from("first"),
      },
      {
        assetReferenceId: createAssetReferenceId({
          originalSha256: ORIGINAL_SHA256,
          sourceUri: secondUri,
          safeSha256: SECOND_SAFE_SHA256,
        }),
        safeSha256: SECOND_SAFE_SHA256,
        bytes: Buffer.from("second"),
      },
    ],
  }
}

function doclingDocument(pictures: Record<string, unknown>[]) {
  return {
    schema_name: "DoclingDocument",
    version: "1.10.0",
    name: "resume",
    origin: null,
    body: root("body"),
    furniture: root("furniture"),
    groups: [],
    texts: [],
    pictures,
    tables: [],
    key_value_items: [],
    form_items: [],
    field_regions: [],
    field_items: [],
    pages: {},
  }
}

function picture(index: number, uri: string, pageNumber: number) {
  return {
    self_ref: `#/pictures/${index}`,
    parent: null,
    children: [],
    content_layer: "body",
    label: "picture",
    prov: [
      {
        page_no: pageNumber,
        charspan: [0, 0],
        bbox: {
          l: 0,
          t: 0,
          r: 10,
          b: 10,
          coord_origin: "TOPLEFT",
        },
      },
    ],
    captions: [],
    references: [],
    footnotes: [],
    image: {
      mimetype: "image/png",
      dpi: 72,
      size: { width: 10, height: 10 },
      uri,
    },
    annotations: [],
  }
}

function root(layer: "body" | "furniture") {
  return {
    self_ref: `#/${layer}`,
    parent: null,
    children: [],
    content_layer: layer,
    name: "_root_",
    label: "unspecified",
  }
}

function disabledClient(): ImageUnderstandingClient {
  return {
    probe: vi.fn(async () => undefined),
    describe: vi.fn(async () => {
      throw new Error("disabled image understanding must not be called")
    }),
  }
}

function imageUnderstandingInput() {
  return {
    image: Buffer.from("image"),
    pageNumber: 1,
    headings: ["Printing"],
    captions: ["Application screenshot"],
    nearbyText: "Configure the printer before printing.",
  }
}

function imageModelResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: "image-response",
      created: 1,
      model: "qwen3.8-flash",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content },
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 30,
        total_tokens: 50,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  )
}

function runtime(
  provider: ResolvedImageUnderstandingRuntime["provider"],
  model: string,
  thinkingStrategy: ResolvedImageUnderstandingRuntime["thinkingStrategy"],
): ResolvedImageUnderstandingRuntime {
  return {
    revision: 1,
    provider,
    baseUrl:
      provider === "azure_openai" || provider === "openai_compatible"
        ? "https://models.example.test/v1"
        : null,
    apiKey: "secret",
    model,
    project: provider === "google_vertex" ? "project" : null,
    location: provider === "google_vertex" ? "us-central1" : null,
    thinkingStrategy,
    promptVersion: "image-alt-description-3",
    outputSchemaVersion: "image-understanding-output-2",
    configDigest: createHash("sha256").update("runtime").digest("hex"),
  }
}
