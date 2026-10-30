import { MessageCirclePlusIcon } from "lucide-react"
import type { HtmlPreviewSource } from "@linksense/shared"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { resourceErrorMessageSchema } from "./html-preview-resource-errors"
import {
  htmlPreviewResourceWaitMs,
  htmlPreviewRuntimeStartedMessageType,
  type HtmlPreviewResourceState,
} from "./html-preview-readiness"
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
  htmlSelectionKey,
  parseHtmlPreviewSelectionMessage,
  postHtmlPreviewAnnotationMode,
  postHtmlPreviewSelectionClear,
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
import {
  postHtmlPreviewAnnotations,
  postHtmlPreviewAnnotationFocus,
  parseHtmlPreviewAnnotationFrames,
  type HtmlAnnotationFrame,
} from "./html-preview-annotations"
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
type InteractionFrameStatus = "loading" | "preparing" | "ready" | "error"

type InteractionFrameState = Readonly<{
  source: string | null
  attempt: number
  automaticRetries: number
  status: InteractionFrameStatus
  resourceState: HtmlPreviewResourceState
}>

export type HtmlPreviewProps = Readonly<{
  document: HtmlDocumentState
  source?: HtmlPreviewSource
  renewalFailed?: boolean
  fileName: string
  selectionAction?: HtmlSelectionAction
  annotationMarkers?: readonly HtmlAnnotationMarker[]
  annotationNavigation?: OfficeAnnotationNavigationRequest | null
  toolbarActions?: ReactNode
  floatingContent?: ReactNode
  onRetry?: () => void
  onDownload?: () => void
  updateAction?: OfficePreviewUpdateAction
  onClose?: () => void
  className?: string
}>

export function HtmlPreview({
  document,
  source,
  renewalFailed = false,
  fileName,
  selectionAction,
  annotationMarkers = emptyHtmlAnnotationMarkers,
  annotationNavigation,
  floatingContent,
  toolbarActions,
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
  const handledAnnotationNavigationSequenceRef = useRef<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [resourceErrors, setResourceErrors] = useState<{
    html: string | null
    attempt: number
    resources: string[]
  }>({ html: null, attempt: 0, resources: [] })
  const [annotationState, setAnnotationState] = useState<
    Readonly<{ source: string | null; enabled: boolean }>
  >({ source: null, enabled: false })
  const [interactionFrameState, setInteractionFrameState] =
    useState<InteractionFrameState>({
      source: null,
      attempt: 0,
      automaticRetries: 0,
      status: "loading",
      resourceState: "complete",
    })
  const [mountedInteractionSource, setMountedInteractionSource] = useState<
    string | null
  >(null)
  const [selection, setSelection] = useState<HtmlSelection | null>(null)
  const [selectionAnchor, setSelectionAnchor] =
    useState<OfficeSelectionAnchor | null>(null)
  const [annotationGeometry, setAnnotationGeometry] = useState<
    Readonly<{
      source: string | null
      attempt: number
      frames: readonly HtmlAnnotationFrame[]
    }>
  >({ source: null, attempt: 0, frames: [] })

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
  const resourceState =
    interactionFrameState.source === interactionHtml
      ? interactionFrameState.resourceState
      : "complete"
  const interactionFrameMounted =
    interactionHtml !== null && mountedInteractionSource === interactionHtml
  const annotationFrames =
    interactionFrameMounted &&
    interactionFrameStatus === "ready" &&
    annotationGeometry.source === interactionHtml &&
    annotationGeometry.attempt === interactionFrameAttempt
      ? annotationGeometry.frames.filter((candidate) =>
          annotationMarkers.some(
            (marker) =>
              marker.id === candidate.id && marker.index === candidate.index
          )
        )
      : []
  const annotationMode =
    annotationState.source === interactionHtml && annotationState.enabled
  const interactionShellSource =
    interactionHtml === null
      ? null
      : buildHtmlPreviewShellSource(
          previewId,
          interactionFrameAttempt,
          source?.entry_url
        )
  const failedResources = [
    ...new Set([
      ...(source?.missing_resources ?? []),
      ...(resourceErrors.html === interactionHtml &&
      resourceErrors.attempt === interactionFrameAttempt
        ? resourceErrors.resources
        : []),
    ]),
  ]

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

  const markInteractionFrameReady = useCallback(
    (resourceState: HtmlPreviewResourceState) => {
      if (interactionHtml === null) return
      setInteractionFrameState((current) => {
        if (current.source !== interactionHtml) {
          return {
            source: interactionHtml,
            attempt: 0,
            automaticRetries: 0,
            status: "ready",
            resourceState,
          }
        }
        return current.status === "ready"
          ? current
          : { ...current, status: "ready", resourceState }
      })
    },
    [interactionHtml]
  )

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
                automaticRetries: 0,
                status: "loading" as const,
                resourceState: "complete" as const,
              }
        if (
          mode === "automatic" &&
          currentFrame.automaticRetries >= maximumInteractionFrameRetries
        ) {
          return { ...currentFrame, status: "error" }
        }
        return {
          source: interactionHtml,
          attempt: currentFrame.attempt + 1,
          automaticRetries:
            mode === "manual" ? 0 : currentFrame.automaticRetries + 1,
          status: "loading",
          resourceState: "complete",
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
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(pane)
    resizeObserver.observe(frame)
    window.addEventListener("resize", handleResize)
    scheduleInteractionFit()

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", handleResize)
    }
  }, [interactionFrameAttempt, interactionFrameMounted, scheduleInteractionFit])

  useEffect(() => {
    if (
      !interactionFrameMounted ||
      !["loading", "preparing"].includes(interactionFrameStatus)
    ) {
      return
    }
    const timeout = window.setTimeout(
      () => {
        if (interactionFrameStatus === "preparing")
          markInteractionFrameReady("timeout")
        else recoverInteractionFrame("automatic")
      },
      interactionFrameStatus === "preparing"
        ? htmlPreviewResourceWaitMs + 1_000
        : interactionFrameReadyTimeoutMs
    )
    return () => window.clearTimeout(timeout)
  }, [
    interactionFrameAttempt,
    interactionFrameMounted,
    interactionFrameStatus,
    recoverInteractionFrame,
    markInteractionFrameReady,
  ])

  useEffect(
    () => () => {
      cancelScheduledInteractionMount()
      cancelScheduledInteractionFit()
    },
    [cancelScheduledInteractionFit, cancelScheduledInteractionMount]
  )

  useEffect(() => {
    if (!interactionFrameMounted || interactionFrameStatus !== "ready") return
    const frame = interactionFrameRef.current
    if (!frame) return
    const syncAnnotationMode = () =>
      postHtmlPreviewAnnotationMode(frame, annotationMode)
    syncAnnotationMode()
    if (!annotationMode) return

    const observer = new MutationObserver(syncAnnotationMode)
    observer.observe(frame.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })
    return () => observer.disconnect()
  }, [
    annotationMode,
    interactionFrameAttempt,
    interactionFrameMounted,
    interactionFrameStatus,
  ])

  useEffect(() => {
    const frame = interactionFrameRef.current
    if (frame && interactionFrameMounted && interactionFrameStatus === "ready")
      postHtmlPreviewAnnotations(frame, annotationMarkers)
  }, [
    annotationMarkers,
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
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === htmlPreviewRuntimeStartedMessageType
      ) {
        setInteractionFrameState((current) =>
          current.source === interactionHtml
            ? current.status === "ready"
              ? current
              : { ...current, status: "preparing" }
            : {
                source: interactionHtml,
                attempt: 0,
                automaticRetries: 0,
                status: "preparing",
                resourceState: "complete",
              }
        )
        return
      }
      if (isHtmlPreviewReadyResponse(event.data)) {
        if (event.data.deferredFit) {
          recoverInteractionFrame("automatic")
        } else {
          markInteractionFrameReady(event.data.resourceState)
        }
        return
      }
      const resourceError = resourceErrorMessageSchema.safeParse(event.data)
      if (resourceError.success) {
        setResourceErrors((current) => ({
          html: interactionHtml,
          attempt: interactionFrameAttempt,
          resources: [
            ...new Set([
              ...(current.html === interactionHtml &&
              current.attempt === interactionFrameAttempt
                ? current.resources
                : []),
              resourceError.data.resource,
            ]),
          ].slice(0, 50),
        }))
        return
      }
      const frames = parseHtmlPreviewAnnotationFrames(event.data)
      if (frames !== null) {
        setAnnotationGeometry({
          source: interactionHtml,
          attempt: interactionFrameAttempt,
          frames,
        })
        return
      }
      if (!annotationMode) return
      const message = parseHtmlPreviewSelectionMessage(event.data)
      if (message === null) return
      setSelection(message.selection)
      setSelectionAnchor(htmlSelectionAnchor(frame, message.anchor))
    }

    window.addEventListener("message", handleInteractionFrameMessage)
    return () =>
      window.removeEventListener("message", handleInteractionFrameMessage)
  }, [
    annotationMode,
    interactionHtml,
    interactionFrameAttempt,
    initializeInteractionFrame,
    markInteractionFrameReady,
    previewId,
    recoverInteractionFrame,
  ])

  useEffect(() => {
    scheduleInteractionFit()
  }, [scheduleInteractionFit, zoom])

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
      notice={
        (renewalFailed ||
          failedResources.length > 0 ||
          resourceState !== "complete") && (
          <Alert className="shrink-0 rounded-none border-x-0 border-t-0">
            <AlertTitle>
              {t(
                renewalFailed
                  ? "htmlPreview.sessionExpired"
                  : resourceState === "timeout"
                    ? "htmlPreview.resourcesSlow"
                    : "htmlPreview.resourcesIncomplete"
              )}
            </AlertTitle>
            <AlertDescription>
              <p>
                {t(
                  resourceState === "timeout"
                    ? "htmlPreview.resourcesSlowHelp"
                    : "htmlPreview.resourcesHelp"
                )}
              </p>
              {failedResources.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger
                    render={<Button variant="ghost" size="sm" />}
                  >
                    {t("htmlPreview.resourceDetails")}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="max-h-24 overflow-auto">
                      {failedResources.map((resource) => (
                        <li className="break-all" key={resource}>
                          {resource}
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry ?? (() => recoverInteractionFrame("manual"))}
              >
                {t("common.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        )
      }
      controls={
        <>
          {toolbarActions}
          {selectionAction && (
            <Button
              type="button"
              variant="annotation"
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
              aria-busy={
                interactionFrameStatus === "loading" ||
                interactionFrameStatus === "preparing"
              }
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
          referrerPolicy="no-referrer"
          aria-hidden={interactionFrameStatus !== "ready"}
          tabIndex={interactionFrameStatus === "ready" ? 0 : -1}
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
          {interactionFrameStatus === "loading" ||
          interactionFrameStatus === "preparing" ? (
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
          key={htmlSelectionKey(selection)}
          scopeRef={paneRef}
          selection={selection}
          anchor={selectionAnchor}
          action={{
            ...selectionAction,
            onSubmit: async (submittedSelection, description) => {
              const frame = interactionFrameRef.current
              await selectionAction.onSubmit(submittedSelection, description)
              if (frame && frame === interactionFrameRef.current)
                postHtmlPreviewSelectionClear(frame, submittedSelection)
            },
          }}
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
