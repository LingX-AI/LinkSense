import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ImageIcon, LoaderCircleIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationFile } from "@/api/contracts"
import {
  ImagePreviewDialog,
  ImageThumbnail,
  type ImagePreviewItem,
} from "@/components/media/image-preview"
import { Button } from "@/components/ui/button"
import { ImageVisibilityTarget } from "@/components/media/image-visibility-target"
import {
  getConversationAttachmentPreviewCacheKey,
  peekConversationAttachmentPreviewState,
  releaseConversationAttachmentPreviewResource,
  retainConversationAttachmentPreviewResource,
  type ConversationAttachmentPreviewResource,
  type ConversationAttachmentPreviewState,
} from "@/features/conversations/conversation-attachment-preview-cache"
import { isPreviewableConversationImage } from "@/features/conversations/conversation-attachment-preview-utils"

export function ConversationAttachmentPreviews({
  files,
  loadPreview,
  onRemove,
  onPreviewImage,
  onPreviewFile,
  disabled = false,
}: {
  files: readonly ConversationFile[]
  loadPreview: (file: ConversationFile, signal: AbortSignal) => Promise<Blob>
  onRemove?: (file: ConversationFile) => void
  onPreviewImage?: (item: ImagePreviewItem) => void
  onPreviewFile?: (file: ConversationFile) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [visibleFileIds, setVisibleFileIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const markVisible = useCallback((id: string) => {
    setVisibleFileIds((current) =>
      current.has(id) ? current : new Set([...current, id])
    )
  }, [])
  const [previewStates, setPreviewStates] = useState(
    () => new Map<string, ConversationAttachmentPreviewState>()
  )
  const resourcesRef = useRef(
    new Map<string, ConversationAttachmentPreviewResource>()
  )
  const loadPreviewRef = useRef(loadPreview)
  const previewFilesRef = useRef<readonly ConversationFile[]>([])
  const requestedPreviewIdRef = useRef<string | null>(null)

  const previewFiles = useMemo(
    () => files.filter(isPreviewableConversationImage),
    [files]
  )
  const previewSignature = JSON.stringify(
    previewFiles.map((file) => [file.id, file.mime_type])
  )

  useEffect(() => {
    loadPreviewRef.current = loadPreview
  }, [loadPreview])

  useEffect(() => {
    previewFilesRef.current = previewFiles
  }, [previewFiles])

  const loadFilePreview = useCallback((file: ConversationFile) => {
    const existing = resourcesRef.current.get(file.id)
    if (existing) return existing.resource.promise

    const retained = retainConversationAttachmentPreviewResource(
      file,
      (previewFile, signal) => loadPreviewRef.current(previewFile, signal)
    )
    resourcesRef.current.set(file.id, retained)
    const updateState = (state: ConversationAttachmentPreviewState) => {
      if (resourcesRef.current.get(file.id)?.resource !== retained.resource)
        return
      setPreviewStates((current) => {
        const next = new Map(current)
        next.set(file.id, state)
        return next
      })
    }
    if (retained.resource.state) updateState(retained.resource.state)
    else void retained.resource.promise.then(updateState)
    return retained.resource.promise
  }, [])

  useEffect(() => {
    const currentFiles = previewFilesRef.current
    const currentResources = new Map(
      currentFiles.map(
        (file) =>
          [file.id, getConversationAttachmentPreviewCacheKey(file)] as const
      )
    )

    for (const [id, resource] of resourcesRef.current) {
      const currentCacheKey = currentResources.get(id)
      if (!currentCacheKey || currentCacheKey !== resource.cacheKey) {
        releaseConversationAttachmentPreviewResource(resource)
        resourcesRef.current.delete(id)
      }
    }

    setPreviewStates((current) => {
      let changed = false
      const next = new Map<string, ConversationAttachmentPreviewState>()
      for (const [id, state] of current) {
        if (currentResources.has(id)) next.set(id, state)
        else changed = true
      }
      return changed ? next : current
    })

    setActiveId((current) =>
      current && currentResources.has(current) ? current : null
    )

    for (const file of currentFiles) {
      if (visibleFileIds.has(file.id)) void loadFilePreview(file)
    }
  }, [loadFilePreview, previewSignature, visibleFileIds])

  useEffect(
    () => () => {
      requestedPreviewIdRef.current = null
      for (const resource of resourcesRef.current.values()) {
        releaseConversationAttachmentPreviewResource(resource)
      }
      resourcesRef.current.clear()
    },
    []
  )

  const displayPreviewStates = useMemo(() => {
    const next = new Map(previewStates)
    for (const file of previewFiles) {
      if (!next.has(file.id)) {
        const cachedState = peekConversationAttachmentPreviewState(file)
        if (cachedState) next.set(file.id, cachedState)
      }
    }
    return next
  }, [previewFiles, previewStates])

  const items = useMemo(
    () =>
      previewFiles.flatMap<ImagePreviewItem>((file) => {
        const state = displayPreviewStates.get(file.id)
        if (state?.status !== "ready") return []
        return [
          {
            id: file.id,
            name: file.name,
            src: state.objectUrl,
            alt: file.name,
            downloadable: true,
          },
        ]
      }),
    [displayPreviewStates, previewFiles]
  )

  const openPreview = (id: string | null) => {
    requestedPreviewIdRef.current = id
    if (id === null) {
      setActiveId(null)
      return
    }
    const file = previewFiles.find((candidate) => candidate.id === id)
    if (!file) return
    const preview = loadFilePreview(file)
    if (displayPreviewStates.get(id)?.status === "ready") {
      setActiveId(id)
      return
    }
    void preview.then((state) => {
      if (state.status === "ready" && requestedPreviewIdRef.current === id) {
        setActiveId(id)
      }
    })
  }

  const removeFile = (id: string) => {
    const file = previewFiles.find((candidate) => candidate.id === id)
    if (file) onRemove?.(file)
  }

  const downloadItem = (item: ImagePreviewItem) => {
    const anchor = document.createElement("a")
    anchor.href = item.src
    anchor.rel = "noopener"
    anchor.download = item.name
    anchor.hidden = true
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }

  if (previewFiles.length === 0) return null

  return (
    <>
      {previewFiles.map((file) => (
        <ImageVisibilityTarget
          key={file.id}
          id={file.id}
          onVisible={markVisible}
        >
          {(ref) => {
            const state =
              previewStates.get(file.id) ??
              (visibleFileIds.has(file.id)
                ? displayPreviewStates.get(file.id)
                : undefined)
            if (state?.status === "ready") {
              const item = items.find((candidate) => candidate.id === file.id)
              if (!item) return null
              return (
                <ImageThumbnail
                  ref={ref}
                  key={file.id}
                  item={item}
                  onPreview={
                    onPreviewImage
                      ? () => onPreviewImage(item)
                      : onPreviewFile
                        ? () => onPreviewFile(file)
                        : openPreview
                  }
                  onRemove={onRemove ? removeFile : undefined}
                  removeDisabled={disabled}
                />
              )
            }

            const statusText = t(
              state?.status === "error"
                ? "conversation.previewLoadFailed"
                : "conversation.previewLoading",
              { name: file.name }
            )

            return (
              <div ref={ref} className="image-preview-thumbnail">
                <div
                  className="image-preview-thumbnail-trigger image-preview-thumbnail-state"
                  role="status"
                  aria-label={statusText}
                  aria-live="polite"
                >
                  {state?.status === "error" ? (
                    <ImageIcon aria-hidden="true" />
                  ) : (
                    <LoaderCircleIcon
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  <span className="sr-only">{statusText}</span>
                </div>
                {onRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="image-preview-thumbnail-remove"
                    aria-label={t("conversation.removeAttachment", {
                      name: file.name,
                    })}
                    disabled={disabled}
                    onClick={() => onRemove(file)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                )}
              </div>
            )
          }}
        </ImageVisibilityTarget>
      ))}

      {!onPreviewImage && !onPreviewFile && (
        <ImagePreviewDialog
          items={items}
          navigationIds={previewFiles
            .filter(
              (file) => displayPreviewStates.get(file.id)?.status !== "error"
            )
            .map((file) => file.id)}
          activeId={activeId}
          onActiveIdChange={openPreview}
          onDownload={downloadItem}
        />
      )}
    </>
  )
}
