import { describe, expect, it, vi } from "vitest"

import {
  createNotInstalledKnowledgeSearchCapability,
  KnowledgeSearchCapabilityReader,
  mapKnowledgeSearchCapability,
} from "../src/modules/knowledge/search-capability.js"

const CHECKED_AT = "2026-07-22T08:00:00.000Z"

describe("public knowledge-search capability", () => {
  it("reports the stable Core-edition not-installed state without probing", () => {
    expect(
      createNotInstalledKnowledgeSearchCapability(() =>
        Date.parse(CHECKED_AT),
      ),
    ).toEqual({
      status: "not_installed",
      reason_code: "KNOWLEDGE_NOT_INSTALLED",
      checked_at: CHECKED_AT,
    })
  })

  it("maps internal failures to an exact stable-code-only response", () => {
    const internalHealth = {
      checked_at: CHECKED_AT,
      knowledge_search_and_indexing: {
        status: "unavailable",
        reason_code: "KNOWLEDGE_ELASTICSEARCH_UNAVAILABLE",
        latency_ms: 321,
        model: "private-model",
        endpoint: "https://private.example/elasticsearch",
      },
    } as const
    const mapped = mapKnowledgeSearchCapability(internalHealth)

    expect(mapped).toEqual({
      status: "unavailable",
      reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
      checked_at: CHECKED_AT,
    })
    expect(mapped).not.toHaveProperty("latency_ms")
    expect(mapped).not.toHaveProperty("model")
    expect(mapped).not.toHaveProperty("endpoint")
  })

  it("preserves only the actionable dimension-mismatch reason", () => {
    expect(
      mapKnowledgeSearchCapability({
        checked_at: CHECKED_AT,
        knowledge_search_and_indexing: {
          status: "unavailable",
          reason_code: "EMBEDDING_DIMENSION_MISMATCH",
        },
      }),
    ).toEqual({
      status: "unavailable",
      reason_code: "EMBEDDING_DIMENSION_MISMATCH",
      checked_at: CHECKED_AT,
    })
  })

  it("fails closed when an inconsistent snapshot claims availability", () => {
    expect(
      mapKnowledgeSearchCapability({
        checked_at: CHECKED_AT,
        knowledge_search_and_indexing: {
          status: "available",
          reason_code: "KNOWLEDGE_ELASTICSEARCH_UNAVAILABLE",
        },
      }),
    ).toEqual({
      status: "unavailable",
      reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
      checked_at: CHECKED_AT,
    })
  })

  it("coalesces callers and caches the public result across user requests", async () => {
    let now = 1_000
    const checkHealth = vi.fn(async () => ({
      checked_at: CHECKED_AT,
      knowledge_search_and_indexing: {
        status: "available" as const,
        reason_code: null,
      },
    }))
    const reader = new KnowledgeSearchCapabilityReader(checkHealth, {
      cacheTtlMs: 30_000,
      now: () => now,
    })

    const [first, second] = await Promise.all([reader.read(), reader.read()])
    expect(first).toEqual(second)
    expect(checkHealth).toHaveBeenCalledOnce()

    await reader.read()
    expect(checkHealth).toHaveBeenCalledOnce()

    now += 30_001
    await reader.read()
    expect(checkHealth).toHaveBeenCalledTimes(2)
  })

  it("does not cache a rejected probe and can recover on the next request", async () => {
    const checkHealth = vi
      .fn<
        () => Promise<{
          checked_at: string
          knowledge_search_and_indexing: {
            status: "available"
            reason_code: null
          }
        }>
      >()
      .mockRejectedValueOnce(new Error("probe failed"))
      .mockResolvedValueOnce({
        checked_at: CHECKED_AT,
        knowledge_search_and_indexing: {
          status: "available",
          reason_code: null,
        },
      })
    const reader = new KnowledgeSearchCapabilityReader(checkHealth)

    await expect(reader.read()).rejects.toThrow("probe failed")
    await expect(reader.read()).resolves.toMatchObject({ status: "available" })
    expect(checkHealth).toHaveBeenCalledTimes(2)
  })
})
