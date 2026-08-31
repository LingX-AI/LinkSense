import type { ConversationFile } from "@/api/contracts"

const PREVIEWABLE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
])

const PREVIEWABLE_ARTIFACT_IMAGE_TYPES = new Set(["image/svg+xml"])
const OBJECT_URL_PREVIEW_EXPIRY = "9999-12-31T23:59:59.999Z"

function normalizeMimeType(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ""
}

export function isPreviewableImageMimeType(value: string | null | undefined) {
  return PREVIEWABLE_IMAGE_TYPES.has(normalizeMimeType(value))
}

export function isPreviewableConversationImage(file: ConversationFile) {
  const mimeType = normalizeMimeType(file.mime_type)
  return (
    PREVIEWABLE_IMAGE_TYPES.has(mimeType) ||
    (file.kind === "artifact" && PREVIEWABLE_ARTIFACT_IMAGE_TYPES.has(mimeType))
  )
}

export function createConversationAttachmentPreviewSource(blob: Blob) {
  const url = URL.createObjectURL(blob)
  let released = false
  return {
    url,
    expiresAt: OBJECT_URL_PREVIEW_EXPIRY,
    release: () => {
      if (released) return
      released = true
      URL.revokeObjectURL(url)
    },
  }
}
