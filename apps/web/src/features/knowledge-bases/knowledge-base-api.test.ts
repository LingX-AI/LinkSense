import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  downloadKnowledgeDocument,
  getKnowledgeBaseCreationCapability,
  loadKnowledgeDocumentPreview,
  listKnowledgeBaseEntries,
  rebuildKnowledgeDocuments,
  uploadKnowledgeDocument,
} from "@/features/knowledge-bases/knowledge-base-api"

const apiRequest = vi.hoisted(() => vi.fn())
const downloadApiFile = vi.hoisted(() => vi.fn())

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest,
  downloadApiFile,
}))

const knowledgeBaseId = "00000000-0000-4000-8000-000000000001"
const documentId = "00000000-0000-4000-8000-000000000002"
const documentVersionId = "00000000-0000-4000-8000-000000000003"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("knowledge-base creation capability API", () => {
  it("requests a fresh server-side probe when the user retries", async () => {
    apiRequest.mockReset().mockResolvedValue({ status: "ready" })
    const controller = new AbortController()

    await getKnowledgeBaseCreationCapability({
      refresh: true,
      signal: controller.signal,
    })

    expect(apiRequest).toHaveBeenCalledWith(
      "/knowledge-bases/creation-capability",
      expect.objectContaining({
        query: { refresh: "true" },
        signal: controller.signal,
      })
    )
  })
})

describe("knowledge-base document upload API", () => {
  it("parses the accepted document inside the success envelope", async () => {
    let sentBody: Document | XMLHttpRequestBodyInit | null | undefined
    const document = {
      id: documentId,
      knowledge_base_id: knowledgeBaseId,
      display_name: "manual.txt",
      canonical_extension: "txt" as const,
      mime_type: "text/plain",
      size_bytes: 6,
      status: "processing" as const,
      current_version_id: null,
      searchable: false,
      rebuild_required: false,
      processing: {
        operation: "upload" as const,
        processing_generation: documentVersionId,
        stage: "queued" as const,
        progress_percent: 15,
        revision: 1,
        stable_error_code: null,
        retry_at: null,
        retry_attempt: 0,
        cancellable: true,
      },
      candidate_failure: null,
      preview: {
        parsed: true as const,
        original_supported: true,
        renderer: null,
      },
      created_at: "2026-07-23T03:00:00.000Z",
      updated_at: "2026-07-23T03:00:00.000Z",
    }

    class SuccessfulUploadRequest {
      responseType = ""
      readonly status = 202
      readonly response = { success: true, data: document, request_id: "req-1" }
      readonly upload = new EventTarget()
      private readonly listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
      >()

      open() {}
      setRequestHeader() {}
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null
      ) {
        if (listener === null) return
        const listeners = this.listeners.get(type) ?? new Set()
        listeners.add(listener)
        this.listeners.set(type, listeners)
      }
      send(body?: Document | XMLHttpRequestBodyInit | null) {
        sentBody = body
        queueMicrotask(() => this.dispatch("load"))
      }
      abort() {
        this.dispatch("abort")
      }
      private dispatch(type: string) {
        const event = new Event(type)
        for (const listener of this.listeners.get(type) ?? []) {
          if (typeof listener === "function") listener(event)
          else listener.handleEvent(event)
        }
      }
    }

    vi.stubGlobal("XMLHttpRequest", SuccessfulUploadRequest)

    await expect(
      uploadKnowledgeDocument({
        knowledgeBaseId,
        file: new File(["manual"], "manual.txt", { type: "text/plain" }),
        relativePath: "Policies/HR/manual.txt",
        parentEntryId: documentVersionId,
        conflictResolution: "replace_path",
      })
    ).resolves.toEqual({ status: "accepted", document })
    expect(sentBody).toBeInstanceOf(FormData)
    expect((sentBody as FormData).get("ocr_enabled")).toBe("false")
    expect((sentBody as FormData).get("relative_path")).toBe(
      "Policies/HR/manual.txt"
    )
    expect((sentBody as FormData).get("parent_entry_id")).toBe(
      documentVersionId
    )
    expect((sentBody as FormData).get("conflict_resolution")).toBe(
      "replace_path"
    )
  })
})

describe("knowledge-base original file API", () => {
  beforeEach(() => {
    apiRequest.mockReset()
    downloadApiFile.mockReset()
    downloadApiFile.mockResolvedValue(new Blob())
  })

  it("uses independent inline-preview and attachment-download endpoints", async () => {
    const previewController = new AbortController()
    const downloadController = new AbortController()

    await loadKnowledgeDocumentPreview(
      knowledgeBaseId,
      documentId,
      documentVersionId,
      previewController.signal
    )
    await downloadKnowledgeDocument(
      knowledgeBaseId,
      documentId,
      documentVersionId,
      downloadController.signal
    )

    expect(downloadApiFile).toHaveBeenNthCalledWith(
      1,
      `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/preview`,
      { document_version_id: documentVersionId },
      previewController.signal
    )
    expect(downloadApiFile).toHaveBeenNthCalledWith(
      2,
      `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/original`,
      { document_version_id: documentVersionId },
      downloadController.signal
    )
  })
})

describe("knowledge-base entry API", () => {
  beforeEach(() => {
    apiRequest.mockReset().mockResolvedValue({
      breadcrumbs: [],
      items: [],
      next_cursor: null,
    })
  })

  it("requests the recursive flat view explicitly", async () => {
    await listKnowledgeBaseEntries(knowledgeBaseId, { view: "flat" })

    expect(apiRequest).toHaveBeenCalledWith(
      `/knowledge-bases/${knowledgeBaseId}/entries`,
      expect.objectContaining({
        query: {
          parent_entry_id: undefined,
          view: "flat",
          cursor: undefined,
          limit: 100,
        },
      })
    )
  })
})

describe("knowledge-base document rebuild API", () => {
  beforeEach(() => {
    apiRequest.mockReset()
  })

  it("walks rebuild-all keyset pages while retaining only aggregate counts", async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [{ status: "accepted" }],
        next_cursor: documentVersionId,
      })
      .mockResolvedValueOnce({
        items: [{ status: "rejected" }],
        next_cursor: null,
      })

    await expect(rebuildKnowledgeDocuments(knowledgeBaseId)).resolves.toEqual({
      accepted: 1,
      rejected: 1,
    })
    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      `/knowledge-bases/${knowledgeBaseId}/documents/rebuild`,
      expect.objectContaining({ method: "POST", body: {} })
    )
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      `/knowledge-bases/${knowledgeBaseId}/documents/rebuild`,
      expect.objectContaining({
        method: "POST",
        body: { cursor: documentVersionId },
      })
    )
  })

  it("splits an explicit selection into bounded request batches", async () => {
    const documentIds = Array.from(
      { length: 205 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`
    )
    apiRequest
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, () => ({ status: "accepted" })),
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, () => ({ status: "accepted" })),
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 5 }, () => ({ status: "rejected" })),
        next_cursor: null,
      })

    await expect(
      rebuildKnowledgeDocuments(knowledgeBaseId, documentIds)
    ).resolves.toEqual({ accepted: 200, rejected: 5 })
    expect(apiRequest).toHaveBeenCalledTimes(3)
    for (const [index, expectedSize] of [100, 100, 5].entries()) {
      expect(apiRequest.mock.calls[index]?.[1]).toEqual(
        expect.objectContaining({
          method: "POST",
          body: {
            document_ids: documentIds.slice(
              index * 100,
              index * 100 + expectedSize
            ),
          },
        })
      )
    }
  })
})
