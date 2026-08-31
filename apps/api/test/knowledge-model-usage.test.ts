import { describe, expect, it, vi } from "vitest"

import { EmbeddingClient } from "../src/modules/knowledge-processing/embedding.js"
import {
  KnowledgeRetrievalOrchestrator,
  RerankClient,
  type FusedParentCandidate,
} from "../src/modules/knowledge-processing/retrieval.js"
import type { TokenEstimator } from "../src/modules/knowledge-processing/token-estimator.js"
import {
  modelUsageCaptureSchema,
  type ModelUsageCapture,
} from "../src/modules/usage/model-usage.js"

const OWNER_ID = "10000000-0000-4000-8000-000000000001"
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const TURN_ID = "30000000-0000-4000-8000-000000000001"
const EMBEDDING_REQUEST_ID = "40000000-0000-4000-8000-000000000001"
const RERANK_REQUEST_ID = "50000000-0000-4000-8000-000000000001"
const pricing = {
  input_price_per_million: "5",
  cached_input_price_per_million: "1",
  output_price_per_million: "8",
}

describe("knowledge model usage normalization", () => {
  it("does not duplicate the v1 segment in an embedding endpoint", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://embedding.example.test/v1/embeddings")
      return jsonResponse({
        data: [{ index: 0, embedding: [0.6, 0.8] }],
      })
    })
    const client = new EmbeddingClient(
      {
        baseUrl: "https://embedding.example.test/v1",
        model: "embedding-v1",
        dimensions: 2,
        maximumInputTokens: 100,
      },
      fetcher as never,
      wordEstimator
    )

    await expect(client.embedQuery("one two three")).resolves.toMatchObject({
      vector: [0.6, 0.8],
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it("accepts OpenAI-compatible embedding response metadata", async () => {
    const client = new EmbeddingClient(
      {
        baseUrl: "https://embedding.example.test/v1",
        model: "embedding-v1",
        dimensions: 2,
        maximumInputTokens: 100,
      },
      vi.fn(async () =>
        jsonResponse({
          id: "embd-compatible-response",
          object: "list",
          model: "embedding-v1",
          data: [
            {
              object: "embedding",
              index: 0,
              embedding: [0.6, 0.8],
            },
          ],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        })
      ) as never,
      wordEstimator
    )

    await expect(client.embedQuery("health")).resolves.toMatchObject({
      vector: [0.6, 0.8],
      usage: {
        totalTokens: 1,
        inputTokens: 1,
        measurementMethod: "provider",
      },
    })
  })

  it("uses provider-returned embedding usage and keeps the active price snapshot", async () => {
    const client = embeddingClient({
      usage: {
        input_tokens: 3,
        total_tokens: 4,
        input_tokens_details: { cached_tokens: 1 },
      },
    })

    await expect(client.embedQuery("one two three")).resolves.toMatchObject({
      model: "embedding-v1",
      pricing,
      usage: {
        totalTokens: 4,
        inputTokens: 3,
        cachedInputTokens: 1,
        outputTokens: 1,
        reasoningOutputTokens: 0,
        measurementMethod: "provider",
      },
    })
  })

  it("estimates embedding tokens locally when the provider omits usage", async () => {
    const client = embeddingClient({})

    await expect(client.embedQuery("one two three")).resolves.toMatchObject({
      usage: {
        totalTokens: 3,
        inputTokens: 3,
        outputTokens: 0,
        measurementMethod: "estimated",
      },
    })
  })

  it("rejects provider cache usage that is not an input-token subset", async () => {
    const client = embeddingClient({
      usage: {
        input_tokens: 3,
        total_tokens: 4,
        input_tokens_details: { cached_tokens: 4 },
      },
    })

    await expect(client.embedQuery("one two three")).rejects.toMatchObject({
      code: "KNOWLEDGE_EMBEDDING_RESPONSE_INVALID",
    })
  })

  it("normalizes provider and estimated rerank usage", async () => {
    const providerClient = rerankClient({
      usage: {
        prompt_tokens: 9,
        total_tokens: 10,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    })
    await expect(
      providerClient.rerank("query text", [candidate()])
    ).resolves.toMatchObject({
      model: "rerank-v1",
      pricing,
      usage: {
        totalTokens: 10,
        inputTokens: 9,
        cachedInputTokens: 2,
        outputTokens: 1,
        measurementMethod: "provider",
      },
    })

    const estimatedClient = rerankClient({})
    const estimated = await estimatedClient.rerank("query text", [candidate()])
    expect(estimated.usage).toMatchObject({
      totalTokens: expect.any(Number),
      inputTokens: expect.any(Number),
      outputTokens: 0,
      measurementMethod: "estimated",
    })
    expect(estimated.usage.totalTokens).toBeGreaterThan(0)
  })

  it("accepts null optional token details from compatible rerank providers", async () => {
    const client = rerankClient({
      usage: {
        prompt_tokens: 18,
        input_tokens: 0,
        total_tokens: 18,
        input_tokens_details: null,
      },
    })

    await expect(
      client.rerank("query text", [candidate()])
    ).resolves.toMatchObject({
      usage: {
        totalTokens: 18,
        inputTokens: 18,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        measurementMethod: "provider",
      },
    })
  })
})

describe("knowledge retrieval usage attribution", () => {
  it("records query embedding and rerank calls for the requesting user and turn", async () => {
    const parent = candidate()
    const embedding = {
      profileHash: "a".repeat(64),
      embedQuery: vi.fn(async () => ({
        requestId: EMBEDDING_REQUEST_ID,
        model: "embedding-v1",
        pricing,
        usage: {
          totalTokens: 3,
          inputTokens: 3,
          cachedInputTokens: 0 as const,
          outputTokens: 0,
          reasoningOutputTokens: 0 as const,
          measurementMethod: "provider" as const,
        },
        vector: [0.6, 0.8],
      })),
    }
    const rerank = {
      rerank: vi.fn(async () => ({
        requestId: RERANK_REQUEST_ID,
        model: "rerank-v1",
        pricing,
        usage: {
          totalTokens: 8,
          inputTokens: 8,
          cachedInputTokens: 0 as const,
          outputTokens: 0,
          reasoningOutputTokens: 0 as const,
          measurementMethod: "estimated" as const,
        },
        items: [{ candidate: parent, score: 0.9 }],
      })),
    }
    const elasticsearch = {
      vectorSearch: vi.fn(async () => [parent]),
      bm25Search: vi.fn(async () => []),
    }
    const recorder = {
      recordModelUsage: vi.fn(async (capture: ModelUsageCapture) => {
        modelUsageCaptureSchema.parse(capture)
        return { recorded: true }
      }),
    }
    const orchestrator = new KnowledgeRetrievalOrchestrator(
      { resolveClients: vi.fn(async () => ({ embedding, rerank })) } as never,
      elasticsearch as never,
      null,
      recorder
    )

    await expect(
      orchestrator.search({
        query: "query text",
        authorizedKnowledgeBaseIds: [parent.knowledgeBaseId],
        parameters: { minScore: 0 },
        filterCandidates: async (candidates) => [...candidates],
        usageContext: {
          ownerId: OWNER_ID,
          conversationId: CONVERSATION_ID,
          turnId: TURN_ID,
        },
      })
    ).resolves.toMatchObject({ ranking: "rerank" })

    expect(recorder.recordModelUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        requestId: EMBEDDING_REQUEST_ID,
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        workload: "query_embedding",
        modelKind: "embedding",
      })
    )
    expect(recorder.recordModelUsage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        requestId: RERANK_REQUEST_ID,
        workload: "rerank",
        modelKind: "rerank",
        measurementMethod: "estimated",
      })
    )
    const [embeddingCapture, rerankCapture] =
      recorder.recordModelUsage.mock.calls.map(([capture]) => capture)
    expect(modelUsageCaptureSchema.safeParse(embeddingCapture).success).toBe(
      true
    )
    expect(modelUsageCaptureSchema.safeParse(rerankCapture).success).toBe(true)
    expect(embeddingCapture?.tokenUsage).toEqual({
      totalTokens: 3,
      inputTokens: 3,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    })
    expect(rerankCapture?.tokenUsage).toEqual({
      totalTokens: 8,
      inputTokens: 8,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    })
    expect(embeddingCapture?.tokenUsage).not.toHaveProperty("measurementMethod")
    expect(rerankCapture?.tokenUsage).not.toHaveProperty("measurementMethod")
  })
})

function embeddingClient(response: {
  usage?: {
    prompt_tokens?: number
    input_tokens?: number
    total_tokens: number
    prompt_tokens_details?: { cached_tokens?: number } | null
    input_tokens_details?: { cached_tokens?: number } | null
  }
}) {
  return new EmbeddingClient(
    {
      baseUrl: "https://embedding.example.test",
      model: "embedding-v1",
      dimensions: 2,
      maximumInputTokens: 100,
      pricing,
    },
    vi.fn(async () =>
      jsonResponse({
        data: [{ index: 0, embedding: [0.6, 0.8] }],
        ...(response.usage ? { usage: response.usage } : {}),
      })
    ) as never,
    wordEstimator
  )
}

function rerankClient(response: {
  usage?: {
    prompt_tokens?: number
    input_tokens?: number
    total_tokens: number
    prompt_tokens_details?: { cached_tokens?: number } | null
    input_tokens_details?: { cached_tokens?: number } | null
  }
}) {
  return new RerankClient(
    {
      baseUrl: "https://rerank.example.test/v1",
      model: "rerank-v1",
      timeoutMs: 1_000,
      maximumInputTokens: 100,
      pricing,
    },
    vi.fn(async () =>
      jsonResponse({
        results: [{ index: 0, relevance_score: 0.9 }],
        ...(response.usage ? { usage: response.usage } : {}),
      })
    ) as never,
    wordEstimator
  )
}

const wordEstimator: TokenEstimator = {
  count: (text) => words(text).length,
  truncateHead: (text, maximumTokens) =>
    words(text).slice(0, maximumTokens).join(" "),
  truncateTail: (text, maximumTokens) =>
    words(text).slice(-maximumTokens).join(" "),
}

function words(text: string): string[] {
  return text.trim() === "" ? [] : text.trim().split(/\s+/u)
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function candidate(): FusedParentCandidate {
  return {
    parentId: "60000000-0000-4000-8000-000000000001",
    parentOrder: 0,
    knowledgeBaseId: "70000000-0000-4000-8000-000000000001",
    documentId: "80000000-0000-4000-8000-000000000001",
    documentVersionId: "90000000-0000-4000-8000-000000000001",
    titlePath: ["Policy"],
    parentText: "retrieval evidence",
    pageNumbers: [1],
    childIds: ["child-1"],
    childCount: 1,
    matchedChildren: [
      {
        childId: "child-1",
        order: 0,
        rawText: "retrieval evidence",
        titlePath: ["Policy"],
        pageNumbers: [1],
        score: 1,
        matchKinds: ["dense"],
      },
    ],
    score: 1,
    rrfScore: 1,
  }
}
