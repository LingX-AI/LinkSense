import { describe, expect, it, vi } from "vitest"

import { createEmbeddingProfileHash } from "../src/modules/knowledge-processing/embedding.js"
import { LiveKnowledgeModelClientResolver } from "../src/modules/knowledge-processing/knowledge-model-runtime.js"
import type {
  KnowledgeModelSettingsReader,
  ResolvedKnowledgeModelRuntime,
} from "../src/modules/system/knowledge-model-settings.js"

describe("embedding compatibility profile", () => {
  it("changes only with the embedding model identifier or vector dimensions", () => {
    const current = createEmbeddingProfileHash("embedding-v1", 1_024)

    expect(createEmbeddingProfileHash(" embedding-v1 ", 1_024)).toBe(current)
    expect(createEmbeddingProfileHash("embedding-v2", 1_024)).not.toBe(current)
    expect(createEmbeddingProfileHash("embedding-v1", 768)).not.toBe(current)
  })
})

describe("LiveKnowledgeModelClientResolver", () => {
  it("reuses clients for the same revision and hot-loads a new revision", async () => {
    let runtime = knowledgeModelRuntime(1, "embedding-v1")
    const settings: KnowledgeModelSettingsReader = {
      resolveRuntime: vi.fn(async () => runtime),
    }
    const resolver = new LiveKnowledgeModelClientResolver(settings)

    const first = await resolver.resolveClients()
    const cached = await resolver.resolveClients()
    expect(cached.embedding).toBe(first.embedding)
    expect(cached.rerank).toBe(first.rerank)

    runtime = knowledgeModelRuntime(2, "embedding-v2")
    const updated = await resolver.resolveClients()
    expect(updated.embedding).not.toBe(first.embedding)
    expect(updated.rerank).not.toBe(first.rerank)
    expect(updated.embedding.profileHash).toBe(
      createEmbeddingProfileHash("embedding-v2", 2)
    )
  })

  it("fails closed when a queued job is pinned to an older embedding profile", async () => {
    const settings: KnowledgeModelSettingsReader = {
      resolveRuntime: vi.fn(async () =>
        knowledgeModelRuntime(2, "embedding-v2")
      ),
    }
    const resolver = new LiveKnowledgeModelClientResolver(settings)

    await expect(
      resolver.resolveEmbedding(createEmbeddingProfileHash("embedding-v1", 2))
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_EMBEDDING_CONFIGURATION_CHANGED",
    })
  })

  it("keeps retrieval available without a rerank client when Rank is disabled", async () => {
    const runtime = knowledgeModelRuntime(1, "embedding-v1")
    runtime.rerank = null
    const resolver = new LiveKnowledgeModelClientResolver({
      resolveRuntime: vi.fn(async () => runtime),
    })

    await expect(resolver.resolveClients()).resolves.toMatchObject({
      rerank: null,
    })
  })
})

function knowledgeModelRuntime(
  revision: number,
  embeddingModel: string
): ResolvedKnowledgeModelRuntime {
  return {
    revision,
    embedding: {
      baseUrl: "https://embedding.example.test",
      apiKey: "embedding-secret",
      model: embeddingModel,
      dimensions: 2,
      maximumInputTokens: 8_192,
      profileHash: createEmbeddingProfileHash(embeddingModel, 2),
      pricing: zeroPricing(),
    },
    rerank: {
      baseUrl: "https://rerank.example.test/v1",
      apiKey: "rerank-secret",
      model: "rerank-v1",
      maximumInputTokens: 8_192,
      timeoutMs: 60_000,
      pricing: zeroPricing(),
    },
  }
}

function zeroPricing() {
  return {
    input_price_per_million: "0",
    cached_input_price_per_million: "0",
    output_price_per_million: "0",
  }
}
