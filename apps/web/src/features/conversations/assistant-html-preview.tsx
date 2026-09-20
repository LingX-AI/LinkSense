import {
  AssistantPreviewAction,
  AssistantPreviewActions,
} from "@/features/conversations/assistant-preview-actions"
import {
  DownloadIcon,
  ImageIcon,
  Maximize2Icon,
  Minimize2Icon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { productFilenamePrefix, useProductName } from "@/app/product-branding"
import { notify } from "@/components/feedback/notification"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  buildHtmlPreviewShellSource,
  initializeHtmlPreviewShell,
  interactiveHtmlPreviewSandbox,
} from "@/components/media/html-preview/html-preview-shell"
import {
  assistantHtmlPreviewCaptureErrorMessageType,
  assistantHtmlPreviewCaptureRequestMessageType,
  assistantHtmlPreviewCaptureSnapshotMessageType,
  assistantHtmlPreviewErrorMessageType,
  assistantHtmlPreviewResizeMessageType,
  assistantHtmlPreviewWheelMessageType,
  buildAssistantHtmlPreviewDocument,
  isAssistantHtmlPreviewFrameMessage,
  isAssistantHtmlPreviewShellReadyMessage,
  type AssistantHtmlPreviewCaptureSnapshot,
} from "@/features/conversations/assistant-html-preview-document"
import { renderAssistantHtmlPreviewSnapshot } from "@/features/conversations/assistant-html-preview-capture"
import { AssistantHtmlPreviewLoading } from "@/features/conversations/assistant-html-preview-loading"
import { downloadBlob } from "@/lib/download-blob"
import { cn } from "@/lib/utils"

const defaultAssistantHtmlPreviewHeight = 360
const assistantHtmlPreviewCaptureTimeout = 15_000
type FrameStatus = "loading" | "ready" | "error"

type FrameState = Readonly<{
  source: string | null
  attempt: number
  status: FrameStatus
  height: number
}>

type PendingCaptureRequest = Readonly<{
  resolve: (snapshot: AssistantHtmlPreviewCaptureSnapshot) => void
  reject: (error: Error) => void
  timeout: number
}>

export type AssistantHtmlPreviewProps = Readonly<{
  html: string
}>

export function AssistantHtmlPreviewPending() {
  const { t } = useTranslation()

  return (
    <section
      className="my-3 w-full max-w-full"
      aria-label={t("conversation.inlineHtmlPreview.cardLabel")}
    >
      <AssistantHtmlPreviewLoading
        label={t("conversation.inlineHtmlPreview.generating")}
      />
    </section>
  )
}

export function AssistantHtmlPreview({ html }: AssistantHtmlPreviewProps) {
  const { t } = useTranslation()
  const productName = useProductName()
  const previewId = useId()
  const previewCardRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const captureSequenceRef = useRef(0)
  const pendingCaptureRequestsRef = useRef(
    new Map<string, PendingCaptureRequest>()
  )
  const [isCapturingImage, setIsCapturingImage] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const documentSource = useMemo(() => {
    try {
      return buildAssistantHtmlPreviewDocument(html, {
        previewId,
      })
    } catch {
      return null
    }
  }, [html, previewId])
  const [frameState, setFrameState] = useState<FrameState>(() => ({
    source: documentSource,
    attempt: 0,
    status: documentSource === null ? "error" : "loading",
    height: defaultAssistantHtmlPreviewHeight,
  }))
  const activeFrameState: FrameState =
    frameState.source === documentSource
      ? frameState
      : {
          source: documentSource,
          attempt: 0,
          status: documentSource === null ? "error" : "loading",
          height: defaultAssistantHtmlPreviewHeight,
        }

  const initializePreviewFrame = useCallback(
    (frameWindow: Window) => {
      if (documentSource === null) return
      initializeHtmlPreviewShell(frameWindow, previewId, documentSource)
    },
    [documentSource, previewId]
  )

  useEffect(() => {
    if (documentSource === null) return
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = event.data
      const frameWindow = frameRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow) {
        return
      }
      if (isAssistantHtmlPreviewShellReadyMessage(message, previewId)) {
        initializePreviewFrame(frameWindow)
        return
      }
      if (!isAssistantHtmlPreviewFrameMessage(message, previewId)) return
      if (
        message.type === assistantHtmlPreviewCaptureSnapshotMessageType ||
        message.type === assistantHtmlPreviewCaptureErrorMessageType
      ) {
        const pendingRequest = pendingCaptureRequestsRef.current.get(
          message.requestId
        )
        if (!pendingRequest) return
        window.clearTimeout(pendingRequest.timeout)
        pendingCaptureRequestsRef.current.delete(message.requestId)
        if (message.type === assistantHtmlPreviewCaptureSnapshotMessageType) {
          pendingRequest.resolve({
            html: message.html,
            viewportWidth: message.viewportWidth,
            width: message.width,
            height: message.height,
          })
        } else {
          pendingRequest.reject(new Error("Unable to capture HTML preview"))
        }
        return
      }
      if (message.type === assistantHtmlPreviewWheelMessageType) {
        const previewCard = previewCardRef.current
        const scrollContainer =
          document.fullscreenElement === previewCard
            ? previewCard
            : frameRef.current?.closest<HTMLElement>(".conversation-scroll")
        if (!scrollContainer) return
        scrollContainer.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            deltaX: message.deltaX,
            deltaY: message.deltaY,
          })
        )
        scrollContainer.scrollLeft += message.deltaX
        scrollContainer.scrollTop += message.deltaY
        return
      }
      if (message.type === assistantHtmlPreviewResizeMessageType) {
        setFrameState((current) => ({
          source: documentSource,
          attempt: current.source === documentSource ? current.attempt : 0,
          status:
            current.source === documentSource ? current.status : "loading",
          height: message.height,
        }))
        return
      }
      const status: FrameStatus =
        message.type === assistantHtmlPreviewErrorMessageType
          ? "error"
          : "ready"
      setFrameState((current) => {
        return {
          source: documentSource,
          attempt: current.source === documentSource ? current.attempt : 0,
          status,
          height:
            current.source === documentSource
              ? current.height
              : defaultAssistantHtmlPreviewHeight,
        }
      })
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [documentSource, initializePreviewFrame, previewId])

  useEffect(() => {
    const pendingRequests = pendingCaptureRequestsRef.current
    return () => {
      for (const request of pendingRequests.values()) {
        window.clearTimeout(request.timeout)
        request.reject(new Error("HTML preview was replaced"))
      }
      pendingRequests.clear()
    }
  }, [documentSource])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === previewCardRef.current)
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
  }, [])

  useEffect(() => {
    if (documentSource === null || activeFrameState.status !== "loading") {
      return
    }
    const timer = window.setTimeout(() => {
      setFrameState((current) => {
        const status =
          current.source === documentSource ? current.status : "loading"
        return status === "loading"
          ? {
              source: documentSource,
              attempt: current.source === documentSource ? current.attempt : 0,
              status: "error",
              height:
                current.source === documentSource
                  ? current.height
                  : defaultAssistantHtmlPreviewHeight,
            }
          : current
      })
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [activeFrameState.status, activeFrameState.attempt, documentSource])

  const retry = () => {
    if (documentSource === null) return
    setFrameState((current) => ({
      source: documentSource,
      attempt: current.source === documentSource ? current.attempt + 1 : 0,
      status: "loading",
      height: defaultAssistantHtmlPreviewHeight,
    }))
  }

  const requestPreviewSnapshot = () => {
    const frameWindow = frameRef.current?.contentWindow
    if (!frameWindow || activeFrameState.status !== "ready") {
      return Promise.reject(new Error("HTML preview is not ready"))
    }
    const requestId = `${previewId}:capture:${++captureSequenceRef.current}`
    return new Promise<AssistantHtmlPreviewCaptureSnapshot>(
      (resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingCaptureRequestsRef.current.delete(requestId)
          reject(new Error("HTML preview snapshot timed out"))
        }, assistantHtmlPreviewCaptureTimeout)
        pendingCaptureRequestsRef.current.set(requestId, {
          resolve,
          reject,
          timeout,
        })
        frameWindow.postMessage(
          {
            type: assistantHtmlPreviewCaptureRequestMessageType,
            previewId,
            requestId,
          },
          "*"
        )
      }
    )
  }

  const downloadHtml = () => {
    downloadBlob(
      new Blob([html], { type: "text/html;charset=utf-8" }),
      `${productFilenamePrefix(productName)}-interactive-preview.html`
    )
  }

  const copyAsImage = async () => {
    const ClipboardItemConstructor = window.ClipboardItem
    if (
      typeof ClipboardItemConstructor !== "function" ||
      typeof navigator.clipboard?.write !== "function"
    ) {
      notify.error(t("conversation.inlineHtmlPreview.copyImageFailed"))
      return
    }
    setIsCapturingImage(true)
    try {
      const image = requestPreviewSnapshot().then((snapshot) =>
        renderAssistantHtmlPreviewSnapshot(snapshot)
      )
      void image.catch(() => undefined)
      await navigator.clipboard.write([
        new ClipboardItemConstructor({ "image/png": image }),
      ])
      notify.success(t("conversation.inlineHtmlPreview.imageCopied"))
    } catch {
      notify.error(t("conversation.inlineHtmlPreview.copyImageFailed"))
    } finally {
      setIsCapturingImage(false)
    }
  }

  const enterFullscreen = async () => {
    try {
      if (!previewCardRef.current?.requestFullscreen) {
        throw new Error("Fullscreen API is unavailable")
      }
      await previewCardRef.current.requestFullscreen()
    } catch {
      notify.error(t("conversation.inlineHtmlPreview.fullscreenFailed"))
    }
  }

  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      notify.error(t("conversation.inlineHtmlPreview.fullscreenFailed"))
    }
  }

  const shellSource = buildHtmlPreviewShellSource(
    previewId,
    activeFrameState.attempt
  )
  const showPreviewSurfaceBorder = activeFrameState.status !== "ready"

  return (
    <section
      ref={previewCardRef}
      className={cn(
        "group relative my-3 w-full max-w-full bg-transparent pr-8 text-card-foreground",
        isFullscreen &&
          "m-0 h-screen max-h-screen w-screen max-w-none overflow-y-auto bg-background pr-0"
      )}
      aria-label={t("conversation.inlineHtmlPreview.cardLabel")}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-2xl",
          showPreviewSurfaceBorder && "border border-muted-foreground/15",
          isFullscreen && "min-h-full rounded-none border-0",
          documentSource === null && "min-h-80"
        )}
        data-assistant-html-preview-surface="true"
      >
        {documentSource && (
          <iframe
            key={`${previewId}:${activeFrameState.attempt}`}
            ref={frameRef}
            className={cn(
              "block w-full border-0 bg-white",
              activeFrameState.status !== "ready" && "invisible"
            )}
            height={activeFrameState.height}
            data-assistant-html-preview-id={previewId}
            data-assistant-html-preview-attempt={activeFrameState.attempt}
            title={t("conversation.inlineHtmlPreview.frameTitle")}
            sandbox={interactiveHtmlPreviewSandbox}
            scrolling="no"
            src={shellSource}
            onLoad={() => {
              const frameWindow = frameRef.current?.contentWindow
              if (frameWindow) initializePreviewFrame(frameWindow)
            }}
            onError={() =>
              setFrameState((current) =>
                current.source === documentSource
                  ? { ...current, status: "error" }
                  : current
              )
            }
          />
        )}

        {activeFrameState.status === "loading" && (
          <AssistantHtmlPreviewLoading
            className="absolute inset-0 h-full min-h-0 rounded-none bg-background"
            label={t("conversation.inlineHtmlPreview.loading")}
          />
        )}

        {activeFrameState.status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
            <Alert className="flex w-full max-w-sm flex-col items-center gap-1 border-border/70 bg-background/95 px-5 py-4 text-center shadow-none backdrop-blur-sm">
              <TriangleAlertIcon
                className="text-muted-foreground"
                aria-hidden="true"
              />
              <AlertTitle className="text-sm">
                {t("conversation.inlineHtmlPreview.loadFailedTitle")}
              </AlertTitle>
              <AlertDescription>
                {t("conversation.inlineHtmlPreview.loadFailedDescription")}
              </AlertDescription>
              {documentSource && (
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shadow-none"
                    onClick={retry}
                  >
                    <RefreshCwIcon
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                    {t("common.retry")}
                  </Button>
                </div>
              )}
            </Alert>
          </div>
        )}
      </div>

      {activeFrameState.status === "ready" && !isFullscreen && (
        <AssistantPreviewActions
          label={t("conversation.inlineHtmlPreview.actions")}
        >
          <AssistantPreviewAction
            label={t("conversation.inlineHtmlPreview.downloadHtml")}
            onClick={downloadHtml}
          >
            <DownloadIcon aria-hidden="true" />
          </AssistantPreviewAction>
          <AssistantPreviewAction
            label={t("conversation.inlineHtmlPreview.copyImage")}
            disabled={isCapturingImage}
            onClick={() => void copyAsImage()}
          >
            <ImageIcon aria-hidden="true" />
          </AssistantPreviewAction>
          <AssistantPreviewAction
            label={t("conversation.inlineHtmlPreview.fullscreen")}
            onClick={() => void enterFullscreen()}
          >
            <Maximize2Icon aria-hidden="true" />
          </AssistantPreviewAction>
        </AssistantPreviewActions>
      )}

      {isFullscreen && (
        <Button
          type="button"
          variant="secondary"
          size="icon-lg"
          className="fixed top-4 right-4 z-30 rounded-xl border border-border/60 bg-background/90 shadow-sm backdrop-blur-sm"
          aria-label={t("conversation.inlineHtmlPreview.exitFullscreen")}
          onClick={() => void exitFullscreen()}
        >
          <Minimize2Icon aria-hidden="true" />
        </Button>
      )}
    </section>
  )
}
