import type { TFunction } from "i18next"
import type { Locale } from "@linksense/shared"

import type {
  KnowledgeBase,
  KnowledgeDocument,
} from "@/features/knowledge-bases/knowledge-base-contracts"

export const knowledgeUploadAccept = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".doc",
  ".xls",
  ".ppt",
  ".vsdx",
  ".odt",
  ".ods",
  ".odp",
  ".txt",
  ".md",
  ".html",
  ".htm",
  ".csv",
  ".png",
  ".jpg",
  ".jpeg",
  ".tif",
  ".tiff",
  ".bmp",
  ".webp",
].join(",")

const supportedExtensions = new Set(
  knowledgeUploadAccept.split(",").map((extension) => extension.slice(1))
)

const supportedImageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "tif",
  "tiff",
  "bmp",
  "webp",
])

export function isKnowledgeUploadImageFile(file: Pick<File, "name">) {
  const extension =
    file.name.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? ""
  return supportedImageExtensions.has(extension)
}

export function validateKnowledgeUploadFile(
  file: File,
  t: TFunction,
  limits: { maxFileSizeBytes: number; maxFileSizeLabel: string }
) {
  const extension =
    file.name.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? ""
  if (!supportedExtensions.has(extension)) {
    return t("knowledge.upload.errors.unsupportedFormat")
  }
  if (file.size === 0) return t("knowledge.upload.errors.emptyFile")
  if (file.size > limits.maxFileSizeBytes) {
    return t("knowledge.upload.errors.fileTooLarge", {
      maxFileSize: limits.maxFileSizeLabel,
    })
  }
  return null
}

export function formatKnowledgeBytes(bytes: number, locale: Locale) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KiB", "MiB", "GiB", "TiB"]
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value)} ${unit}`
}

export function getKnowledgeBaseAccessLabel(
  knowledgeBase: KnowledgeBase,
  t: TFunction
) {
  if (knowledgeBase.is_owner) return t("knowledge.access.owner")
  const direct = knowledgeBase.access_sources.some(
    (source) => source.type === "direct"
  )
  const groups = knowledgeBase.access_sources.filter(
    (source) => source.type === "user_group"
  )
  if (direct && groups.length > 0) {
    return t("knowledge.access.multiple", { count: groups.length + 1 })
  }
  if (direct) return t("knowledge.access.direct")
  if (groups.length === 1) {
    return t("knowledge.access.group", {
      name: groups[0]?.name ?? t("knowledge.access.unknownGroup"),
    })
  }
  if (groups.length > 1) {
    return t("knowledge.access.multiple", { count: groups.length })
  }
  return t("knowledge.access.shared")
}

export function getKnowledgeBaseSourceTypeLabel(
  knowledgeBase: Pick<KnowledgeBase, "source_type">,
  t: TFunction
) {
  if (knowledgeBase.source_type === "sharepoint") {
    return t("knowledge.sourceType.sharepoint")
  }
  return t("knowledge.sourceType.local")
}

export function isKnowledgeBaseAvailableForTurn(knowledgeBase: KnowledgeBase) {
  return (
    knowledgeBase.lifecycle_status === "active" &&
    knowledgeBase.availability_status === "enabled" &&
    knowledgeBase.permissions.view_content
  )
}

export function getKnowledgeDocumentStatusLabel(
  document: KnowledgeDocument,
  t: TFunction
) {
  if (document.rebuild_required) return t("knowledge.document.rebuildRequired")
  return t(`knowledge.document.status.${document.status}`)
}

export function getKnowledgeStageLabel(stage: string, t: TFunction) {
  const normalized = stage.toLocaleLowerCase("en-US")
  const knownStages = new Set([
    "queued",
    "uploading",
    "validating",
    "parsing",
    "chunking",
    "image_understanding",
    "parenting",
    "embedding",
    "indexing",
    "activating",
  ])
  return knownStages.has(normalized)
    ? t(`knowledge.document.stage.${normalized}`)
    : t("knowledge.document.stage.processing")
}

export function isKnowledgeStageIndeterminate(stage: string) {
  const normalized = stage.toLocaleLowerCase("en-US")
  return normalized === "parsing" || normalized === "chunking"
}

export function getKnowledgeStableErrorLabel(errorCode: string, t: TFunction) {
  const key = stableErrorTranslationKey(errorCode)
  return t(`knowledge.document.failure.${key}`)
}

function stableErrorTranslationKey(errorCode: string) {
  if (errorCode === "KNOWLEDGE_PROCESSING_CANCELLED") return "cancelled"
  if (errorCode === "KNOWLEDGE_DOCUMENT_ENCRYPTED") return "encrypted"
  if (errorCode === "KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED") {
    return "unsupportedFormat"
  }
  if (errorCode === "KNOWLEDGE_OFFICE_CONVERSION_FAILED") {
    return "officeConversionFailed"
  }
  if (errorCode === "KNOWLEDGE_DOCUMENT_TOO_LARGE") return "tooLarge"
  if (errorCode === "KNOWLEDGE_STORAGE_QUOTA_EXCEEDED") {
    return "storageQuota"
  }
  if (
    errorCode === "KNOWLEDGE_DOCUMENT_INVALID" ||
    errorCode === "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID" ||
    errorCode === "KNOWLEDGE_DOCUMENT_COVERAGE_INVALID" ||
    errorCode === "KNOWLEDGE_IMAGE_POSITION_INVALID"
  ) {
    return "structureInvalid"
  }
  if (errorCode === "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED") {
    return "imageConfigurationChanged"
  }
  if (errorCode === "KNOWLEDGE_IMAGE_MODEL_NOT_FOUND") {
    return "imageModelNotFound"
  }
  if (errorCode === "KNOWLEDGE_IMAGE_MODEL_OUTPUT_INVALID") {
    return "imageOutputInvalid"
  }
  if (errorCode === "KNOWLEDGE_IMAGE_MODEL_THINKING_NOT_DISABLED") {
    return "imageThinkingNotDisabled"
  }
  if (
    errorCode === "KNOWLEDGE_DOCLING_RESULT_INVALID" ||
    errorCode === "KNOWLEDGE_DOCLING_CONTRACT_INCOMPATIBLE" ||
    errorCode === "KNOWLEDGE_EXTERNAL_RESPONSE_INVALID"
  ) {
    return "parsingServiceFailed"
  }
  if (errorCode === "KNOWLEDGE_DOCLING_TASK_NOT_FOUND") {
    return "parsingTaskExpired"
  }
  if (errorCode === "KNOWLEDGE_DOCLING_RESULT_UNSAFE") {
    return "parsingInvalid"
  }
  if (
    errorCode === "EMBEDDING_DIMENSION_MISMATCH" ||
    errorCode === "EMBEDDING_INPUT_TOO_LARGE" ||
    errorCode === "KNOWLEDGE_EMBEDDING_RESPONSE_INVALID" ||
    errorCode === "KNOWLEDGE_ELASTICSEARCH_CONTRACT_INCOMPATIBLE"
  ) {
    return "configuration"
  }
  if (errorCode === "KNOWLEDGE_EXTERNAL_SERVICE_AUTHENTICATION_FAILED") {
    return "serviceAuthentication"
  }
  if (
    errorCode === "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE" ||
    errorCode === "KNOWLEDGE_PROCESSING_UNAVAILABLE" ||
    errorCode === "KNOWLEDGE_DOCLING_UNAVAILABLE" ||
    errorCode === "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE" ||
    errorCode === "KNOWLEDGE_EMBEDDING_UNAVAILABLE" ||
    errorCode === "KNOWLEDGE_ELASTICSEARCH_UNAVAILABLE" ||
    errorCode === "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE" ||
    errorCode === "KNOWLEDGE_OFFICE_CONVERTER_UNAVAILABLE" ||
    errorCode === "KNOWLEDGE_IMAGE_MODEL_UNAVAILABLE"
  ) {
    return "serviceUnavailable"
  }
  if (errorCode === "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED") {
    return "indexingFailed"
  }
  if (errorCode === "KNOWLEDGE_DOCUMENT_BUSY") return "busy"
  return "unknown"
}

export function isOriginalPreviewUnsupported(document: KnowledgeDocument) {
  return !document.preview.original_supported
}

export function canCancelKnowledgeDocument(document: KnowledgeDocument) {
  return (
    document.status === "processing" &&
    Boolean(document.processing?.cancellable) &&
    (document.processing?.progress_percent ?? 100) < 98
  )
}
