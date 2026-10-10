import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { MessageCirclePlusIcon } from "lucide-react"
import {
  applicationAnnotationInputSchema,
  maximumOfficeAnnotationCount,
  type ApplicationDevelopment,
} from "@linksense/shared"
import { Button } from "@/components/ui/button"
import { StatusBanner } from "@/components/feedback/status-banner"
import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { OfficeSelectionPrompt } from "@/components/media/office-preview/office-selection-prompt"
import { OfficeAnnotationNumberBubble } from "@/components/media/office-preview/office-annotation-number-bubble"
import type { OfficeSelectionAnchor } from "@/components/media/office-preview/office-preview.types"
import type { HtmlSelection } from "@/components/media/html-preview/html-preview.types"
import {
  parseHtmlPreviewSelectionMessage,
  htmlSelectionAnchor,
  htmlSelectionKey,
  postHtmlPreviewAnnotationMode,
  postHtmlPreviewSelectionClear,
} from "@/components/media/html-preview/html-preview-selection"
import {
  parseHtmlPreviewAnnotationFrames,
  postHtmlPreviewAnnotations,
  postHtmlPreviewAnnotationFocus,
  type HtmlAnnotationFrame,
} from "@/components/media/html-preview/html-preview-annotations"
import {
  OfficeAnnotationBatchTray,
  type OfficeAnnotationDraft,
} from "@/features/conversations/office-annotation-batch-tray"
import { buildHtmlAnnotation } from "@/features/conversations/conversation-office-annotation"
import { installApplicationAnnotationRuntime } from "./application-annotation-runtime"
import type { ApplicationAnnotationSubmit } from "./application-annotation-submission"
import { useProductName } from "@/app/product-branding"

export type ApplicationAnnotationOptions = {
  controlsContainer: HTMLElement | null
  project: ApplicationDevelopment
  onSubmit: ApplicationAnnotationSubmit
  onActiveChange: (active: boolean) => void
}

export function ApplicationAnnotationPreview({
  source,
  title,
  packageId,
  frameRef,
  options,
  onLoad,
}: {
  source: string
  title: string
  packageId: string
  frameRef: RefObject<HTMLIFrameElement | null>
  options: ApplicationAnnotationOptions
  onLoad: () => void
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  const scopeRef = useRef<HTMLDivElement | null>(null)
  const [load, setLoad] = useState(0)
  const [readyPath, setReadyPath] = useState<string | null>(null)
  const [mode, setMode] = useState(false)
  const [selection, setSelection] = useState<HtmlSelection | null>(null)
  const [anchor, setAnchor] = useState<OfficeSelectionAnchor | null>(null)
  const [frames, setFrames] = useState<HtmlAnnotationFrame[]>([])
  const [drafts, setDrafts] = useState<OfficeAnnotationDraft[]>([])
  const draftPage = useRef<string | null>(null)
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const { project, onSubmit, onActiveChange } = options
  const active = mode || drafts.length > 0
  const receive = useEffectEvent((value: unknown) => {
    const frame = frameRef.current
    if (!frame || !readyPath) return
    const geometry = parseHtmlPreviewAnnotationFrames(value)
    if (geometry !== null) {
      setFrames(geometry)
      return
    }
    if (!mode || (draftPage.current && draftPage.current !== readyPath)) return
    const message = parseHtmlPreviewSelectionMessage(value)
    if (!message) return
    setSelection(message.selection)
    setAnchor(htmlSelectionAnchor(frame, message.anchor))
  })

  useEffect(() => {
    onActiveChange(active)
  }, [active, onActiveChange])
  useEffect(() => () => onActiveChange(false), [onActiveChange])
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !load) return
    return installApplicationAnnotationRuntime(
      frame,
      source,
      (path) => {
        setReadyPath(path)
        if (draftPage.current && draftPage.current !== path)
          setError(t("applicationDevelopment.annotations.changed"))
      },
      () => {
        setReadyPath(null)
        setError(t("applicationDevelopment.annotations.unavailable"))
      },
      (message) => receive(message)
    )
  }, [frameRef, source, load, t])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !readyPath) return
    const sync = () => postHtmlPreviewAnnotationMode(frame, mode)
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })
    return () => {
      observer.disconnect()
      postHtmlPreviewAnnotationMode(frame, false)
    }
  }, [frameRef, readyPath, mode])
  useEffect(() => {
    if (
      !frameRef.current ||
      !readyPath ||
      (draftPage.current && draftPage.current !== readyPath)
    )
      return
    postHtmlPreviewAnnotations(
      frameRef.current,
      drafts.flatMap((draft, index) =>
        draft.officeSelection.kind === "html"
          ? [
              {
                id: draft.id,
                index: index + 1,
                selection: draft.officeSelection.selection,
              },
            ]
          : []
      )
    )
  }, [drafts, frameRef, readyPath])
  const canAnnotate =
    readyPath &&
    project.preview_current &&
    project.source_hash &&
    !project.source_error
  const send = async () => {
    if (sendingRef.current || !drafts.length) return
    if (!readyPath || !project.source_hash || draftPage.current !== readyPath) {
      const message = t("applicationDevelopment.annotations.changed")
      setError(message)
      throw new Error(message)
    }
    sendingRef.current = true
    setSending(true)
    setError(null)
    try {
      const annotation = applicationAnnotationInputSchema.parse({
        kind: "application_annotation",
        development_id: project.id,
        package_id: packageId,
        source_hash: project.source_hash,
        page_path: readyPath,
        annotations: drafts.map((draft) => {
          if (draft.officeSelection.kind !== "html")
            throw new Error("invalid_selection")
          return buildHtmlAnnotation(
            draft.officeSelection.selection,
            draft.request
          )
        }),
      })
      await onSubmit({ annotation, name: project.name })
      setDrafts([])
      draftPage.current = null
      setFrames([])
      setSelection(null)
      setMode(false)
    } catch (cause) {
      setError(
        cause instanceof ApiError &&
          cause.errorCode === "APPLICATION_DEVELOPMENT_SOURCE_CHANGED"
          ? t("applicationDevelopment.annotations.changed")
          : getErrorMessage(cause, t)
      )
      throw cause
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <div className="flex size-full min-h-0 flex-col">
      {options.controlsContainer &&
        createPortal(
          <div className="flex items-center gap-2 [&_.office-annotation-batch]:static">
            <Button
              variant="annotation"
              size="xs"
              aria-pressed={mode}
              disabled={(!mode && !canAnnotate) || sending}
              onClick={() => {
                setSelection(null)
                setError(null)
                setMode(!mode)
              }}
            >
              <MessageCirclePlusIcon data-icon="inline-start" />
              {t(
                mode
                  ? "applicationDevelopment.annotations.finish"
                  : "applicationDevelopment.annotations.start"
              )}
            </Button>
            <OfficeAnnotationBatchTray
              drafts={drafts}
              submitting={sending}
              onRemove={(id) => {
                const next = drafts.filter((item) => item.id !== id)
                if (!next.length) draftPage.current = null
                setDrafts(next)
              }}
              onClear={() => {
                setDrafts([])
                draftPage.current = null
                setFrames([])
                setError(null)
              }}
              onLocate={(draft) => {
                if (frameRef.current && draft.officeSelection.kind === "html")
                  postHtmlPreviewAnnotationFocus(
                    frameRef.current,
                    draft.officeSelection.selection
                  )
              }}
              onSend={send}
            />
          </div>,
          options.controlsContainer
        )}
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <div ref={scopeRef} className="relative min-h-0 flex-1 overflow-hidden">
        <iframe
          ref={frameRef}
          src={source}
          title={title}
          className="absolute inset-0 size-full border-0 bg-background"
          onLoad={() => {
            setReadyPath(null)
            setSelection(null)
            setFrames([])
            setLoad((value) => value + 1)
            onLoad()
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          aria-hidden="true"
        >
          {frames
            .filter((frame) => drafts.some((draft) => draft.id === frame.id))
            .map((frame) => (
              <span
                key={frame.id}
                className="office-annotation-frame html-preview-annotation-frame"
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
        {mode && selection && (
          <OfficeSelectionPrompt
            key={htmlSelectionKey(selection)}
            scopeRef={scopeRef}
            selection={selection}
            anchor={anchor}
            action={{
              label: t("officePreview.askLinkSense", { productName }),
              shortcutLabel: t("officePreview.askShortcut"),
              promptLabel: t("officePreview.selectionPromptLabel", {
                productName,
              }),
              placeholder: t("officePreview.selectionPromptPlaceholder"),
              submitLabel: t("officePreview.selectionPromptSubmit"),
              errorMessage: t("officePreview.selectionPromptError"),
              disabled:
                sending || drafts.length >= maximumOfficeAnnotationCount,
              disabledReason: t(
                sending
                  ? "officePreview.selectionUnavailableWhileBusy"
                  : "officePreview.annotationBatch.limitReached",
                {
                  count: maximumOfficeAnnotationCount,
                }
              ),
              onSubmit: async (selected, request) => {
                if (
                  sendingRef.current ||
                  drafts.length >= maximumOfficeAnnotationCount ||
                  !readyPath
                )
                  throw new Error("annotation_unavailable")
                draftPage.current = readyPath
                setDrafts((items) => [
                  ...items,
                  {
                    id: crypto.randomUUID(),
                    officeSelection: { kind: "html", selection: selected },
                    request,
                  },
                ])
                if (frameRef.current)
                  postHtmlPreviewSelectionClear(frameRef.current, selected)
                setSelection(null)
              },
            }}
          />
        )}
      </div>
    </div>
  )
}
