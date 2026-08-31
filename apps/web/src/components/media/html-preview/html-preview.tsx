import tailwindBrowserRuntimeUrl from "@tailwindcss/browser?url"
import { MessageCirclePlusIcon } from "lucide-react"
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import selectoBrowserRuntimeUrl from "selecto/dist/selecto.min.js?url"

import { useProductName } from "@/app/product-branding"
import {
  boundHtmlPreviewZoom,
  isHtmlPreviewReadyResponse,
  postHtmlPreviewZoom,
} from "@/components/media/html-preview/html-preview-fit"
import {
  htmlSelectionAnchor,
  parseHtmlPreviewSelectionMessage,
  postHtmlPreviewAnnotationFocus,
  postHtmlPreviewAnnotationMode,
} from "@/components/media/html-preview/html-preview-selection"
import {
  buildUnrestrictedHtmlPreviewDocument,
  decodeHtmlDocument,
} from "@/components/media/html-preview/html-preview-sanitizer"
import {
  buildHtmlPreviewShellSource,
  initializeHtmlPreviewShell,
  interactiveHtmlPreviewSandbox,
  isHtmlPreviewShellReadyMessage,
} from "@/components/media/html-preview/html-preview-shell"
import {
  HTML_MIME_TYPE,
  type HtmlAnnotationMarker,
  type HtmlDocumentState,
  type HtmlSelection,
  type HtmlSelectionAction,
} from "@/components/media/html-preview/html-preview.types"
import { OfficePreviewLoadingState } from "@/components/media/office-preview/office-preview-loading-state"
import { OfficeAnnotationNumberBubble } from "@/components/media/office-preview/office-annotation-number-bubble"
import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import { OfficePreviewZoomControls } from "@/components/media/office-preview/office-preview-zoom-controls"
import { OfficeSelectionPrompt } from "@/components/media/office-preview/office-selection-prompt"
import type {
  OfficeAnnotationNavigationRequest,
  OfficePreviewUpdateAction,
  OfficeSelectionAnchor,
} from "@/components/media/office-preview/office-preview.types"
import { Button } from "@/components/ui/button"

const minimumZoom = 0.5
const maximumZoom = 2
const zoomStep = 0.1
const interactionFrameReadyTimeoutMs = 1_500
const maximumInteractionFrameRetries = 1
const emptyHtmlAnnotationMarkers: readonly HtmlAnnotationMarker[] = []
type InteractionFrameStatus = "loading" | "ready" | "error"

type InteractionFrameState = Readonly<{
  source: string | null
  attempt: number
  status: InteractionFrameStatus
}>

type HtmlAnnotationFrame = Readonly<{
  id: string
  index: number
  left: number
  top: number
  width: number
  height: number
}>

function htmlAnnotationFramesEqual(
  current: readonly HtmlAnnotationFrame[],
  next: readonly HtmlAnnotationFrame[]
) {
  return (
    current.length === next.length &&
    current.every((frame, index) => {
      const nextFrame = next[index]
      return (
        nextFrame !== undefined &&
        frame.id === nextFrame.id &&
        frame.index === nextFrame.index &&
        frame.left === nextFrame.left &&
        frame.top === nextFrame.top &&
        frame.width === nextFrame.width &&
        frame.height === nextFrame.height
      )
    })
  )
}

export type HtmlPreviewProps = Readonly<{
  document: HtmlDocumentState
  fileName: string
  selectionAction?: HtmlSelectionAction
  annotationMarkers?: readonly HtmlAnnotationMarker[]
  annotationNavigation?: OfficeAnnotationNavigationRequest | null
  floatingContent?: ReactNode
  onRetry?: () => void
  onDownload?: () => void
  updateAction?: OfficePreviewUpdateAction
  onClose?: () => void
  className?: string
}>

export function HtmlPreview({
  document,
  fileName,
  selectionAction,
  annotationMarkers = emptyHtmlAnnotationMarkers,
  annotationNavigation,
  floatingContent,
  onRetry,
  onDownload,
  updateAction,
  onClose,
  className,
}: HtmlPreviewProps) {
  const { t } = useTranslation()
  const productName = useProductName()
  const previewId = useId()
  const paneRef = useRef<HTMLElement>(null)
  const interactionFrameRef = useRef<HTMLIFrameElement>(null)
  const interactionMountAnimationFrameRef = useRef<number | null>(null)
  const interactionFitAnimationFrameRef = useRef<number | null>(null)
  const annotationFrameAnimationFrameRef = useRef<number | null>(null)
  const handledAnnotationNavigationSequenceRef = useRef<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [annotationState, setAnnotationState] = useState<
    Readonly<{ source: string | null; enabled: boolean }>
  >({ source: null, enabled: false })
  const [interactionFrameState, setInteractionFrameState] =
    useState<InteractionFrameState>({
      source: null,
      attempt: 0,
      status: "loading",
    })
  const [mountedInteractionSource, setMountedInteractionSource] = useState<
    string | null
  >(null)
  const [selection, setSelection] = useState<HtmlSelection | null>(null)
  const [selectionAnchor, setSelectionAnchor] =
    useState<OfficeSelectionAnchor | null>(null)
  const [annotationFrames, setAnnotationFrames] = useState<
    readonly HtmlAnnotationFrame[]
  >([])

  const decodedHtml = useMemo(() => {
    if (document.status !== "ready") return null
    try {
      return decodeHtmlDocument(document.content)
    } catch {
      return null
    }
  }, [document])
  const interactionHtml = useMemo(() => {
    if (decodedHtml === null) return null
    try {
      return buildUnrestrictedHtmlPreviewDocument(
        decodedHtml,
        tailwindBrowserRuntimeUrl,
        selectoBrowserRuntimeUrl
      )
    } catch {
      return null
    }
  }, [decodedHtml])
  const previewDocument: HtmlDocumentState =
    document.status === "ready" && interactionHtml === null
      ? { status: "error" }
      : document
  const interactionFrameStatus: InteractionFrameStatus =
    interactionFrameState.source === interactionHtml
      ? interactionFrameState.status
      : "loading"
  const interactionFrameAttempt =
    interactionFrameState.source === interactionHtml
      ? interactionFrameState.attempt
      : 0
  const interactionFrameMounted =
    interactionHtml !== null && mountedInteractionSource === interactionHtml
  const annotationMode =
    annotationState.source === interactionHtml && annotationState.enabled
  const interactionShellSource =
    interactionHtml === null
      ? null
      : buildHtmlPreviewShellSource(previewId, interactionFrameAttempt)

  const updateAnnotationFrames = useCallback(() => {
    const frame = interactionFrameRef.current
    const pane = paneRef.current
    if (!frame || !pane || annotationMarkers.length === 0) {
      setAnnotationFrames((current) => (current.length === 0 ? current : []))
      return
    }

    const frameBounds = frame.getBoundingClientRect()
    const paneBounds = pane.getBoundingClientRect()
    const nextFrames = annotationMarkers.flatMap((marker) => {
      const elementBounds = marker.selection.elements
        .map((element) => element.bounds)
        .filter(
          (bounds) =>
            Number.isFinite(bounds.x) &&
            Number.isFinite(bounds.y) &&
            Number.isFinite(bounds.width) &&
            Number.isFinite(bounds.height) &&
            bounds.width > 0 &&
            bounds.height > 0
        )
      if (elementBounds.length === 0) return []
      const left = Math.min(...elementBounds.map((bounds) => bounds.x))
      const top = Math.min(...elementBounds.map((bounds) => bounds.y))
      const right = Math.max(
        ...elementBounds.map((bounds) => bounds.x + bounds.width)
      )
      const bottom = Math.max(
        ...elementBounds.map((bounds) => bounds.y + bounds.height)
      )
      return [
        {
          id: marker.id,
          index: marker.index,
          left: frameBounds.left - paneBounds.left + left,
          top: frameBounds.top - paneBounds.top + top,
          width: right - left,
          height: bottom - top,
        },
      ]
    })

    setAnnotationFrames((current) =>
      htmlAnnotationFramesEqual(current, nextFrames) ? current : nextFrames
    )
  }, [annotationMarkers])

  const scheduleAnnotationFrameUpdate = useCallback(() => {
    if (annotationFrameAnimationFrameRef.current !== null) {
      cancelAnimationFrame(annotationFrameAnimationFrameRef.current)
    }
    annotationFrameAnimationFrameRef.current = requestAnimationFrame(() => {
      annotationFrameAnimationFrameRef.current = null
      updateAnnotationFrames()
    })
  }, [updateAnnotationFrames])

  const clearSelection = useCallback(() => {
    setSelection(null)
    setSelectionAnchor(null)
  }, [])

  const cancelScheduledInteractionMount = useCallback(() => {
    if (interactionMountAnimationFrameRef.current !== null) {
      cancelAnimationFrame(interactionMountAnimationFrameRef.current)
      interactionMountAnimationFrameRef.current = null
    }
  }, [])

  const cancelScheduledInteractionFit = useCallback(() => {
    if (interactionFitAnimationFrameRef.current !== null) {
      cancelAnimationFrame(interactionFitAnimationFrameRef.current)
      interactionFitAnimationFrameRef.current = null
    }
  }, [])

  const cancelScheduledAnnotationFrameUpdate = useCallback(() => {
    if (annotationFrameAnimationFrameRef.current !== null) {
      cancelAnimationFrame(annotationFrameAnimationFrameRef.current)
      annotationFrameAnimationFrameRef.current = null
    }
  }, [])

  const scheduleInteractionFit = useCallback(() => {
    cancelScheduledInteractionFit()
    interactionFitAnimationFrameRef.current = requestAnimationFrame(() => {
      interactionFitAnimationFrameRef.current = requestAnimationFrame(() => {
        interactionFitAnimationFrameRef.current = null
        const frame = interactionFrameRef.current
        if (frame) postHtmlPreviewZoom(frame, zoom)
      })
    })
  }, [cancelScheduledInteractionFit, zoom])

  const markInteractionFrameReady = useCallback(() => {
    if (interactionHtml === null) return
    setInteractionFrameState((current) => {
      if (current.source !== interactionHtml) {
        return { source: interactionHtml, attempt: 0, status: "ready" }
      }
      return current.status === "ready"
        ? current
        : { ...current, status: "ready" }
    })
  }, [interactionHtml])

  const initializeInteractionFrame = useCallback(
    (frameWindow: Window) => {
      if (interactionHtml === null) return
      initializeHtmlPreviewShell(frameWindow, previewId, interactionHtml)
    },
    [interactionHtml, previewId]
  )

  const recoverInteractionFrame = useCallback(
    (mode: "automatic" | "manual") => {
      if (interactionHtml === null) return
      cancelScheduledInteractionFit()
      clearSelection()
      setInteractionFrameState((current) => {
        const currentFrame =
          current.source === interactionHtml
            ? current
            : {
                source: interactionHtml,
                attempt: 0,
                status: "loading" as const,
              }
        if (
          mode === "automatic" &&
          currentFrame.attempt >= maximumInteractionFrameRetries
        ) {
          return { ...currentFrame, status: "error" }
        }
        return {
          source: interactionHtml,
          attempt: mode === "manual" ? 0 : currentFrame.attempt + 1,
          status: "loading",
        }
      })
    },
    [cancelScheduledInteractionFit, clearSelection, interactionHtml]
  )

  // The lazy preview shell and the iframe otherwise mount in the same commit.
  // Give the split pane two frames to acquire a stable size before artifact
  // scripts read their initial viewport.
  useEffect(() => {
    cancelScheduledInteractionMount()
    if (interactionHtml === null) return

    interactionMountAnimationFrameRef.current = requestAnimationFrame(() => {
      interactionMountAnimationFrameRef.current = requestAnimationFrame(() => {
        interactionMountAnimationFrameRef.current = null
        setMountedInteractionSource(interactionHtml)
      })
    })

    return cancelScheduledInteractionMount
  }, [cancelScheduledInteractionMount, interactionHtml])

  useEffect(() => {
    if (!interactionFrameMounted) return
    const frame = interactionFrameRef.current
    const pane = paneRef.current
    if (!frame || !pane) return

    const handleResize = () => {
      scheduleInteractionFit()
      scheduleAnnotationFrameUpdate()
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(pane)
    resizeObserver.observe(frame)
    window.addEventListener("resize", handleResize)
    scheduleInteractionFit()
    scheduleAnnotationFrameUpdate()

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", handleResize)
    }
  }, [
    interactionFrameAttempt,
    interactionFrameMounted,
    scheduleAnnotationFrameUpdate,
    scheduleInteractionFit,
  ])

  useEffect(() => {
    if (!interactionFrameMounted || interactionFrameStatus !== "loading") {
      return
    }
    const timeout = window.setTimeout(() => {
      recoverInteractionFrame("automatic")
    }, interactionFrameReadyTimeoutMs)
    return () => window.clearTimeout(timeout)
  }, [
    interactionFrameAttempt,
    interactionFrameMounted,
    interactionFrameStatus,
    recoverInteractionFrame,
  ])

  useEffect(
    () => () => {
      cancelScheduledInteractionMount()
      cancelScheduledInteractionFit()
      cancelScheduledAnnotationFrameUpdate()
    },
    [
      cancelScheduledAnnotationFrameUpdate,
      cancelScheduledInteractionFit,
      cancelScheduledInteractionMount,
    ]
  )

  useEffect(() => {
    if (!interactionFrameMounted || interactionFrameStatus !== "ready") return
    const frame = interactionFrameRef.current
    if (!frame) return
    postHtmlPreviewAnnotationMode(frame, annotationMode)
  }, [
    annotationMode,
    interactionFrameAttempt,
    interactionFrameMounted,
    interactionFrameStatus,
  ])

  const handleInteractionFrameLoad = useCallback(() => {
    const frameWindow = interactionFrameRef.current?.contentWindow
    if (frameWindow) initializeInteractionFrame(frameWindow)
    scheduleInteractionFit()
  }, [initializeInteractionFrame, scheduleInteractionFit])

  const handleInteractionFrameError = useCallback(() => {
    recoverInteractionFrame("automatic")
  }, [recoverInteractionFrame])

  const toggleAnnotationMode = useCallback(() => {
    if (interactionFrameStatus !== "ready") return
    clearSelection()
    setAnnotationState({ source: interactionHtml, enabled: !annotationMode })
  }, [annotationMode, clearSelection, interactionFrameStatus, interactionHtml])

  useEffect(() => {
    const handleInteractionFrameMessage = (event: MessageEvent<unknown>) => {
      const frame = interactionFrameRef.current
      const frameWindow = frame?.contentWindow
      if (!frame || !frameWindow || event.source !== frameWindow) return
      if (isHtmlPreviewShellReadyMessage(event.data, previewId)) {
        initializeInteractionFrame(frameWindow)
        return
      }
      if (isHtmlPreviewReadyResponse(event.data)) {
        if (event.data.deferredFit) {
          recoverInteractionFrame("automatic")
        } else {
          markInteractionFrameReady()
        }
        return
      }
      if (!annotationMode) return
      const message = parseHtmlPreviewSelectionMessage(event.data)
      if (message === null) return
      const pane = paneRef.current
      if (!pane) return
      setSelection(message.selection)
      setSelectionAnchor(htmlSelectionAnchor(pane, frame, message.anchor))
    }

    window.addEventListener("message", handleInteractionFrameMessage)
    return () =>
      window.removeEventListener("message", handleInteractionFrameMessage)
  }, [
    annotationMode,
    initializeInteractionFrame,
    markInteractionFrameReady,
    previewId,
    recoverInteractionFrame,
  ])

  useEffect(() => {
    scheduleInteractionFit()
    scheduleAnnotationFrameUpdate()
  }, [scheduleAnnotationFrameUpdate, scheduleInteractionFit, zoom])

  useEffect(() => {
    if (
      !annotationNavigation ||
      handledAnnotationNavigationSequenceRef.current ===
        annotationNavigation.sequence ||
      !interactionFrameMounted ||
      interactionFrameStatus !== "ready"
    ) {
      return
    }
    const marker = annotationMarkers.find(
      (candidate) => candidate.id === annotationNavigation.id
    )
    const frame = interactionFrameRef.current
    if (!marker || !frame) return
    handledAnnotationNavigationSequenceRef.current =
      annotationNavigation.sequence
    postHtmlPreviewAnnotationFocus(frame, marker.selection)
  }, [
    annotationMarkers,
    annotationNavigation,
    interactionFrameMounted,
    interactionFrameStatus,
  ])

  const selectionKey = selection
    ? selection.elements
        .map((element) => `${element.selector}:${element.domPath.join(".")}`)
        .join("\u0000")
    : null

  return (
    <OfficePreviewShell
      ref={paneRef}
      document={previewDocument}
      fileName={fileName}
      mimeType={HTML_MIME_TYPE}
      className={className}
      bodyClassName="html-preview-body"
      onRetry={onRetry}
      onDownload={onDownload}
      updateAction={updateAction}
      onClose={onClose}
      floatingContent={floatingContent}
      controls={
        <>
          {selectionAction && (
            <Button
              type="button"
              variant={annotationMode ? "secondary" : "ghost"}
              size="xs"
              className="html-preview-annotation-toggle"
              aria-label={t(
                annotationMode
                  ? "htmlPreview.exitAnnotationMode"
                  : "htmlPreview.enterAnnotationMode"
              )}
              aria-pressed={annotationMode}
              onClick={toggleAnnotationMode}
              disabled={interactionFrameStatus !== "ready"}
              aria-busy={interactionFrameStatus === "loading"}
            >
              <MessageCirclePlusIcon
                data-icon="inline-start"
                aria-hidden="true"
              />
              <span className="html-preview-annotation-toggle-label">
                {t(
                  annotationMode
                    ? "htmlPreview.annotating"
                    : "htmlPreview.annotate"
                )}
              </span>
            </Button>
          )}
          <OfficePreviewZoomControls
            zoomPercent={Math.round(zoom * 100)}
            zoomOutLabel={t("htmlPreview.zoomOut")}
            zoomInLabel={t("htmlPreview.zoomIn")}
            resetZoomLabel={t("htmlPreview.resetZoom")}
            canZoomOut={zoom > minimumZoom}
            canZoomIn={zoom < maximumZoom}
            onZoomOut={() =>
              setZoom((current) => boundHtmlPreviewZoom(current - zoomStep))
            }
            onZoomIn={() =>
              setZoom((current) => boundHtmlPreviewZoom(current + zoomStep))
            }
            onResetZoom={() => setZoom(1)}
          />
        </>
      }
    >
      {interactionFrameMounted && interactionHtml && (
        <iframe
          key={`${interactionHtml}:${interactionFrameAttempt}`}
          ref={interactionFrameRef}
          className="html-preview-frame"
          data-testid="html-preview-interaction-frame"
          data-html-preview-attempt={interactionFrameAttempt}
          title={t("htmlPreview.frameTitle", { name: fileName })}
          sandbox={interactiveHtmlPreviewSandbox}
          aria-hidden="false"
          src={interactionShellSource ?? undefined}
          onLoad={handleInteractionFrameLoad}
          onError={handleInteractionFrameError}
        />
      )}
      {annotationFrames.length > 0 && (
        <div
          className="office-annotation-overlay html-preview-annotation-overlay"
          data-testid="html-preview-annotation-overlay"
          aria-hidden="true"
        >
          {annotationFrames.map((frame) => (
            <span
              key={frame.id}
              className="office-annotation-frame html-preview-annotation-frame"
              data-html-annotation-frame={frame.id}
              style={{
                left: frame.left,
                top: frame.top,
                width: frame.width,
                height: frame.height,
              }}
            >
              <OfficeAnnotationNumberBubble
                index={frame.index}
                className="html-preview-annotation-index"
              />
            </span>
          ))}
        </div>
      )}
      {interactionHtml && interactionFrameStatus !== "ready" && (
        <div className="html-preview-frame-state">
          {interactionFrameStatus === "loading" ? (
            <OfficePreviewLoadingState label={t("officePreview.loading")} />
          ) : (
            <div className="office-preview-state" role="alert">
              <p>{t("officePreview.loadFailed")}</p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => recoverInteractionFrame("manual")}
              >
                {t("common.retry")}
              </Button>
            </div>
          )}
        </div>
      )}
      {annotationMode && selection && selectionAction && (
        <OfficeSelectionPrompt
          key={selectionKey}
          scopeRef={paneRef}
          selection={selection}
          anchor={selectionAnchor}
          action={selectionAction}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {annotationMode && selection
          ? t("htmlPreview.selectionStatus", {
              count: selection.elements.length,
            })
          : t(
              annotationMode
                ? "htmlPreview.annotationModeStatus"
                : "htmlPreview.interactionModeStatus",
              { productName }
            )}
      </span>
    </OfficePreviewShell>
  )
}

export default HtmlPreview
