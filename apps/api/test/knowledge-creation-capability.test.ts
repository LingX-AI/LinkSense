import { describe, expect, it, vi } from "vitest"

import {
  createNotInstalledKnowledgeBaseCreationCapability,
  KnowledgeBaseCreationCapabilityReader,
  mapKnowledgeBaseCreationCapability,
} from "../src/modules/knowledge/creation-capability.js"
import type { KnowledgeProcessingHealthSnapshot } from "../src/modules/knowledge-processing/health.js"

const CHECKED_AT = "2026-08-31T08:00:00.000Z"

describe("knowledge-base creation capability", () => {
  it("requires storage, parsing, embedding, and indexing together", () => {
    const capability = mapKnowledgeBaseCreationCapability(
      healthSnapshot({ document_parsing: unavailable("private failure") })
    )

    expect(capability).toEqual({
      status: "unready",
      checks: {
        object_storage: "available",
        document_parsing: "unavailable",
        embedding_model: "available",
        search_and_indexing: "available",
      },
      checked_at: CHECKED_AT,
    })
    expect(JSON.stringify(capability)).not.toContain("private failure")
  })

  it("reports an embedding model that has not been configured", () => {
    expect(
      mapKnowledgeBaseCreationCapability(
        healthSnapshot({
          embedding_model: unavailable("KNOWLEDGE_MODEL_NOT_CONFIGURED"),
        })
      )
    ).toMatchObject({
      status: "unready",
      checks: { embedding_model: "not_configured" },
    })
  })

  it("returns ready only when every required check is available", () => {
    expect(mapKnowledgeBaseCreationCapability(healthSnapshot())).toEqual({
      status: "ready",
      checks: {
        object_storage: "available",
        document_parsing: "available",
        embedding_model: "available",
        search_and_indexing: "available",
      },
      checked_at: CHECKED_AT,
    })
  })

  it("invalidates cached health before retry and before creation", async () => {
    const invalidate = vi.fn()
    const check = vi.fn(async () => healthSnapshot())
    const reader = new KnowledgeBaseCreationCapabilityReader({
      check,
      invalidate,
    })

    await reader.read(true)
    await reader.assertReady()

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it("blocks creation when any required service is unavailable", async () => {
    const reader = new KnowledgeBaseCreationCapabilityReader({
      check: vi.fn(async () =>
        healthSnapshot({ embedding_model: unavailable("upstream detail") })
      ),
      invalidate: vi.fn(),
    })

    await expect(reader.assertReady()).rejects.toMatchObject({
      code: "KNOWLEDGE_BASE_CREATION_UNAVAILABLE",
    })
  })

  it("reports the full feature as not installed without dependency details", () => {
    expect(
      createNotInstalledKnowledgeBaseCreationCapability(() =>
        Date.parse(CHECKED_AT)
      )
    ).toEqual({ status: "not_installed", checks: null, checked_at: CHECKED_AT })
  })
})

function healthSnapshot(
  overrides: Partial<KnowledgeProcessingHealthSnapshot> = {}
): KnowledgeProcessingHealthSnapshot {
  return {
    checked_at: CHECKED_AT,
    readiness: "ready",
    minio: available(),
    document_parsing: available(),
    embedding_model: available(),
    knowledge_search_and_indexing: available(),
    rerank: {
      status: "not_configured",
      reason_code: null,
      latency_ms: 0,
    },
    ...overrides,
  }
}

function available() {
  return { status: "available" as const, reason_code: null, latency_ms: 1 }
}

function unavailable(reasonCode: string) {
  return {
    status: "unavailable" as const,
    reason_code: reasonCode,
    latency_ms: 1,
  }
}
