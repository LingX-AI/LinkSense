import { describe, expect, it } from "vitest"

import {
  knowledgeBaseEventSchema,
  knowledgeDocumentSchema,
} from "@/features/knowledge-bases/knowledge-base-contracts"
import {
  applyEventToDocument,
  applyKnowledgeBaseEntryEvent,
  applyKnowledgeBaseEvent,
  hasActiveKnowledgeDocumentProcessing,
  knowledgeDocumentRefetchInterval,
  knowledgeBaseCreationCapabilityRefetchInterval,
  knowledgeBaseCreationCapabilityStaleTime,
  knowledgeSearchCapabilityRefetchInterval,
  knowledgeSearchCapabilityStaleTime,
  reconcileKnowledgeDocumentPages,
  resolveKnowledgeSearchCapability,
} from "@/features/knowledge-bases/knowledge-base-hooks"

const knowledgeBaseId = "00000000-0000-4000-8000-000000000001"
const documentId = "00000000-0000-4000-8000-000000000011"
const generationId = "00000000-0000-4000-8000-000000000021"

describe("knowledge document reconnect polling", () => {
  const page = (...documents: ReturnType<typeof processingDocument>[]) => ({
    pages: [
      {
        items: documents,
        next_cursor: null,
        has_processing_documents: documents.some(
          (document) => document.status === "processing"
        ),
      },
    ],
    pageParams: [undefined],
  })

  it("continues polling while at least one document is processing", () => {
    const data = page(processingDocument())

    expect(hasActiveKnowledgeDocumentProcessing(data)).toBe(true)
    expect(knowledgeDocumentRefetchInterval(data, true)).toBe(5_000)
  })

  it("continues polling when processing is outside the loaded page", () => {
    const readyDocument = knowledgeDocumentSchema.parse({
      ...processingDocument(),
      status: "ready",
      processing: null,
    })
    const data = page(readyDocument)
    data.pages[0].has_processing_documents = true

    expect(hasActiveKnowledgeDocumentProcessing(data)).toBe(true)
    expect(knowledgeDocumentRefetchInterval(data, true)).toBe(5_000)
  })

  it.each(["ready", "failed"] as const)(
    "stops polling after documents reach the %s terminal state",
    (status) => {
      const terminalDocument = knowledgeDocumentSchema.parse({
        ...processingDocument(),
        status,
        processing: null,
      })
      const data = page(terminalDocument)

      expect(hasActiveKnowledgeDocumentProcessing(data)).toBe(false)
      expect(knowledgeDocumentRefetchInterval(data, true)).toBe(false)
    }
  )

  it("does not enable polling solely because document data has not loaded", () => {
    expect(hasActiveKnowledgeDocumentProcessing(undefined)).toBe(false)
    expect(knowledgeDocumentRefetchInterval(undefined, false)).toBe(false)
  })
})

describe("knowledge search capability reconciliation", () => {
  it("keeps available status cached without background polling", () => {
    const capability = {
      status: "available" as const,
      reason_code: null,
      checked_at: "2026-07-22T08:00:00.000Z",
    }

    expect(knowledgeSearchCapabilityStaleTime(capability)).toBe(5 * 60_000)
    expect(knowledgeSearchCapabilityRefetchInterval(capability)).toBe(false)
  })

  it("polls transient unavailable and failed states until recovery", () => {
    const capability = {
      status: "unavailable" as const,
      reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE" as const,
      checked_at: "2026-07-22T08:00:00.000Z",
    }

    expect(knowledgeSearchCapabilityStaleTime(capability)).toBe(0)
    expect(knowledgeSearchCapabilityRefetchInterval(capability)).toBe(10_000)
    expect(knowledgeSearchCapabilityStaleTime(undefined)).toBe(0)
    expect(knowledgeSearchCapabilityRefetchInterval(undefined)).toBe(10_000)
  })

  it("does not poll when the installed edition does not include knowledge search", () => {
    const capability = {
      status: "not_installed" as const,
      reason_code: "KNOWLEDGE_NOT_INSTALLED" as const,
      checked_at: "2026-07-22T08:00:00.000Z",
    }

    expect(knowledgeSearchCapabilityRefetchInterval(capability)).toBe(false)
  })

  it("fails closed with a stable public reason when the status request fails", () => {
    expect(
      resolveKnowledgeSearchCapability(
        {
          status: "available",
          reason_code: null,
          checked_at: "2026-07-22T08:00:00.000Z",
        },
        true,
        Date.parse("2026-07-22T08:01:00.000Z")
      )
    ).toEqual({
      status: "unavailable",
      reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
      checked_at: "2026-07-22T08:01:00.000Z",
    })
  })
})

describe("knowledge-base creation capability polling", () => {
  it("keeps a ready result briefly and stops background polling", () => {
    const capability = {
      status: "ready" as const,
      checks: {
        object_storage: "available" as const,
        document_parsing: "available" as const,
        embedding_model: "available" as const,
        search_and_indexing: "available" as const,
      },
      checked_at: "2026-08-31T08:00:00.000Z",
    }

    expect(knowledgeBaseCreationCapabilityStaleTime(capability)).toBe(60_000)
    expect(knowledgeBaseCreationCapabilityRefetchInterval(capability)).toBe(
      false
    )
  })

  it("polls an unready or unknown result until it recovers", () => {
    const capability = {
      status: "unready" as const,
      checks: {
        object_storage: "available" as const,
        document_parsing: "unavailable" as const,
        embedding_model: "available" as const,
        search_and_indexing: "available" as const,
      },
      checked_at: "2026-08-31T08:00:00.000Z",
    }

    expect(knowledgeBaseCreationCapabilityStaleTime(capability)).toBe(0)
    expect(knowledgeBaseCreationCapabilityRefetchInterval(capability)).toBe(
      10_000
    )
    expect(knowledgeBaseCreationCapabilityRefetchInterval(undefined)).toBe(
      10_000
    )
  })
})

function processingDocument() {
  return knowledgeDocumentSchema.parse({
    id: documentId,
    knowledge_base_id: knowledgeBaseId,
    display_name: "制度.pdf",
    canonical_extension: "pdf",
    mime_type: "application/pdf",
    size_bytes: 4096,
    status: "processing",
    current_version_id: null,
    searchable: false,
    rebuild_required: false,
    processing: {
      operation: "upload",
      processing_generation: generationId,
      stage: "embedding",
      progress_percent: 82,
      revision: 8,
      stable_error_code: null,
      retry_at: null,
      retry_attempt: 0,
      cancellable: true,
    },
    candidate_failure: null,
    preview: {
      parsed: true,
      original_supported: true,
      renderer: "file",
    },
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:01:00.000Z",
  })
}

function event(overrides: Record<string, unknown> = {}) {
  return knowledgeBaseEventSchema.parse({
    type: "knowledge_document_processing_updated",
    knowledge_base_id: knowledgeBaseId,
    document_id: documentId,
    processing_generation: generationId,
    status: "processing",
    stage: "indexing",
    progress_percent: 90,
    revision: 9,
    retry_at: null,
    retry_attempt: 0,
    stable_error_code: null,
    updated_at: "2026-07-22T01:02:00.000Z",
    ...overrides,
  })
}

describe("knowledge base SSE reconciliation", () => {
  it("ignores a late event whose revision is not newer", () => {
    const document = processingDocument()
    expect(
      applyEventToDocument(
        document,
        event({ revision: 8, progress_percent: 30 })
      )
    ).toBe(document)
  })

  it("keeps progress monotonic inside one processing generation", () => {
    const next = applyEventToDocument(
      processingDocument(),
      event({ revision: 9, progress_percent: 70 })
    )
    expect(next.processing?.progress_percent).toBe(82)
    expect(next.event_revision).toBe(9)
  })

  it("keeps the SSE projection stable when polling returns an older snapshot", () => {
    const document = applyEventToDocument(
      processingDocument(),
      event({ revision: 10, progress_percent: 92 })
    )
    const current = {
      pages: [
        {
          items: [document],
          next_cursor: null,
          has_processing_documents: true,
        },
      ],
      pageParams: [undefined],
    }
    const staleDocument = knowledgeDocumentSchema.parse({
      ...processingDocument(),
      processing: {
        ...processingDocument().processing,
        stage: "embedding",
        progress_percent: 85,
        revision: 9,
      },
    })
    const incoming = {
      pages: [
        {
          items: [staleDocument],
          next_cursor: null,
          has_processing_documents: true,
        },
      ],
      pageParams: [undefined],
    }

    const reconciled = reconcileKnowledgeDocumentPages(current, incoming)

    expect(reconciled).toBe(current)
    expect(reconciled.pages[0]?.items[0]).toBe(document)
    expect(reconciled.pages[0]?.items[0]?.processing).toMatchObject({
      stage: "indexing",
      progress_percent: 92,
      revision: 10,
    })
  })

  it("accepts a newer snapshot and a new processing generation", () => {
    const currentDocument = applyEventToDocument(
      processingDocument(),
      event({ revision: 10, progress_percent: 92 })
    )
    const current = {
      pages: [
        {
          items: [currentDocument],
          next_cursor: null,
          has_processing_documents: true,
        },
      ],
      pageParams: [undefined],
    }
    const newerDocument = knowledgeDocumentSchema.parse({
      ...processingDocument(),
      processing: {
        ...processingDocument().processing,
        stage: "activating",
        progress_percent: 98,
        revision: 11,
      },
    })
    const newGenerationDocument = knowledgeDocumentSchema.parse({
      ...processingDocument(),
      processing: {
        ...processingDocument().processing,
        processing_generation: "00000000-0000-4000-8000-000000000022",
        stage: "validating",
        progress_percent: 15,
        revision: 1,
      },
    })

    expect(
      reconcileKnowledgeDocumentPages(current, {
        pages: [
          {
            items: [newerDocument],
            next_cursor: null,
            has_processing_documents: true,
          },
        ],
        pageParams: [undefined],
      }).pages[0]?.items[0]
    ).toEqual(newerDocument)
    expect(
      reconcileKnowledgeDocumentPages(current, {
        pages: [
          {
            items: [newGenerationDocument],
            next_cursor: null,
            has_processing_documents: true,
          },
        ],
        pageParams: [undefined],
      }).pages[0]?.items[0]
    ).toEqual(newGenerationDocument)
  })

  it("keeps metadata updates from a snapshot at the current revision", () => {
    const currentDocument = applyEventToDocument(
      processingDocument(),
      event({ revision: 10, progress_percent: 92 })
    )
    const current = {
      pages: [
        {
          items: [currentDocument],
          next_cursor: null,
          has_processing_documents: true,
        },
      ],
      pageParams: [undefined],
    }
    const renamedDocument = knowledgeDocumentSchema.parse({
      ...processingDocument(),
      display_name: "新版制度.pdf",
      updated_at: "2026-07-22T01:03:00.000Z",
      processing: {
        ...processingDocument().processing,
        stage: "indexing",
        progress_percent: 92,
        revision: 10,
      },
    })

    const reconciled = reconcileKnowledgeDocumentPages(current, {
      pages: [
        {
          items: [renamedDocument],
          next_cursor: null,
          has_processing_documents: true,
        },
      ],
      pageParams: [undefined],
    }).pages[0]?.items[0]

    expect(reconciled).toMatchObject({
      display_name: "新版制度.pdf",
      updated_at: "2026-07-22T01:03:00.000Z",
      event_revision: 10,
    })
    expect(reconciled?.processing).toBe(currentDocument.processing)
  })

  it("allows a new processing generation to restart its own progress", () => {
    const next = applyEventToDocument(
      processingDocument(),
      event({
        processing_generation: "00000000-0000-4000-8000-000000000022",
        revision: 10,
        progress_percent: 15,
        stage: "validating",
      })
    )
    expect(next.processing?.processing_generation).toBe(
      "00000000-0000-4000-8000-000000000022"
    )
    expect(next.processing?.progress_percent).toBe(15)
  })

  it("records the terminal revision so a late event cannot revive a ready item", () => {
    const ready = applyEventToDocument(
      processingDocument(),
      event({
        status: "ready",
        stage: null,
        progress_percent: 100,
        revision: 12,
      })
    )
    const late = applyEventToDocument(
      ready,
      event({ revision: 11, progress_percent: 97 })
    )

    expect(ready.status).toBe("ready")
    expect(ready.processing).toBeNull()
    expect(ready.searchable).toBe(false)
    expect(ready.event_revision).toBe(12)
    expect(late).toBe(ready)
  })

  it("removes a document immediately when a deleted event arrives", () => {
    const current = {
      pages: [
        {
          items: [processingDocument()],
          next_cursor: null,
          has_processing_documents: true,
        },
      ],
      pageParams: [undefined],
    }
    const next = applyKnowledgeBaseEvent(
      current,
      event({
        type: "knowledge_document_deleted",
        status: "deleted",
        stage: null,
        progress_percent: null,
        processing_generation: null,
        revision: 12,
      })
    )

    expect(next?.pages[0]?.items).toEqual([])
  })

  it("updates and removes the matching document inside a directory page", () => {
    const current = {
      pages: [
        {
          breadcrumbs: [
            {
              id: "00000000-0000-4000-8000-000000000031",
              name: "政策",
            },
          ],
          items: [
            {
              id: "00000000-0000-4000-8000-000000000041",
              knowledge_base_id: knowledgeBaseId,
              parent_entry_id: "00000000-0000-4000-8000-000000000031",
              entry_type: "document" as const,
              name: "制度.pdf",
              document: processingDocument(),
              updated_at: "2026-07-22T01:01:00.000Z",
            },
          ],
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    }

    const processing = applyKnowledgeBaseEntryEvent(
      current,
      event({ revision: 10, progress_percent: 94 })
    )
    expect(
      processing?.pages[0]?.items[0]?.entry_type === "document"
        ? processing.pages[0].items[0].document.processing?.progress_percent
        : null
    ).toBe(94)

    const deleted = applyKnowledgeBaseEntryEvent(
      processing,
      event({
        type: "knowledge_document_deleted",
        status: "deleted",
        stage: null,
        progress_percent: null,
        processing_generation: null,
        revision: 11,
      })
    )
    expect(deleted?.pages[0]?.items).toEqual([])
  })
})
