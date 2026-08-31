import { describe, expect, it, vi } from "vitest"

import { KnowledgeProcessingError } from "../src/modules/knowledge-processing/errors.js"
import { runKnowledgeDocumentExclusiveMutation } from "../src/modules/knowledge/document-mutation.js"
import type { KnowledgeProcessingScheduler } from "../src/modules/knowledge/types.js"

const DOCUMENT_A = "00000000-0000-4000-8000-000000000001"
const DOCUMENT_B = "00000000-0000-4000-8000-000000000002"
const DOCUMENT_C = "00000000-0000-4000-8000-000000000003"

describe("knowledge document exclusive mutation", () => {
  it("acquires unique document locks in stable order and releases them in reverse", async () => {
    const events: string[] = []
    const scheduler = schedulerWithLock(async (documentId, operation) => {
      events.push(`acquire:${documentId}`)
      try {
        return await operation(new AbortController().signal)
      } finally {
        events.push(`release:${documentId}`)
      }
    })

    await expect(
      runKnowledgeDocumentExclusiveMutation({
        scheduler,
        documentIds: [DOCUMENT_C, DOCUMENT_A, DOCUMENT_B, DOCUMENT_A],
        operation: async (_signal, orderedDocumentIds) => {
          events.push(`mutate:${orderedDocumentIds.join(",")}`)
          return "deleted"
        },
      }),
    ).resolves.toBe("deleted")

    expect(events).toEqual([
      `acquire:${DOCUMENT_A}`,
      `acquire:${DOCUMENT_B}`,
      `acquire:${DOCUMENT_C}`,
      `mutate:${DOCUMENT_A},${DOCUMENT_B},${DOCUMENT_C}`,
      `release:${DOCUMENT_C}`,
      `release:${DOCUMENT_B}`,
      `release:${DOCUMENT_A}`,
    ])
  })

  it("does not enter the mutation when a later lock is busy", async () => {
    const operation = vi.fn(async () => undefined)
    const abortActiveDocumentMutations = vi.fn()
    const scheduler = schedulerWithLock(
      async (documentId, run) => {
        if (documentId === DOCUMENT_B) {
          throw new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_BUSY", {
            retryable: true,
          })
        }
        return run(new AbortController().signal)
      },
      abortActiveDocumentMutations,
    )

    await expect(
      runKnowledgeDocumentExclusiveMutation({
        scheduler,
        documentIds: [DOCUMENT_B, DOCUMENT_A],
        operation,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_BUSY" })
    expect(operation).not.toHaveBeenCalled()
    expect(abortActiveDocumentMutations).not.toHaveBeenCalled()
  })

  it("maps a Redis lock failure to a stable unavailable business error", async () => {
    const scheduler = schedulerWithLock(async () => {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
        { retryable: true },
      )
    })

    await expect(
      runKnowledgeDocumentExclusiveMutation({
        scheduler,
        documentIds: [DOCUMENT_A],
        operation: async () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
    })
  })
})

function schedulerWithLock(
  runDocumentExclusiveMutation: KnowledgeProcessingScheduler["runDocumentExclusiveMutation"],
  abortActiveDocumentMutations = vi.fn(),
): KnowledgeProcessingScheduler {
  return {
    enqueue: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    runDocumentExclusiveMutation,
    abortActiveDocumentMutations,
  }
}
