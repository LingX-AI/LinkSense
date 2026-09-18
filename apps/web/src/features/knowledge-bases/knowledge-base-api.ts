import { z } from "zod"
import {
  knowledgeCitationPreviewSchema,
  knowledgeDocumentRebuildBatchSize,
  type KnowledgeSourceSyncSchedule,
} from "@linksense/shared"

import {
  ApiError,
  apiRequest,
  buildApiUrl,
  downloadApiFile,
  isDefinitiveAuthenticationError,
  refreshSession,
  prepareClientBuildRequest,
  validateUploadResponseBuild,
} from "@/api/client"
import { getAccessToken, setAccessToken } from "@/api/session"
import {
  knowledgeBasePageSchema,
  knowledgeBaseCreationCapabilitySchema,
  knowledgeBaseEntryPageSchema,
  knowledgeBaseSchema,
  knowledgeDocumentContentSchema,
  knowledgeDocumentPageSchema,
  knowledgeDocumentRebuildBatchResultSchema,
  knowledgeDocumentSchema,
  knowledgeGrantPageSchema,
  knowledgeGrantRevocationResultSchema,
  knowledgeGrantSchema,
  knowledgeSearchCapabilitySchema,
  knowledgeShareTargetPageSchema,
  knowledgeUploadResultSchema,
  knowledgeUploadLimitsSchema,
  type KnowledgeBaseLifecycle,
  type KnowledgeShareTarget,
  type KnowledgeUploadResult,
} from "@/features/knowledge-bases/knowledge-base-contracts"

const emptyResponseSchema = z.unknown()

export type KnowledgeBaseScope = "all" | "owned" | "shared"
export type KnowledgeBaseListLifecycle = KnowledgeBaseLifecycle | "all"

export const knowledgeBaseQueryKeys = {
  all: ["knowledge-bases"] as const,
  config: () => ["knowledge-bases", "config"] as const,
  creationCapability: () => ["knowledge-bases", "creation-capability"] as const,
  searchCapability: () => ["knowledge-bases", "search-capability"] as const,
  lists: () => ["knowledge-bases", "list"] as const,
  list: (filters: {
    lifecycle: KnowledgeBaseListLifecycle
    scope: KnowledgeBaseScope
    search: string
  }) => ["knowledge-bases", "list", filters] as const,
  detail: (knowledgeBaseId: string) =>
    ["knowledge-bases", "detail", knowledgeBaseId] as const,
  documents: (knowledgeBaseId: string) =>
    ["knowledge-bases", "documents", knowledgeBaseId] as const,
  entries: (knowledgeBaseId: string) =>
    ["knowledge-bases", "entries", knowledgeBaseId] as const,
  entryDirectory: (
    knowledgeBaseId: string,
    parentEntryId?: string,
    view: "directory" | "flat" = "directory"
  ) =>
    [
      "knowledge-bases",
      "entries",
      knowledgeBaseId,
      view,
      parentEntryId ?? "root",
    ] as const,
  document: (
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId?: string
  ) =>
    documentVersionId
      ? ([
          "knowledge-bases",
          "document",
          knowledgeBaseId,
          documentId,
          documentVersionId,
        ] as const)
      : (["knowledge-bases", "document", knowledgeBaseId, documentId] as const),
  grants: (knowledgeBaseId: string) =>
    ["knowledge-bases", "grants", knowledgeBaseId] as const,
  shareTargets: (
    knowledgeBaseId: string,
    type: KnowledgeShareTarget["type"],
    search: string
  ) =>
    [
      "knowledge-bases",
      "share-targets",
      knowledgeBaseId,
      type,
      search,
    ] as const,
  content: (
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId?: string
  ) =>
    documentVersionId
      ? ([
          "knowledge-bases",
          "content",
          knowledgeBaseId,
          documentId,
          documentVersionId,
        ] as const)
      : (["knowledge-bases", "content", knowledgeBaseId, documentId] as const),
  citation: (citationId: string) =>
    ["knowledge-citations", citationId] as const,
}

export function getKnowledgeCitationPreview(
  citationId: string,
  signal?: AbortSignal
) {
  return apiRequest(`/knowledge-citations/${encodeURIComponent(citationId)}`, {
    schema: knowledgeCitationPreviewSchema,
    signal,
  })
}

export function loadKnowledgeCitationOriginal(
  citationId: string,
  signal?: AbortSignal
) {
  return downloadApiFile(
    `/knowledge-citations/${encodeURIComponent(citationId)}/original`,
    undefined,
    signal
  )
}

export function downloadKnowledgeCitationOriginal(
  citationId: string,
  signal?: AbortSignal
) {
  return downloadApiFile(
    `/knowledge-citations/${encodeURIComponent(citationId)}/download`,
    undefined,
    signal
  )
}

export function loadKnowledgeCitationAsset(
  citationId: string,
  assetReferenceId: string,
  signal?: AbortSignal
) {
  return downloadApiFile(
    `/knowledge-citations/${encodeURIComponent(citationId)}/assets/${encodeURIComponent(assetReferenceId)}`,
    undefined,
    signal
  )
}

export function loadKnowledgeTurnAsset(
  conversationId: string,
  turnId: string,
  assetReferenceId: string,
  signal?: AbortSignal
) {
  return downloadApiFile(
    `/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/knowledge-assets/${encodeURIComponent(assetReferenceId)}`,
    undefined,
    signal
  )
}

export function listKnowledgeBases(options: {
  lifecycle: KnowledgeBaseListLifecycle
  scope: KnowledgeBaseScope
  search?: string
  cursor?: string
  limit?: number
  signal?: AbortSignal
}) {
  return apiRequest("/knowledge-bases", {
    query: {
      lifecycle_status: options.lifecycle,
      scope: options.scope,
      search: options.search,
      cursor: options.cursor,
      limit: options.limit ?? 50,
    },
    schema: knowledgeBasePageSchema,
    signal: options.signal,
  })
}

export function getKnowledgeUploadLimits(signal?: AbortSignal) {
  return apiRequest("/knowledge-bases/config", {
    schema: knowledgeUploadLimitsSchema,
    signal,
  })
}

export function getKnowledgeSearchCapability(signal?: AbortSignal) {
  return apiRequest("/knowledge-bases/search-capability", {
    schema: knowledgeSearchCapabilitySchema,
    signal,
  })
}

export function getKnowledgeBaseCreationCapability(
  options: { refresh?: boolean; signal?: AbortSignal } = {}
) {
  return apiRequest("/knowledge-bases/creation-capability", {
    query: options.refresh ? { refresh: "true" } : undefined,
    schema: knowledgeBaseCreationCapabilitySchema,
    signal: options.signal,
  })
}

export function createKnowledgeBase(
  input:
    | { name: string; description?: string; source_type?: "local" }
    | {
        name: string
        description?: string
        source_type: "sharepoint"
        sharepoint_folder_url: string
        sync_schedule: KnowledgeSourceSyncSchedule
      }
) {
  return apiRequest("/knowledge-bases", {
    method: "POST",
    body: input,
    schema: knowledgeBaseSchema,
  })
}

export function getKnowledgeBase(
  knowledgeBaseId: string,
  signal?: AbortSignal
) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}`, {
    schema: knowledgeBaseSchema,
    signal,
  })
}

export function updateKnowledgeBase(
  knowledgeBaseId: string,
  input: { name: string; description?: string | null }
) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}`, {
    method: "PATCH",
    body: input,
    schema: knowledgeBaseSchema,
  })
}

export function archiveKnowledgeBase(knowledgeBaseId: string) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}/archive`, {
    method: "POST",
    schema: knowledgeBaseSchema,
  })
}

export function restoreKnowledgeBase(knowledgeBaseId: string) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}/restore`, {
    method: "POST",
    schema: knowledgeBaseSchema,
  })
}

export function deleteKnowledgeBase(knowledgeBaseId: string) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}`, {
    method: "DELETE",
    schema: emptyResponseSchema,
  })
}

export function listKnowledgeDocuments(
  knowledgeBaseId: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}
) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}/documents`, {
    query: { cursor: options.cursor, limit: options.limit ?? 100 },
    schema: knowledgeDocumentPageSchema,
    signal: options.signal,
  })
}

export function listKnowledgeBaseEntries(
  knowledgeBaseId: string,
  options: {
    parentEntryId?: string
    view?: "directory" | "flat"
    cursor?: string
    limit?: number
    signal?: AbortSignal
  } = {}
) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}/entries`, {
    query: {
      parent_entry_id: options.parentEntryId,
      view: options.view,
      cursor: options.cursor,
      limit: options.limit ?? 100,
    },
    schema: knowledgeBaseEntryPageSchema,
    signal: options.signal,
  })
}

export function getKnowledgeDocument(
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId?: string,
  signal?: AbortSignal
) {
  return apiRequest(
    `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`,
    {
      query: { document_version_id: documentVersionId },
      schema: knowledgeDocumentSchema,
      signal,
    }
  )
}

export function listKnowledgeGrants(
  knowledgeBaseId: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}
) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}/grants`, {
    query: { cursor: options.cursor, limit: options.limit ?? 30 },
    schema: knowledgeGrantPageSchema,
    signal: options.signal,
  })
}

export function listKnowledgeShareTargets(options: {
  knowledgeBaseId: string
  type: KnowledgeShareTarget["type"]
  search?: string
  signal?: AbortSignal
}) {
  return apiRequest("/knowledge-bases/share-targets", {
    query: {
      knowledge_base_id: options.knowledgeBaseId,
      type: options.type,
      search: options.search,
      limit: 100,
    },
    schema: knowledgeShareTargetPageSchema,
    signal: options.signal,
  })
}

export function createKnowledgeGrant(
  knowledgeBaseId: string,
  target: KnowledgeShareTarget
) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}/grants`, {
    method: "POST",
    body: {
      target_type: target.type === "group" ? "user_group" : "user",
      target_id: target.id,
    },
    schema: knowledgeGrantSchema,
  })
}

export function revokeKnowledgeGrant(knowledgeBaseId: string, grantId: string) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}/grants/${grantId}`, {
    method: "DELETE",
    schema: knowledgeGrantRevocationResultSchema,
  })
}

export function runKnowledgeDocumentAction(
  knowledgeBaseId: string,
  documentId: string,
  action: "retry" | "reprocess" | "rebuild" | "cancel"
) {
  return apiRequest(
    `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/${action}`,
    { method: "POST", schema: knowledgeDocumentSchema }
  )
}

export function renameKnowledgeDocument(
  knowledgeBaseId: string,
  documentId: string,
  displayName: string
) {
  return apiRequest(
    `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`,
    {
      method: "PATCH",
      body: { display_name: displayName },
      schema: knowledgeDocumentSchema,
    }
  )
}

export async function rebuildKnowledgeDocuments(
  knowledgeBaseId: string,
  documentIds?: string[]
): Promise<{ accepted: number; rejected: number }> {
  const totals = { accepted: 0, rejected: 0 }
  const rebuildPage = async (body: {
    document_ids?: string[]
    cursor?: string
  }) => {
    const result = await apiRequest(
      `/knowledge-bases/${knowledgeBaseId}/documents/rebuild`,
      {
        method: "POST",
        body,
        schema: knowledgeDocumentRebuildBatchResultSchema,
      }
    )
    for (const item of result.items) {
      totals[item.status === "accepted" ? "accepted" : "rejected"] += 1
    }
    return result.next_cursor
  }

  if (documentIds !== undefined) {
    const boundedLength = Math.max(documentIds.length, 1)
    for (
      let offset = 0;
      offset < boundedLength;
      offset += knowledgeDocumentRebuildBatchSize
    ) {
      await rebuildPage({
        document_ids: documentIds.slice(
          offset,
          offset + knowledgeDocumentRebuildBatchSize
        ),
      })
    }
    return totals
  }

  let cursor: string | undefined
  do {
    cursor =
      (await rebuildPage(cursor === undefined ? {} : { cursor })) ?? undefined
  } while (cursor !== undefined)
  return totals
}

export function deleteKnowledgeDocument(
  knowledgeBaseId: string,
  documentId: string
) {
  return apiRequest(
    `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`,
    { method: "DELETE", schema: emptyResponseSchema }
  )
}

export function getKnowledgeDocumentContent(
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId?: string,
  signal?: AbortSignal
) {
  return apiRequest(
    `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/content`,
    {
      query: { document_version_id: documentVersionId },
      schema: knowledgeDocumentContentSchema,
      signal,
    }
  )
}

export function downloadKnowledgeDocument(
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId?: string,
  signal?: AbortSignal
) {
  return downloadApiFile(
    `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/original`,
    { document_version_id: documentVersionId },
    signal
  )
}

export function loadKnowledgeDocumentPreview(
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId?: string,
  signal?: AbortSignal
) {
  return downloadApiFile(
    `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/preview`,
    { document_version_id: documentVersionId },
    signal
  )
}

export function loadKnowledgeDocumentAsset(
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId: string,
  assetReferenceId: string,
  signal?: AbortSignal
) {
  return downloadApiFile(
    `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/assets/${encodeURIComponent(assetReferenceId)}`,
    { document_version_id: documentVersionId },
    signal
  )
}

export type KnowledgeUploadConflictOptions =
  | {
      conflictResolution: "replace"
      replaceDocumentId: string
    }
  | {
      conflictResolution?: "keep_both"
      replaceDocumentId?: never
    }
  | {
      conflictResolution: "replace_path"
      replaceDocumentId?: never
    }

export type KnowledgeUploadOptions = {
  knowledgeBaseId: string
  file: File
  relativePath?: string
  parentEntryId?: string
  ocrEnabled?: boolean
  signal?: AbortSignal
  onProgress?: (percent: number) => void
} & KnowledgeUploadConflictOptions

export async function uploadKnowledgeDocument(
  options: KnowledgeUploadOptions
): Promise<KnowledgeUploadResult> {
  const accessToken = getAccessToken()
  try {
    return await uploadWithToken(options, accessToken)
  } catch (error) {
    if (!isDefinitiveAuthenticationError(error)) {
      return resolveUploadConflict(options, error)
    }
    try {
      await refreshSession(accessToken)
    } catch (refreshError) {
      if (isDefinitiveAuthenticationError(refreshError)) setAccessToken(null)
      throw refreshError
    }
    try {
      return await uploadWithToken(options, getAccessToken())
    } catch (retryError) {
      return resolveUploadConflict(options, retryError)
    }
  }
}

async function resolveUploadConflict(
  options: KnowledgeUploadOptions,
  error: unknown
): Promise<KnowledgeUploadResult> {
  if (
    error instanceof ApiError &&
    (error.errorCode === "KNOWLEDGE_DOCUMENT_DUPLICATE" ||
      error.errorCode === "KNOWLEDGE_DOCUMENT_NAME_CONFLICT")
  ) {
    const existingDocumentId = error.params?.existing_document_id
    if (typeof existingDocumentId === "string" && existingDocumentId) {
      const existingDocument = await getKnowledgeDocument(
        options.knowledgeBaseId,
        existingDocumentId
      )
      return {
        status:
          error.errorCode === "KNOWLEDGE_DOCUMENT_DUPLICATE"
            ? "duplicate"
            : "name_conflict",
        existing_document: existingDocument,
      }
    }
  }
  throw error
}

const successEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
})

const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error_code: z.string(),
  message_key: z.string().optional(),
  message: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
})

function uploadWithToken(
  options: KnowledgeUploadOptions,
  token: string | null
): Promise<KnowledgeUploadResult> {
  const buildHeaders = new Headers()
  prepareClientBuildRequest(buildHeaders)
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(
      "POST",
      buildApiUrl(`/knowledge-bases/${options.knowledgeBaseId}/documents`)
    )
    request.responseType = "json"
    request.setRequestHeader("Accept", "application/json")
    buildHeaders.forEach((value, name) => request.setRequestHeader(name, value))
    const language = document.documentElement.lang
    if (language === "zh-CN" || language === "en-US") {
      request.setRequestHeader("Accept-Language", language)
    }
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`)

    const formData = new FormData()
    if (options.conflictResolution) {
      formData.set("conflict_resolution", options.conflictResolution)
    }
    if (options.replaceDocumentId) {
      formData.set("replace_document_id", options.replaceDocumentId)
    }
    if (options.relativePath) {
      formData.set("relative_path", options.relativePath)
    }
    if (options.parentEntryId) {
      formData.set("parent_entry_id", options.parentEntryId)
    }
    formData.set("ocr_enabled", String(options.ocrEnabled ?? false))
    formData.set("file", options.file, options.file.name)

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      options.onProgress?.(
        Math.min(10, Math.round((event.loaded / event.total) * 10))
      )
    })
    request.addEventListener("load", () => {
      try {
        validateUploadResponseBuild(request)
      } catch (error) {
        reject(error)
        return
      }
      const successEnvelope = successEnvelopeSchema.safeParse(request.response)
      if (
        request.status >= 200 &&
        request.status < 300 &&
        successEnvelope.success
      ) {
        const result = knowledgeUploadResultSchema.safeParse(
          successEnvelope.data.data
        )
        if (result.success) {
          resolve(result.data)
          return
        }
        reject(
          new ApiError({
            status: request.status,
            errorCode: "API_RESPONSE_INVALID",
          })
        )
        return
      }

      const errorEnvelope = errorEnvelopeSchema.safeParse(request.response)
      reject(
        new ApiError({
          status: request.status,
          errorCode: errorEnvelope.success
            ? errorEnvelope.data.error_code
            : "API_RESPONSE_INVALID",
          message: errorEnvelope.success
            ? errorEnvelope.data.message
            : undefined,
          messageKey: errorEnvelope.success
            ? errorEnvelope.data.message_key
            : undefined,
          params: errorEnvelope.success ? errorEnvelope.data.params : undefined,
        })
      )
    })
    request.addEventListener("error", () => {
      reject(new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" }))
    })
    request.addEventListener("abort", () => {
      reject(new DOMException("Upload aborted", "AbortError"))
    })

    if (options.signal) {
      if (options.signal.aborted) {
        request.abort()
        return
      }
      options.signal.addEventListener("abort", () => request.abort(), {
        once: true,
      })
    }
    request.send(formData)
  })
}
