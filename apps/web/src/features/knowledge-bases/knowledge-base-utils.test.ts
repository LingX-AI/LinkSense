import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"

import {
  knowledgeBaseSchema,
  knowledgeDocumentSchema,
} from "@/features/knowledge-bases/knowledge-base-contracts"
import {
  canCancelKnowledgeDocument,
  formatKnowledgeBytes,
  getKnowledgeBaseSourceTypeLabel,
  getKnowledgeStableErrorLabel,
  isKnowledgeBaseAvailableForTurn,
  isOriginalPreviewUnsupported,
  isKnowledgeStageIndeterminate,
  validateKnowledgeUploadFile,
} from "@/features/knowledge-bases/knowledge-base-utils"

const t = ((key: string) => key) as TFunction
const deploymentFileLimit = 13 * 1024 * 1024
const uploadValidationLimits = {
  maxFileSizeBytes: deploymentFileLimit,
  maxFileSizeLabel: "13 MiB",
}

function fileWithSize(name: string, size: number) {
  const file = new File(["content"], name)
  Object.defineProperty(file, "size", { configurable: true, value: size })
  return file
}

function documentFixture(overrides: Record<string, unknown> = {}) {
  return knowledgeDocumentSchema.parse({
    id: "00000000-0000-4000-8000-000000000011",
    knowledge_base_id: "00000000-0000-4000-8000-000000000001",
    display_name: "扫描件.tif",
    canonical_extension: "tif",
    mime_type: "image/tiff",
    size_bytes: 4096,
    status: "ready",
    current_version_id: "00000000-0000-4000-8000-000000000031",
    searchable: true,
    rebuild_required: false,
    processing: null,
    candidate_failure: null,
    preview: {
      parsed: true,
      original_supported: true,
      renderer: "file",
    },
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:01:00.000Z",
    ...overrides,
  })
}

function knowledgeBaseFixture(overrides: Record<string, unknown> = {}) {
  return knowledgeBaseSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    name: "制度库",
    description: null,
    lifecycle_status: "active",
    availability_status: "enabled",
    owner: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "管理员",
    },
    is_owner: true,
    access_sources: [{ type: "owner" }],
    document_count: 1,
    ready_document_count: 1,
    storage_used_bytes: 4_096,
    storage_reserved_bytes: 0,
    storage_quota_bytes: 10_000,
    permissions: {
      view_content: true,
      update: true,
      manage_documents: true,
      manage_grants: true,
      create_grants: true,
      revoke_grants: true,
      archive: true,
      restore: false,
      delete: false,
      remove_direct_share: false,
    },
    archived_at: null,
    disabled_reason: null,
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:01:00.000Z",
    ...overrides,
  })
}

describe("knowledge base UI rules", () => {
  it("accepts OCR images, legacy Office files, and Visio drawings", () => {
    for (const extension of ["tif", "tiff", "bmp"]) {
      expect(
        validateKnowledgeUploadFile(
          fileWithSize(`document.${extension}`, deploymentFileLimit),
          t,
          uploadValidationLimits
        )
      ).toBeNull()
    }
    for (const extension of ["doc", "xls", "ppt", "vsdx"]) {
      expect(
        validateKnowledgeUploadFile(
          fileWithSize(`document.${extension}`, deploymentFileLimit),
          t,
          uploadValidationLimits
        )
      ).toBeNull()
    }
  })

  it("rejects an empty, oversized, or unsupported file", () => {
    expect(
      validateKnowledgeUploadFile(
        fileWithSize("empty.pdf", 0),
        t,
        uploadValidationLimits
      )
    ).toBe("knowledge.upload.errors.emptyFile")
    expect(
      validateKnowledgeUploadFile(
        fileWithSize("large.pdf", deploymentFileLimit + 1),
        t,
        uploadValidationLimits
      )
    ).toBe("knowledge.upload.errors.fileTooLarge")
    expect(
      validateKnowledgeUploadFile(
        fileWithSize("payload.zip", 1024),
        t,
        uploadValidationLimits
      )
    ).toBe("knowledge.upload.errors.unsupportedFormat")
  })

  it("uses server preview capability instead of guessing from MIME", () => {
    expect(isOriginalPreviewUnsupported(documentFixture())).toBe(false)
    expect(
      isOriginalPreviewUnsupported(
        documentFixture({
          preview: {
            parsed: true,
            original_supported: false,
            renderer: null,
          },
        })
      )
    ).toBe(true)
  })

  it("allows only active, enabled, currently authorized knowledge bases in a turn", () => {
    expect(isKnowledgeBaseAvailableForTurn(knowledgeBaseFixture())).toBe(true)
    expect(
      isKnowledgeBaseAvailableForTurn(
        knowledgeBaseFixture({
          lifecycle_status: "archived",
          archived_at: "2026-07-22T02:00:00.000Z",
        })
      )
    ).toBe(false)
    expect(
      isKnowledgeBaseAvailableForTurn(
        knowledgeBaseFixture({ availability_status: "disabled" })
      )
    ).toBe(false)
    expect(
      isKnowledgeBaseAvailableForTurn(
        knowledgeBaseFixture({
          permissions: {
            ...knowledgeBaseFixture().permissions,
            view_content: false,
          },
        })
      )
    ).toBe(false)
  })

  it("labels local and SharePoint knowledge-base sources", () => {
    const sourceT = ((key: string) => {
      const labels: Record<string, string> = {
        "knowledge.sourceType.local": "本地",
        "knowledge.sourceType.sharepoint": "SharePoint",
      }
      return labels[key] ?? key
    }) as TFunction
    expect(
      getKnowledgeBaseSourceTypeLabel(
        knowledgeBaseFixture({ source_type: "local" }),
        sourceT
      )
    ).toBe("本地")
    expect(
      getKnowledgeBaseSourceTypeLabel(
        knowledgeBaseFixture({ source_type: "sharepoint" }),
        sourceT
      )
    ).toBe("SharePoint")
  })

  it("hides cancellation once activation reaches 98 percent", () => {
    const baseProcessing = {
      operation: "rebuild",
      processing_generation: "00000000-0000-4000-8000-000000000021",
      stage: "indexing",
      revision: 10,
      stable_error_code: null,
      retry_at: null,
      retry_attempt: 0,
      cancellable: true,
    }
    expect(
      canCancelKnowledgeDocument(
        documentFixture({
          status: "processing",
          processing: { ...baseProcessing, progress_percent: 97 },
        })
      )
    ).toBe(true)
    expect(
      canCancelKnowledgeDocument(
        documentFixture({
          status: "processing",
          processing: { ...baseProcessing, progress_percent: 98 },
        })
      )
    ).toBe(false)
  })

  it("uses indeterminate progress only for external parsing and child chunking", () => {
    expect(isKnowledgeStageIndeterminate("parsing")).toBe(true)
    expect(isKnowledgeStageIndeterminate("CHUNKING")).toBe(true)
    expect(isKnowledgeStageIndeterminate("parenting")).toBe(false)
    expect(isKnowledgeStageIndeterminate("embedding")).toBe(false)
  })

  it("maps stable pipeline errors to safe localized categories", () => {
    expect(
      getKnowledgeStableErrorLabel("KNOWLEDGE_DOCUMENT_ENCRYPTED", t)
    ).toBe("knowledge.document.failure.encrypted")
    expect(
      getKnowledgeStableErrorLabel("KNOWLEDGE_DOCLING_UNAVAILABLE", t)
    ).toBe("knowledge.document.failure.serviceUnavailable")
    expect(
      getKnowledgeStableErrorLabel("KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE", t)
    ).toBe("knowledge.document.failure.serviceUnavailable")
    expect(
      getKnowledgeStableErrorLabel("KNOWLEDGE_DOCLING_RESULT_INVALID", t)
    ).toBe("knowledge.document.failure.parsingServiceFailed")
    expect(
      getKnowledgeStableErrorLabel("KNOWLEDGE_DOCLING_TASK_NOT_FOUND", t)
    ).toBe("knowledge.document.failure.parsingTaskExpired")
    expect(
      getKnowledgeStableErrorLabel("KNOWLEDGE_DOCLING_RESULT_UNSAFE", t)
    ).toBe("knowledge.document.failure.parsingInvalid")
    expect(
      getKnowledgeStableErrorLabel("KNOWLEDGE_IMAGE_MODEL_NOT_FOUND", t)
    ).toBe("knowledge.document.failure.imageModelNotFound")
    expect(getKnowledgeStableErrorLabel("PRIVATE_PROVIDER_ERROR", t)).toBe(
      "knowledge.document.failure.unknown"
    )
  })

  it("formats binary storage sizes without decimal noise", () => {
    expect(formatKnowledgeBytes(1024, "en-US")).toBe("1 KiB")
    expect(formatKnowledgeBytes(10 * 1024 * 1024, "zh-CN")).toBe("10 MiB")
  })
})
