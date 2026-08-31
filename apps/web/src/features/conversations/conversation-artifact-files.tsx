import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { DownloadIcon, ImageIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationFile } from "@/api/contracts"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import {
  ImagePreviewDialog,
  type ImagePreviewItem,
} from "@/components/media/image-preview"
import { Button } from "@/components/ui/button"
import { isPreviewableConversationImage } from "@/features/conversations/conversation-attachment-preview-utils"
import {
  getConversationFilePreviewKind,
  getConversationFilePreviewLabelKey,
} from "@/features/conversations/conversation-file-preview"
import { normalizeLanguage } from "@/i18n"
import { formatFileSize } from "@/i18n/date"

export type ArtifactPreviewSource = Readonly<{
  url: string
  expiresAt: string
}>

export type ConversationArtifactFilesProps = Readonly<{
  files: readonly ConversationFile[]
  loadPreview?: (
    file: ConversationFile,
    signal: AbortSignal
  ) => Promise<ArtifactPreviewSource>
  onDownload?: (file: ConversationFile) => void | Promise<void>
  onPreviewOfficeDocument?: (file: ConversationFile) => void
  /** @deprecated Use onPreviewOfficeDocument. */
  onPreviewPresentation?: (file: ConversationFile) => void
  downloadingFileId?: string
  renderFallback: (file: ConversationFile) => ReactNode
}>

type PreviewState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; source: ArtifactPreviewSource }>
  | Readonly<{ status: "error" }>

type PreviewResource = {
  controller: AbortController
  fileKey: string
  loading: boolean
  promise: Promise<ArtifactPreviewSource | null>
}

function getPreviewFileKey(file: ConversationFile) {
  return JSON.stringify([file.id, file.mime_type, file.download_available])
}

function isExpired(source: ArtifactPreviewSource, now = Date.now()) {
  const expiresAt = Date.parse(source.expiresAt)
  return !Number.isFinite(expiresAt) || expiresAt <= now
}

function isValidSource(source: ArtifactPreviewSource) {
  return source.url.trim().length > 0 && source.expiresAt.trim().length > 0
}

export function ConversationArtifactFiles({
  files,
  loadPreview,
  onDownload,
  onPreviewOfficeDocument,
  onPreviewPresentation,
  downloadingFileId,
  renderFallback,
}: ConversationArtifactFilesProps) {
  const { t, i18n } = useTranslation()
  const openOfficeDocument = onPreviewOfficeDocument ?? onPreviewPresentation
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [activeId, setActiveId] = useState<string | null>(null)
  const [previewStates, setPreviewStates] = useState(
    () => new Map<string, PreviewState>()
  )
  const previewStatesRef = useRef(previewStates)
  const loadPreviewRef = useRef(loadPreview)
  const resourcesRef = useRef(new Map<string, PreviewResource>())
  const previewFilesRef = useRef<readonly ConversationFile[]>([])

  const previewFiles = useMemo(
    () =>
      loadPreview
        ? files.filter(
            (file) =>
              file.download_available && isPreviewableConversationImage(file)
          )
        : [],
    [files, loadPreview]
  )
  const previewFilesById = useMemo(
    () => new Map(previewFiles.map((file) => [file.id, file])),
    [previewFiles]
  )
  const previewSignature = JSON.stringify(
    previewFiles.map((file) => getPreviewFileKey(file))
  )

  useEffect(() => {
    loadPreviewRef.current = loadPreview
  }, [loadPreview])

  useEffect(() => {
    previewStatesRef.current = previewStates
  }, [previewStates])

  useEffect(() => {
    previewFilesRef.current = previewFiles
  }, [previewFiles])

  const loadFilePreview = useCallback(
    (
      file: ConversationFile,
      { preserveReady = false }: { preserveReady?: boolean } = {}
    ) => {
      const fileKey = getPreviewFileKey(file)
      const currentResource = resourcesRef.current.get(file.id)
      if (currentResource?.loading && currentResource.fileKey === fileKey) {
        return currentResource.promise
      }

      currentResource?.controller.abort()
      const loader = loadPreviewRef.current
      if (!loader) return Promise.resolve(null)

      const controller = new AbortController()
      if (!preserveReady) {
        setPreviewStates((current) => {
          const next = new Map(current)
          next.set(file.id, { status: "loading" })
          return next
        })
      }

      const promise = Promise.resolve()
        .then(() => loader(file, controller.signal))
        .then((source) => {
          const resource = resourcesRef.current.get(file.id)
          if (
            controller.signal.aborted ||
            resource?.controller !== controller
          ) {
            return null
          }
          if (!isValidSource(source)) throw new Error("preview_source_invalid")

          setPreviewStates((current) => {
            const next = new Map(current)
            next.set(file.id, { status: "ready", source })
            return next
          })
          return source
        })
        .catch(() => {
          const resource = resourcesRef.current.get(file.id)
          if (
            controller.signal.aborted ||
            resource?.controller !== controller
          ) {
            return null
          }
          setPreviewStates((current) => {
            const next = new Map(current)
            next.set(file.id, { status: "error" })
            return next
          })
          return null
        })
        .finally(() => {
          const resource = resourcesRef.current.get(file.id)
          if (resource?.controller === controller) resource.loading = false
        })

      resourcesRef.current.set(file.id, {
        controller,
        fileKey,
        loading: true,
        promise,
      })
      return promise
    },
    []
  )

  useEffect(() => {
    const currentFiles = previewFilesRef.current
    const currentKeys = new Map(
      currentFiles.map((file) => [file.id, getPreviewFileKey(file)])
    )
    const invalidatedIds = new Set<string>()

    for (const [id, resource] of resourcesRef.current) {
      if (currentKeys.get(id) !== resource.fileKey) {
        resource.controller.abort()
        resourcesRef.current.delete(id)
        invalidatedIds.add(id)
      }
    }

    setPreviewStates((current) => {
      let changed = false
      const next = new Map<string, PreviewState>()
      for (const [id, state] of current) {
        if (currentKeys.has(id) && !invalidatedIds.has(id)) next.set(id, state)
        else changed = true
      }
      return changed ? next : current
    })

    setActiveId((current) =>
      current && currentKeys.has(current) ? current : null
    )

    for (const file of currentFiles) {
      if (!resourcesRef.current.has(file.id)) void loadFilePreview(file)
    }
  }, [loadFilePreview, previewSignature])

  useEffect(
    () => () => {
      for (const resource of resourcesRef.current.values()) {
        resource.controller.abort()
      }
      resourcesRef.current.clear()
    },
    []
  )

  const items = useMemo(
    () =>
      previewFiles.flatMap<ImagePreviewItem>((file) => {
        const state = previewStates.get(file.id)
        if (state?.status !== "ready") return []
        return [
          {
            id: file.id,
            name: file.name,
            src: state.source.url,
            alt: file.name,
            downloadable: Boolean(onDownload),
          },
        ]
      }),
    [onDownload, previewFiles, previewStates]
  )

  const openPreview = (id: string) => {
    const file = previewFilesById.get(id)
    if (!file) return
    const state = previewStatesRef.current.get(id)
    if (state?.status !== "ready") return
    if (!isExpired(state.source)) {
      setActiveId(id)
      return
    }

    void loadFilePreview(file, { preserveReady: true }).then((source) => {
      if (source) setActiveId(id)
    })
  }

  const changeActiveId = (id: string | null) => {
    if (id === null) setActiveId(null)
    else openPreview(id)
  }

  const downloadItem = (item: ImagePreviewItem) => {
    const file = previewFilesById.get(item.id)
    if (file) return onDownload?.(file)
  }

  return (
    <>
      {files.map((file) => {
        const previewKind = getConversationFilePreviewKind(file)
        if (
          file.download_available &&
          openOfficeDocument &&
          previewKind !== null &&
          previewKind !== "image"
        ) {
          const downloading = downloadingFileId === file.id
          return (
            <div
              key={file.id}
              className="artifact-office-document-tile artifact-presentation-tile artifact-tile file-tile"
            >
              <Button
                type="button"
                variant="ghost"
                className="artifact-office-document-open-button artifact-presentation-open-button"
                aria-label={t(getConversationFilePreviewLabelKey(file), {
                  name: file.name,
                })}
                onClick={() => openOfficeDocument(file)}
              >
                <span className="file-icon">
                  <FileTypeIcon
                    filename={file.name}
                    mimeType={file.mime_type}
                  />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="file-tile-name block truncate font-medium">
                    {file.name}
                  </span>
                  <span className="file-tile-meta block pt-0.5 text-[var(--app-muted)]">
                    <span className="artifact-office-document-size artifact-presentation-size">
                      {formatFileSize(file.size, language)}
                    </span>
                    <span
                      className="artifact-office-document-preview-label artifact-presentation-preview-label"
                      aria-hidden="true"
                    >
                      {t("conversation.openPreview")}
                    </span>
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="artifact-image-download-button text-[var(--app-muted)]"
                aria-label={t("conversation.downloadArtifact", {
                  name: file.name,
                })}
                aria-busy={downloading || undefined}
                disabled={!onDownload || downloading}
                onClick={() => void onDownload?.(file)}
              >
                {downloading ? (
                  <LoaderCircleIcon
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <DownloadIcon aria-hidden="true" />
                )}
              </Button>
            </div>
          )
        }

        const previewFile = previewFilesById.get(file.id)
        if (!previewFile) {
          return <Fragment key={file.id}>{renderFallback(file)}</Fragment>
        }

        const state = previewStates.get(file.id)
        if (state?.status === "error") {
          return <Fragment key={file.id}>{renderFallback(file)}</Fragment>
        }

        const item = items.find((candidate) => candidate.id === file.id)
        const statusText = t("conversation.previewLoading", {
          name: file.name,
        })
        const downloading = downloadingFileId === file.id
        const previewImage = () => {
          if (!item) {
            return
          }

          if (openOfficeDocument) {
            openOfficeDocument(file)
            return
          }

          openPreview(file.id)
        }

        return (
          <div
            key={file.id}
            className="artifact-image-tile artifact-tile file-tile"
          >
            {item ? (
              <Button
                type="button"
                variant="ghost"
                className="artifact-image-open-button"
                aria-label={t("conversation.previewImage", {
                  name: file.name,
                })}
                onClick={previewImage}
              >
                <span className="image-preview-thumbnail" aria-hidden="true">
                  <span className="image-preview-thumbnail-trigger">
                    <img
                      src={item.src}
                      alt=""
                      width="60"
                      height="60"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  </span>
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="file-tile-name block truncate font-medium">
                    {file.name}
                  </span>
                  <span className="file-tile-meta block pt-0.5 text-[var(--app-muted)]">
                    {formatFileSize(file.size, language)}
                  </span>
                </span>
              </Button>
            ) : (
              <>
                <div className="image-preview-thumbnail">
                  <div
                    className="image-preview-thumbnail-trigger image-preview-thumbnail-state"
                    role="status"
                    aria-label={statusText}
                    aria-live="polite"
                  >
                    {state?.status === "loading" || !state ? (
                      <LoaderCircleIcon
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ImageIcon aria-hidden="true" />
                    )}
                    <span className="sr-only">{statusText}</span>
                  </div>
                </div>
                <span className="min-w-0 flex-1 text-left">
                  <span className="file-tile-name block truncate font-medium">
                    {file.name}
                  </span>
                  <span className="file-tile-meta block pt-0.5 text-[var(--app-muted)]">
                    {formatFileSize(file.size, language)}
                  </span>
                </span>
              </>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="artifact-image-download-button text-[var(--app-muted)]"
              aria-label={t("conversation.downloadArtifact", {
                name: file.name,
              })}
              aria-busy={downloading || undefined}
              disabled={!onDownload || downloading}
              onClick={() => void onDownload?.(file)}
            >
              {downloading ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
              ) : (
                <DownloadIcon aria-hidden="true" />
              )}
            </Button>
          </div>
        )
      })}

      {!openOfficeDocument && (
        <ImagePreviewDialog
          items={items}
          activeId={activeId}
          onActiveIdChange={changeActiveId}
          onDownload={onDownload ? downloadItem : undefined}
          downloadingId={downloadingFileId}
        />
      )}
    </>
  )
}
