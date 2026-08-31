import { describe, expect, it, vi } from "vitest"

import { AppError } from "../src/lib/errors.js"
import { KnowledgeProcessingError } from "../src/modules/knowledge-processing/errors.js"
import {
  KnowledgeProcessingHealthProbe,
  type KnowledgeHealthDependency,
} from "../src/modules/knowledge-processing/health.js"

describe("KnowledgeProcessingHealthProbe", () => {
  it("preserves a failed Hybrid runtime probe for deployment diagnostics", async () => {
    const probe = new KnowledgeProcessingHealthProbe({
      minio: availableDependency(),
      docling: failingDependency(
        new KnowledgeProcessingError(
          "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE",
        ),
      ),
      embedding: availableDependency(),
      elasticsearch: availableDependency(),
      rerank: null,
    })

    await expect(probe.check()).resolves.toMatchObject({
      document_parsing: {
        status: "unavailable",
        reason_code: "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE",
      },
    })
  })

  it("preserves the stable Elasticsearch contract error for diagnostics", async () => {
    const probe = new KnowledgeProcessingHealthProbe({
      minio: availableDependency(),
      docling: availableDependency(),
      embedding: availableDependency(),
      elasticsearch: failingDependency(
        new KnowledgeProcessingError(
          "KNOWLEDGE_ELASTICSEARCH_CONTRACT_INCOMPATIBLE",
        ),
      ),
      rerank: null,
    })

    await expect(probe.check()).resolves.toMatchObject({
      readiness: "ready",
      knowledge_search_and_indexing: {
        status: "unavailable",
        reason_code: "KNOWLEDGE_ELASTICSEARCH_CONTRACT_INCOMPATIBLE",
      },
    })
  })

  it("does not expose arbitrary Elasticsearch failures", async () => {
    const probe = new KnowledgeProcessingHealthProbe({
      minio: availableDependency(),
      docling: availableDependency(),
      embedding: availableDependency(),
      elasticsearch: failingDependency(new Error("sensitive upstream detail")),
      rerank: null,
    })

    await expect(probe.check()).resolves.toMatchObject({
      knowledge_search_and_indexing: {
        status: "unavailable",
        reason_code: "KNOWLEDGE_ELASTICSEARCH_UNAVAILABLE",
      },
    })
  })

  it("reuses external knowledge health probes for one minute by default", async () => {
    let now = 0
    const elasticsearchHealth = vi.fn(async () => undefined)
    const probe = new KnowledgeProcessingHealthProbe(
      {
        minio: availableDependency(),
        docling: availableDependency(),
        embedding: availableDependency(),
        elasticsearch: { health: elasticsearchHealth },
        rerank: null,
      },
      { now: () => now },
    )

    await probe.check()
    now = 59_999
    await probe.check()

    expect(elasticsearchHealth).toHaveBeenCalledTimes(1)

    now = 60_000
    await probe.check()

    expect(elasticsearchHealth).toHaveBeenCalledTimes(2)
  })

  it("distinguishes an unconfigured embedding model from a service outage", async () => {
    const probe = new KnowledgeProcessingHealthProbe({
      minio: availableDependency(),
      docling: availableDependency(),
      embedding: async () => {
        throw new AppError("KNOWLEDGE_MODEL_NOT_CONFIGURED")
      },
      elasticsearch: availableDependency(),
      rerank: null,
    })

    await expect(probe.check()).resolves.toMatchObject({
      embedding_model: {
        status: "unavailable",
        reason_code: "KNOWLEDGE_MODEL_NOT_CONFIGURED",
      },
    })
  })
})

function availableDependency(): KnowledgeHealthDependency {
  return {
    health: () => Promise.resolve(),
  }
}

function failingDependency(error: Error): KnowledgeHealthDependency {
  return {
    health: () => Promise.reject(error),
  }
}
