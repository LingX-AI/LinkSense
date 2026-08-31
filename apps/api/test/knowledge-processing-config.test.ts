import { describe, expect, it } from "vitest"

import {
  createChunkingConfigDigest,
  hashCanonical,
  type ChunkingConfigSnapshot,
} from "../src/modules/knowledge-processing/config.js"

describe("knowledge processing configuration digests", () => {
  it("keeps parser and office-conversion contracts out of chunking provenance", () => {
    const chunking: ChunkingConfigSnapshot = {
      tokenizer: "/models/tokenizers/embedding",
      childMaxTokens: 768,
      parentMaxTokens: 3_000,
      embeddingMaxInputTokens: 8_192,
    }

    expect(createChunkingConfigDigest(chunking)).toBe(
      hashCanonical({
        ...chunking,
        chunker: "docling-hybrid",
        chunkSerializer: "triplet-table",
        includeRawText: true,
        mergePeers: false,
        useMarkdownImages: false,
        useMarkdownTables: false,
        parentBuilder: "continuous-heading-page-budget",
      })
    )
  })

  it("continues to track settings that directly change chunking artifacts", () => {
    const chunking: ChunkingConfigSnapshot = {
      tokenizer: "/models/tokenizers/embedding",
      childMaxTokens: 768,
      parentMaxTokens: 3_000,
      embeddingMaxInputTokens: 8_192,
    }

    expect(
      createChunkingConfigDigest({ ...chunking, childMaxTokens: 512 })
    ).not.toBe(createChunkingConfigDigest(chunking))
  })
})
