import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
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
      source: ArtifactPreviewSource
    }>
  | Readonly<{ status: "error"; requestKey: string }>

type PreviewRequest = {
  promise: Promise<ArtifactPreviewSource>
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
  placeholderClassName,
  className,
  ...imageProps
}: Omit<ComponentPropsWithoutRef<"img">, "src"> & {
  source?: string
  file?: ConversationFile
  loadPreview?: LoadArtifactPreview
  onPreview?: (source: ArtifactPreviewSource) => void
  previewTriggerClassName?: string
  placeholderClassName?: string
}) {
  const { t } = useTranslation()
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<PreviewState | null>(null)
  const fileRef = useRef(file)
  const artifactId = getInlineArtifactId(source)
  const name = alt?.trim() || file?.name || t("conversation.inlineImage")
  const canLoad =
    Boolean(artifactId) &&
    Boolean(file?.download_available) &&
    Boolean(file && isPreviewableConversationImage(file)) &&
    Boolean(loadPreview)
  const requestKey =
    canLoad && file ? `${file.id}:${file.mime_type}:${reloadKey}` : null

  useEffect(() => {
    fileRef.current = file
  }, [file])

  useEffect(() => {
    const requestFile = fileRef.current
    if (!requestKey || !requestFile || !loadPreview) return

    const controller = new AbortController()
    let refreshTimer: number | undefined
    void loadCachedPreview(loadPreview, requestFile, requestKey)
      .then((sourceValue) => {
        if (
          controller.signal.aborted ||
          !sourceValue.url.trim() ||
          !sourceValue.expiresAt.trim()
        ) {
          return
        }
        const expiresAt = Date.parse(sourceValue.expiresAt)
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          throw new Error("inline_image_preview_expired")
        }
        setState({ status: "ready", requestKey, source: sourceValue })
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
          setState({ status: "error", requestKey })
        }
      })

    return () => {
      controller.abort()
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    }
  }, [loadPreview, requestKey])

  const currentState = state?.requestKey === requestKey ? state : null
  if (currentState?.status === "ready" && canLoad) {
    const image = (
      <img
        {...imageProps}
        className={className}
        src={currentState.source.url}
        alt={alt ?? ""}
        width={imageProps.width ?? 800}
        height={imageProps.height ?? 450}
        title={title}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          if (requestKey) setState({ status: "error", requestKey })
        }}
      />
    )

    if (!onPreview) return image

    return (
      <Button
        type="button"
        variant="ghost"
        className={cn(
          "assistant-inline-image-preview-trigger",
          previewTriggerClassName
        )}
        aria-label={t("conversation.previewImage", { name })}
        onClick={() => onPreview(currentState.source)}
      >
        {image}
      </Button>
    )
  }

  if (!currentState && canLoad) {
    return (
      <AssistantInlineImagePlaceholder
        className={placeholderClassName}
        label={t("conversation.previewLoading", { name })}
      />
    )
  }

  return (
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
