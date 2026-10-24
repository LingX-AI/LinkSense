import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react"
import { ImageIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationFile } from "@/api/contracts"
import { Button } from "@/components/ui/button"
import { AssistantInlineImagePlaceholder } from "@/features/conversations/assistant-inline-image-placeholder"
import { isPreviewableConversationImage } from "@/features/conversations/conversation-attachment-preview-utils"
import type { ArtifactPreviewSource } from "@/features/conversations/conversation-artifact-files"
import { getInlineArtifactId } from "@/features/conversations/assistant-markdown-image-utils"
import { cn } from "@/lib/utils"

export type LoadArtifactPreview = (
  file: ConversationFile,
  signal: AbortSignal
) => Promise<ArtifactPreviewSource>

type PreviewState =
  | Readonly<{
      status: "ready"
      requestKey: string
      loader: LoadArtifactPreview
      source: ArtifactPreviewSource
    }>
  | Readonly<{
      status: "error"
      requestKey: string
      loader: LoadArtifactPreview
    }>

type PreviewRequest = {
  promise: Promise<ArtifactPreviewSource>
  source?: ArtifactPreviewSource
  decoded?: boolean
  expiresAt?: number
  evictionTimer?: number
}

const PREVIEW_REFRESH_SAFETY_MS = 30_000

const previewRequests = new WeakMap<
  LoadArtifactPreview,
  Map<string, PreviewRequest>
>()

export function AssistantMarkdownImage({
  source,
  alt,
  title,
  file,
  loadPreview,
  onPreview,
  previewTriggerClassName,
  surfaceClassName,
  placeholderClassName,
  loadingPlaceholder,
  errorPlaceholder,
  className,
  onError,
  ...imageProps
}: Omit<ComponentPropsWithoutRef<"img">, "src"> & {
  source?: string
  file?: ConversationFile
  loadPreview?: LoadArtifactPreview
  onPreview?: (source: ArtifactPreviewSource) => void
  previewTriggerClassName?: string
  surfaceClassName?: string
  placeholderClassName?: string
  loadingPlaceholder?: ReactNode
  errorPlaceholder?: ReactNode
}) {
  const { t } = useTranslation()
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<PreviewState | null>(null)
  const [decoded, setDecoded] = useState<{
    fileKey: string
    loader: LoadArtifactPreview
    source: ArtifactPreviewSource
  } | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const fileRef = useRef(file)
  const artifactId = getInlineArtifactId(source)
  const name = alt?.trim() || file?.name || t("conversation.inlineImage")
  const canLoad =
    Boolean(artifactId) &&
    Boolean(file?.download_available) &&
    Boolean(file && isPreviewableConversationImage(file)) &&
    Boolean(loadPreview)
  const fileKey =
    canLoad && file
      ? `${file.id}:${file.mime_type}:${file.checksum_sha256 ?? ""}:${file.size ?? ""}`
      : null
  const requestKey = fileKey ? `${fileKey}:${reloadKey}` : null
  const cached =
    fileKey && loadPreview
      ? getFreshPreviewRequest(loadPreview, fileKey)
      : undefined
  const currentState =
    state?.requestKey === requestKey && state.loader === loadPreview
      ? state
      : cached?.source && requestKey && loadPreview
        ? {
            status: "ready" as const,
            requestKey,
            loader: loadPreview,
            source: cached.source,
          }
        : null
  const previewSource =
    currentState?.status === "ready" ? currentState.source : null
  // Expiry governs obtaining a new URL. An already decoded image remains
  // visible during renewal; a rejected request clears it through the error path.
  const retainedSource =
    decoded?.fileKey === fileKey && decoded.loader === loadPreview
      ? decoded.source
      : null
  const imageReady = Boolean(
    previewSource &&
    ((cached?.decoded && cached.source?.url === previewSource.url) ||
      retainedSource?.url === previewSource.url)
  )
  const displayedSource = imageReady ? previewSource : retainedSource

  useEffect(() => {
    fileRef.current = file
  }, [file])

  useEffect(() => {
    const requestFile = fileRef.current
    if (!requestKey || !fileKey || !requestFile || !loadPreview) return

    const controller = new AbortController()
    let refreshTimer: number | undefined
    void loadCachedPreview(loadPreview, requestFile, fileKey)
      .then((sourceValue) => {
        if (controller.signal.aborted) return
        if (!sourceValue.url.trim() || !sourceValue.expiresAt.trim())
          throw new Error("inline_image_preview_invalid")
        const expiresAt = Date.parse(sourceValue.expiresAt)
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          throw new Error("inline_image_preview_expired")
        }
        setState({
          status: "ready",
          requestKey,
          loader: loadPreview,
          source: sourceValue,
        })
        const refreshDelay = Math.max(
          1_000,
          expiresAt - Date.now() - PREVIEW_REFRESH_SAFETY_MS
        )
        if (refreshDelay <= 2_147_483_647) {
          refreshTimer = window.setTimeout(
            () => setReloadKey((current) => current + 1),
            refreshDelay
          )
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDecoded(null)
          setState({ status: "error", requestKey, loader: loadPreview })
        }
      })

    return () => {
      controller.abort()
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    }
  }, [fileKey, loadPreview, requestKey])

  useEffect(() => {
    const image = imageRef.current
    if (
      !image ||
      !previewSource ||
      !requestKey ||
      !fileKey ||
      !loadPreview ||
      (retainedSource?.url === previewSource.url &&
        retainedSource.expiresAt === previewSource.expiresAt)
    )
      return

    let active = true
    let decodedAfterLoad = false
    // Decode the mounted image so native lazy loading still controls when its
    // bytes are fetched. The placeholder remains in the same grid cell.
    const decodeImage = () => {
      void image.decode().then(
        () => {
          if (!active) return
          const request = getFreshPreviewRequest(loadPreview, fileKey)
          if (request?.source?.url === previewSource.url) request.decoded = true
          setDecoded({ fileKey, loader: loadPreview, source: previewSource })
        },
        () => {
          if (!active) return
          // A lazy request can reject decode before the browser selects its source.
          if (!image.complete && !decodedAfterLoad) {
            image.addEventListener("load", decodeLoadedImage, { once: true })
            return
          }
          invalidatePreviewRequest(loadPreview, fileKey)
          setDecoded(null)
          setState({ status: "error", requestKey, loader: loadPreview })
        }
      )
    }
    const decodeLoadedImage = () => {
      decodedAfterLoad = true
      decodeImage()
    }
    decodeImage()
    return () => {
      active = false
      image.removeEventListener("load", decodeLoadedImage)
    }
  }, [fileKey, loadPreview, previewSource, requestKey, retainedSource])

  const placeholder = loadingPlaceholder ?? (
    <AssistantInlineImagePlaceholder
      className={placeholderClassName}
      label={t("conversation.previewLoading", { name })}
    />
  )
  let content: ReactNode
  const candidateSource = previewSource ?? displayedSource
  if (
    candidateSource &&
    currentState?.status !== "error" &&
    canLoad &&
    loadPreview
  ) {
    const renderImage = (
      imageSource: ArtifactPreviewSource,
      candidate: boolean
    ) => (
      <img
        {...imageProps}
        key={imageSource.url}
        ref={candidate ? imageRef : undefined}
        className={cn(
          "col-start-1 row-start-1",
          className,
          imageSource.url !== displayedSource?.url && "opacity-0"
        )}
        src={imageSource.url}
        alt={alt ?? ""}
        width={imageProps.width ?? 800}
        height={imageProps.height ?? 450}
        title={title}
        loading={imageProps.loading ?? "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        aria-hidden={imageSource.url !== displayedSource?.url || undefined}
        onError={(event) => {
          onError?.(event)
          if (requestKey && fileKey) {
            invalidatePreviewRequest(loadPreview, fileKey)
            setDecoded(null)
            setState({ status: "error", requestKey, loader: loadPreview })
          }
        }}
      />
    )
    // Keys retain the displayed DOM node while its replacement downloads and
    // decodes. A signed-URL renewal must not turn an existing image into a skeleton.
    const images = [
      ...(displayedSource && displayedSource.url !== candidateSource.url
        ? [renderImage(displayedSource, false)]
        : []),
      renderImage(candidateSource, true),
    ]

    content = (
      <>
        {onPreview ? (
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "assistant-inline-image-preview-trigger col-start-1 row-start-1 grid min-h-0 min-w-0 grid-cols-1 grid-rows-1",
              previewTriggerClassName
            )}
            aria-label={t("conversation.previewImage", { name })}
            aria-hidden={!displayedSource || undefined}
            disabled={!displayedSource}
            onClick={() => {
              if (displayedSource) onPreview(displayedSource)
            }}
          >
            {images}
          </Button>
        ) : (
          images
        )}
        {!displayedSource && (
          <span className="col-start-1 row-start-1 size-full">
            {placeholder}
          </span>
        )}
      </>
    )
  } else if (!currentState && canLoad) {
    content = placeholder
  } else if (errorPlaceholder !== undefined) {
    content = errorPlaceholder
  } else {
    content = (
      <span
        className="assistant-inline-image-state assistant-inline-image-error"
        role="img"
        aria-label={t("conversation.previewLoadFailed", { name })}
      >
        <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="assistant-inline-image-state-text">
          <span className="assistant-inline-image-state-title">
            {t("conversation.previewLoadFailed", { name })}
          </span>
        </span>
        {canLoad && (
          <Button
            className="assistant-inline-image-retry"
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            {t("common.retry")}
          </Button>
        )}
      </span>
    )
  }

  return (
    <span
      data-slot="assistant-image-surface"
      className={cn(
        "relative inline-grid min-h-0 max-w-full min-w-0 grid-cols-1 grid-rows-1 align-middle",
        surfaceClassName
      )}
    >
      {content}
    </span>
  )
}

function getFreshPreviewRequest(
  loader: LoadArtifactPreview,
  requestKey: string
): PreviewRequest | undefined {
  const request = previewRequests.get(loader)?.get(requestKey)
  return request?.expiresAt !== undefined &&
    request.expiresAt - PREVIEW_REFRESH_SAFETY_MS > Date.now()
    ? request
    : undefined
}

function invalidatePreviewRequest(
  loader: LoadArtifactPreview,
  requestKey: string
): void {
  const requests = previewRequests.get(loader)
  const request = requests?.get(requestKey)
  if (requests && request) deletePreviewRequest(requests, requestKey, request)
}

function loadCachedPreview(
  loadPreview: LoadArtifactPreview,
  file: ConversationFile,
  requestKey: string
): Promise<ArtifactPreviewSource> {
  let requests = previewRequests.get(loadPreview)
  if (!requests) {
    requests = new Map()
    previewRequests.set(loadPreview, requests)
  }
  const existing = requests.get(requestKey)
  if (
    existing &&
    (existing.expiresAt === undefined ||
      existing.expiresAt - PREVIEW_REFRESH_SAFETY_MS > Date.now())
  ) {
    return existing.promise
  }
  if (existing) deletePreviewRequest(requests, requestKey, existing)

  for (const [key, entry] of requests) {
    if (key.startsWith(`${file.id}:`)) {
      deletePreviewRequest(requests, key, entry)
    }
  }

  const entry: PreviewRequest = {
    promise: loadPreview(file, new AbortController().signal),
  }
  requests.set(requestKey, entry)
  void entry.promise.then(
    (sourceValue) => {
      if (requests?.get(requestKey) !== entry) return
      const expiresAt = Date.parse(sourceValue.expiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        deletePreviewRequest(requests, requestKey, entry)
        return
      }
      entry.expiresAt = expiresAt
      entry.source = sourceValue
      schedulePreviewRequestEviction(requests, requestKey, entry)
    },
    () => {
      if (requests?.get(requestKey) === entry) {
        deletePreviewRequest(requests, requestKey, entry)
      }
    }
  )
  return entry.promise
}

function schedulePreviewRequestEviction(
  requests: Map<string, PreviewRequest>,
  requestKey: string,
  entry: PreviewRequest
) {
  if (entry.evictionTimer !== undefined) {
    window.clearTimeout(entry.evictionTimer)
  }
  const expiresAt = entry.expiresAt
  if (expiresAt === undefined) return
  const delay = Math.max(
    0,
    Math.min(expiresAt - PREVIEW_REFRESH_SAFETY_MS - Date.now(), 2_147_483_647)
  )
  entry.evictionTimer = window.setTimeout(() => {
    if (requests.get(requestKey) !== entry) return
    if (
      entry.expiresAt !== undefined &&
      entry.expiresAt - PREVIEW_REFRESH_SAFETY_MS > Date.now()
    ) {
      schedulePreviewRequestEviction(requests, requestKey, entry)
      return
    }
    deletePreviewRequest(requests, requestKey, entry)
  }, delay)
}

function deletePreviewRequest(
  requests: Map<string, PreviewRequest>,
  requestKey: string,
  entry: PreviewRequest
) {
  if (entry.evictionTimer !== undefined) {
    window.clearTimeout(entry.evictionTimer)
  }
  if (requests.get(requestKey) === entry) requests.delete(requestKey)
}
