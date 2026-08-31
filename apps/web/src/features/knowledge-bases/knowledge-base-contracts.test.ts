import { describe, expect, it } from "vitest"

import {
  knowledgeBaseCreationCapabilitySchema,
  knowledgeBaseEntryPageSchema,
  knowledgeBaseSchema,
  knowledgeDocumentRebuildBatchResultSchema,
  knowledgeDocumentSchema,
  knowledgeUploadResultSchema,
} from "@/features/knowledge-bases/knowledge-base-contracts"

const documentFixture = {
  id: "00000000-0000-4000-8000-000000000011",
  knowledge_base_id: "00000000-0000-4000-8000-000000000001",
  display_name: "制度.docx",
  canonical_extension: "docx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size_bytes: 4096,
  status: "processing",
  current_version_id: null,
  searchable: false,
  rebuild_required: false,
  processing: {
    operation: "upload",
    processing_generation: "00000000-0000-4000-8000-000000000021",
    stage: "parsing",
    progress_percent: 42,
    revision: 7,
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
}

describe("knowledge base API contracts", () => {
  it("rejects a ready creation status unless every required check is available", () => {
    expect(() =>
      knowledgeBaseCreationCapabilitySchema.parse({
        status: "ready",
        checks: {
          object_storage: "available",
          document_parsing: "unavailable",
          embedding_model: "available",
          search_and_indexing: "available",
        },
        checked_at: "2026-08-31T08:00:00.000Z",
      })
    ).toThrow()
  })

  it("parses the content authorization and storage projection", () => {
    const result = knowledgeBaseSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      name: "产品制度",
      description: null,
      lifecycle_status: "active",
      availability_status: "enabled",
      owner: {
        id: "00000000-0000-4000-8000-000000000002",
        name: "林晓",
      },
      is_owner: false,
      access_sources: [
        { type: "direct", id: "00000000-0000-4000-8000-000000000003" },
        {
          type: "user_group",
          id: "00000000-0000-4000-8000-000000000004",
          name: "产品组",
        },
      ],
      document_count: 4,
      ready_document_count: 3,
      storage_used_bytes: 1024,
      storage_reserved_bytes: 512,
      storage_quota_bytes: 10 * 1024 * 1024,
      permissions: {
        view_content: true,
        update: false,
        manage_documents: false,
        manage_grants: false,
        create_grants: false,
        revoke_grants: false,
        archive: false,
        restore: false,
        delete: false,
        remove_direct_share: true,
      },
      archived_at: null,
      disabled_reason: null,
      created_at: "2026-07-22T01:00:00.000Z",
      updated_at: "2026-07-22T01:01:00.000Z",
    })

    expect(result.access_sources.map((source) => source.type)).toEqual([
      "direct",
      "user_group",
    ])
    expect(result.permissions.view_content).toBe(true)
  })

  it("keeps processing metadata and the server-projected search state", () => {
    const processing = knowledgeDocumentSchema.parse(documentFixture)
    const ready = knowledgeDocumentSchema.parse({
      ...documentFixture,
      status: "ready",
      current_version_id: "00000000-0000-4000-8000-000000000031",
      searchable: true,
      processing: null,
      preview: {
        parsed: true,
        original_supported: false,
        renderer: null,
      },
    })

    expect(processing.processing?.processing_generation).toBe(
      "00000000-0000-4000-8000-000000000021"
    )
    expect(processing.processing?.retry_attempt).toBe(0)
    expect(processing.searchable).toBe(false)
    expect(ready.searchable).toBe(true)
  })

  it("preserves the complete relative path of a flattened document entry", () => {
    const result = knowledgeBaseEntryPageSchema.parse({
      breadcrumbs: [],
      items: [
        {
          id: documentFixture.id,
          knowledge_base_id: documentFixture.knowledge_base_id,
          parent_entry_id: "00000000-0000-4000-8000-000000000041",
          entry_type: "document",
          name: documentFixture.display_name,
          path: ["政策", "人事", documentFixture.display_name],
          document: documentFixture,
          updated_at: documentFixture.updated_at,
        },
      ],
      next_cursor: null,
    })

    expect(result.items[0]?.path).toEqual([
      "政策",
      "人事",
      documentFixture.display_name,
    ])
  })

  it("rejects impossible progress and unknown renderer values", () => {
    expect(() =>
      knowledgeDocumentSchema.parse({
        ...documentFixture,
        processing: {
          ...documentFixture.processing,
          progress_percent: 101,
        },
      })
    ).toThrow()
    expect(() =>
      knowledgeDocumentSchema.parse({
        ...documentFixture,
        preview: { parsed: true, original_supported: true, renderer: "html" },
      })
    ).toThrow()
  })

  it("normalizes successful uploads and preserves each conflict type", () => {
    expect(knowledgeUploadResultSchema.parse(documentFixture).status).toBe(
      "accepted"
    )
    expect(
      knowledgeUploadResultSchema.parse({
        status: "duplicate",
        existing_document: documentFixture,
      }).status
    ).toBe("duplicate")
    expect(
      knowledgeUploadResultSchema.parse({
        status: "name_conflict",
        existing_document: documentFixture,
      }).status
    ).toBe("name_conflict")
  })

  it("reuses the strict shared batch-rebuild result", () => {
    expect(
      knowledgeDocumentRebuildBatchResultSchema.parse({
        items: [
          {
            document_id: documentFixture.id,
            status: "accepted",
            document: documentFixture,
          },
          {
            document_id: "00000000-0000-4000-8000-000000000012",
            status: "rejected",
            error_code: "KNOWLEDGE_DOCUMENT_BUSY",
          },
        ],
        next_cursor: null,
      }).items
    ).toHaveLength(2)
  })
})
