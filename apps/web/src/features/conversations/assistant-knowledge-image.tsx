import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react"
import { ImageIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { AssistantInlineImagePlaceholder } from "@/features/conversations/assistant-inline-image-placeholder"
import {
  loadKnowledgeCitationAsset,
  loadKnowledgeTurnAsset,
} from "@/features/knowledge-bases/knowledge-base-api"
import { cn } from "@/lib/utils"

type KnowledgeImageState =
  | Readonly<{
      status: "loading"
      requestKey: string
      assetReferenceId: string
    }>
  | Readonly<{
      status: "ready"
      requestKey: string
      assetReferenceId: string
      url: string
    }>
  | Readonly<{
      status: "error"
      requestKey: string
      assetReferenceId: string
    }>

const missingCitationGracePeriodMs = 5_000

export type LoadConversationKnowledgeAsset = (input: {
  conversationId: string
  turnId: string
  assetReferenceId: string
  signal: AbortSignal
}) => Promise<Blob>

const ConversationKnowledgeAssetContext =
  createContext<LoadConversationKnowledgeAsset | null>(null)

export function ConversationKnowledgeAssetProvider({
  load,
  children,
}: {
  load: LoadConversationKnowledgeAsset
  children: ReactNode
}) {
  return (
    <ConversationKnowledgeAssetContext.Provider value={load}>
      {children}
    </ConversationKnowledgeAssetContext.Provider>
  )
}

export function AssistantKnowledgeImage({
  assetReferenceId,
  citationIds,
  conversationId,
  turnId,
  alt,
  title,
  className,
  previewTriggerClassName,
  placeholderClassName,
  authorizationPending = false,
  onPreview,
  ...imageProps
}: Omit<ComponentPropsWithoutRef<"img">, "src"> & {
  assetReferenceId: string
  citationIds: readonly string[]
  conversationId?: string
  turnId?: string
  previewTriggerClassName?: string
  placeholderClassName?: string
  authorizationPending?: boolean
  onPreview?: (url: string) => void
}) {
  const { t } = useTranslation()
  const scopedAssetLoader = useContext(ConversationKnowledgeAssetContext)
  const [reloadKey, setReloadKey] = useState(0)
  const hasTurnAuthorization = Boolean(conversationId && turnId)
  // Citations arrive only after the message is persisted. Once turn-scoped
  // authorization is available they must not create a second image request.
  const requestKey = JSON.stringify(
    hasTurnAuthorization
      ? [assetReferenceId, "turn", conversationId, turnId, reloadKey]
      : [assetReferenceId, "citations", citationIds, reloadKey]
  )
  const activeObjectUrl = useRef<string | null>(null)
  const successfulRequestKey = useRef<string | null>(null)
  const [state, setState] = useState<KnowledgeImageState>({
    status: "loading",
    requestKey,
    assetReferenceId,
  })
  const name = alt?.trim() || t("conversation.inlineImage")

  useEffect(() => {
    const controller = new AbortController()
    let missingCitationTimer: number | undefined

    if (successfulRequestKey.current === requestKey) {
      return () => controller.abort()
    }

    if (citationIds.length === 0 && !hasTurnAuthorization) {
      if (!authorizationPending) {
        missingCitationTimer = window.setTimeout(() => {
          if (!controller.signal.aborted) {
            setState({ status: "error", requestKey, assetReferenceId })
          }
        }, missingCitationGracePeriodMs)
      }

      return () => {
        controller.abort()
        if (missingCitationTimer !== undefined) {
          window.clearTimeout(missingCitationTimer)
        }
      }
    }

    void loadFirstAuthorizedAsset({
      citationIds,
      assetReferenceId,
      conversationId,
      turnId,
      scopedAssetLoader,
      signal: controller.signal,
    })
      .then((blob) => {
        if (controller.signal.aborted) return
        const objectUrl = URL.createObjectURL(blob)
        const previousObjectUrl = activeObjectUrl.current
        activeObjectUrl.current = objectUrl
        successfulRequestKey.current = requestKey
        setState({
          status: "ready",
          requestKey,
          assetReferenceId,
          url: objectUrl,
        })
        if (previousObjectUrl !== null && previousObjectUrl !== objectUrl) {
          URL.revokeObjectURL(previousObjectUrl)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && !authorizationPending) {
          setState({ status: "error", requestKey, assetReferenceId })
        }
      })

    return () => {
      controller.abort()
      if (missingCitationTimer !== undefined) {
        window.clearTimeout(missingCitationTimer)
      }
    }
  }, [
    assetReferenceId,
    authorizationPending,
    citationIds,
    conversationId,
    hasTurnAuthorization,
    requestKey,
    scopedAssetLoader,
    turnId,
  ])

  useEffect(
    () => () => {
      if (activeObjectUrl.current !== null) {
        URL.revokeObjectURL(activeObjectUrl.current)
        activeObjectUrl.current = null
      }
    },
    []
  )

  const current =
    state.requestKey === requestKey ||
    (state.status === "ready" && state.assetReferenceId === assetReferenceId)
      ? state
      : null
  if (current?.status === "ready") {
    const image = (
      <img
        {...imageProps}
        className={className}
        src={current.url}
        alt={alt ?? ""}
        width={imageProps.width ?? 800}
        height={imageProps.height ?? 450}
        title={title}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          successfulRequestKey.current = null
          setState({ status: "error", requestKey, assetReferenceId })
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
        onClick={() => onPreview(current.url)}
      >
        {image}
      </Button>
    )
  }

  if (current?.status !== "error") {
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
      <Button
        className="assistant-inline-image-retry"
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setReloadKey((currentKey) => currentKey + 1)}
      >
        {t("common.retry")}
      </Button>
    </span>
  )
}

async function loadFirstAuthorizedAsset(input: {
  citationIds: readonly string[]
  assetReferenceId: string
  conversationId?: string
  turnId?: string
  scopedAssetLoader: LoadConversationKnowledgeAsset | null
  signal: AbortSignal
}): Promise<Blob> {
  const {
    citationIds,
    assetReferenceId,
    conversationId,
    turnId,
    scopedAssetLoader,
    signal,
  } = input
  if (conversationId && turnId && scopedAssetLoader) {
    return scopedAssetLoader({
      conversationId,
      turnId,
      assetReferenceId,
      signal,
    })
  }
  for (const citationId of citationIds) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    try {
      return await loadKnowledgeCitationAsset(
        citationId,
        assetReferenceId,
        signal
      )
    } catch (error) {
      if (signal.aborted) throw error
    }
  }
  if (conversationId && turnId) {
    return loadKnowledgeTurnAsset(
      conversationId,
      turnId,
      assetReferenceId,
      signal
    )
  }
  throw new Error("knowledge_asset_not_authorized")
}
