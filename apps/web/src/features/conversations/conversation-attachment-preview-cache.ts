import type { ConversationFile } from "@/api/contracts"
import { isPreviewableImageMimeType } from "@/features/conversations/conversation-attachment-preview-utils"

export type ConversationAttachmentPreviewState =
  | Readonly<{ status: "ready"; objectUrl: string }>
  | Readonly<{ status: "error" }>

export type ConversationAttachmentPreviewResource = {
  cacheKey: string
  resource: CachedPreviewResource
}

type CachedPreviewResource = {
  cacheKey: string
  controller: AbortController
  promise: Promise<ConversationAttachmentPreviewState>
  retainCount: number
  disposeTimer: number | undefined
  state?: ConversationAttachmentPreviewState
}

const PREVIEW_RESOURCE_HANDOFF_MS = 2_000
const previewResourceCache = new Map<string, CachedPreviewResource>()

function previewCacheKey(file: ConversationFile) {
  return file.id
}

function disposeCachedResource(resource: CachedPreviewResource) {
  resource.controller.abort()
  if (resource.state?.status === "ready") {
    URL.revokeObjectURL(resource.state.objectUrl)
  }
}

function clearCachedResourceTimer(resource: CachedPreviewResource) {
  if (resource.disposeTimer === undefined) return
  window.clearTimeout(resource.disposeTimer)
  resource.disposeTimer = undefined
}

export function getConversationAttachmentPreviewCacheKey(
  file: ConversationFile
) {
  return previewCacheKey(file)
}

export function retainConversationAttachmentPreviewResource(
  file: ConversationFile,
  loadPreview: (file: ConversationFile, signal: AbortSignal) => Promise<Blob>
): ConversationAttachmentPreviewResource {
  const cacheKey = previewCacheKey(file)
  const existing = previewResourceCache.get(cacheKey)
  if (existing) {
    clearCachedResourceTimer(existing)
    existing.retainCount += 1
    return { cacheKey, resource: existing }
  }

  const controller = new AbortController()
  const resource: CachedPreviewResource = {
    cacheKey,
    controller,
    disposeTimer: undefined,
    retainCount: 1,
    promise: Promise.resolve({ status: "error" }),
  }
  resource.promise = loadPreview(file, controller.signal)
    .then((blob) => {
      if (controller.signal.aborted) {
        return { status: "error" } satisfies ConversationAttachmentPreviewState
      }
      if (!isPreviewableImageMimeType(blob.type)) {
        throw new Error("preview_blob_type_invalid")
      }

      const objectUrl = URL.createObjectURL(blob)
      if (controller.signal.aborted) {
        URL.revokeObjectURL(objectUrl)
        return { status: "error" } satisfies ConversationAttachmentPreviewState
      }

      const state = {
        status: "ready",
        objectUrl,
      } satisfies ConversationAttachmentPreviewState
      resource.state = state
      return state
    })
    .catch(() => {
      const state = {
        status: "error",
      } satisfies ConversationAttachmentPreviewState
      resource.state = state
      return state
    })

  previewResourceCache.set(cacheKey, resource)
  return { cacheKey, resource }
}

export function releaseConversationAttachmentPreviewResource(
  retained: ConversationAttachmentPreviewResource
) {
  const { resource } = retained
  resource.retainCount = Math.max(0, resource.retainCount - 1)
  if (resource.retainCount > 0) return

  clearCachedResourceTimer(resource)
  resource.disposeTimer = window.setTimeout(() => {
    if (resource.retainCount > 0) return
    previewResourceCache.delete(resource.cacheKey)
    disposeCachedResource(resource)
  }, PREVIEW_RESOURCE_HANDOFF_MS)
}

export function peekConversationAttachmentPreviewState(file: ConversationFile) {
  return previewResourceCache.get(previewCacheKey(file))?.state
}

export function clearConversationAttachmentPreviewCacheForTests() {
  for (const resource of previewResourceCache.values()) {
    clearCachedResourceTimer(resource)
    disposeCachedResource(resource)
  }
  previewResourceCache.clear()
}
