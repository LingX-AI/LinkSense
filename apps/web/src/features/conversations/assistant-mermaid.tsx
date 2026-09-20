import { MermaidPreviewToolbar } from "@/features/conversations/mermaid-preview-toolbar"
import { ImagePreviewViewer } from "@/components/media/image-preview"
import { AssistantHtmlPreviewLoading } from "@/features/conversations/assistant-html-preview-loading"
import {
  AssistantPreviewAction,
  AssistantPreviewActions,
} from "@/features/conversations/assistant-preview-actions"
import { useEffect, useRef, useState } from "react"
import { CheckIcon, CopyIcon, DownloadIcon, ExpandIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useResolvedTheme } from "@/app/use-resolved-theme"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { ImagePreviewSurface } from "@/components/media/image-preview-surface"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  renderMermaidDiagram,
  type MermaidDiagram,
} from "@/features/conversations/mermaid-renderer"
import { exportMermaidPng } from "@/features/conversations/mermaid-export"
import { downloadBlob } from "@/lib/download-blob"

// Long diagrams are fitted to the panel first, so need more zoom than photos.
const MAXIMUM_DIAGRAM_ZOOM = 2000

type RenderState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; diagram: MermaidDiagram }

type AssistantMermaidProps = Readonly<{
  source: string
  streaming: boolean
  copySource: (source: string) => Promise<boolean>
}>

export function AssistantMermaid({
  source,
  streaming,
  copySource,
}: AssistantMermaidProps) {
  const theme = useResolvedTheme()
  if (streaming) return <MermaidPending streaming />
  // A new source/theme gets a fresh state so obsolete images are never exported.
  return (
    <MermaidContent
      key={`${theme}:${streaming}:${source}`}
      source={source}
      streaming={streaming}
      copySource={copySource}
      theme={theme}
    />
  )
}

function MermaidContent({
  source,
  streaming,
  copySource,
  theme,
}: AssistantMermaidProps & { theme: "light" | "dark" }) {
  const { t } = useTranslation()
  const [state, setState] = useState<RenderState>({ status: "loading" })
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportPending = useRef(false)
  const copyPending = useRef(false)

  useEffect(() => {
    if (streaming) return
    let cancelled = false
    void renderMermaidDiagram(source, theme).then(
      (diagram) => {
        if (!cancelled) setState({ status: "ready", diagram })
      },
      () => {
        if (!cancelled) setState({ status: "error" })
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, streaming, theme])

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const copy = async () => {
    if (copyPending.current) return
    copyPending.current = true
    setCopying(true)
    try {
      if (!(await copySource(source))) throw new Error("Copy failed")
      setCopied(true)
    } catch {
      toast.error(t("conversation.copyContentFailed"))
    } finally {
      copyPending.current = false
      setCopying(false)
    }
  }
  const save = async () => {
    if (state.status !== "ready" || exportPending.current) return
    exportPending.current = true
    setExporting(true)
    try {
      const png = await exportMermaidPng(state.diagram)
      downloadBlob(png, t("conversation.diagram.filename"))
    } catch {
      toast.error(t("conversation.diagram.exportFailed"))
    } finally {
      exportPending.current = false
      setExporting(false)
    }
  }
  if (state.status === "loading")
    return <MermaidPending streaming={streaming} />

  return (
    <section
      data-assistant-diagram
      className="group relative my-3 w-full max-w-full min-w-0 pr-8"
      aria-label={t("conversation.diagram.title")}
    >
      {state.status === "ready" ? (
        <>
          <div className="relative h-[32rem] max-h-[65dvh] min-h-64 overflow-hidden rounded-2xl bg-background">
            <ImagePreviewViewer
              key={state.diagram.url}
              showZoomControls={false}
              maximumZoom={MAXIMUM_DIAGRAM_ZOOM}
              className="conversation-image-preview-viewer"
              item={{
                id: "diagram",
                name: t("conversation.diagram.title"),
                src: state.diagram.url,
                downloadable: false,
              }}
            />
          </div>
          {!expanded && (
            <AssistantPreviewActions label={t("conversation.diagram.actions")}>
              <AssistantPreviewAction
                label={t(
                  copied
                    ? "conversation.codeCopied"
                    : "conversation.diagram.copy"
                )}
                disabled={copying}
                onClick={() => void copy()}
              >
                {copied ? (
                  <CheckIcon aria-hidden="true" />
                ) : (
                  <CopyIcon aria-hidden="true" />
                )}
              </AssistantPreviewAction>
              <AssistantPreviewAction
                label={t("conversation.diagram.export")}
                disabled={exporting}
                onClick={() => void save()}
              >
                <DownloadIcon aria-hidden="true" />
              </AssistantPreviewAction>
              <AssistantPreviewAction
                label={t("conversation.diagram.expand")}
                onClick={() => {
                  setExpanded(true)
                }}
              >
                <ExpandIcon aria-hidden="true" />
              </AssistantPreviewAction>
            </AssistantPreviewActions>
          )}
        </>
      ) : (
        <Alert>
          <AlertDescription>{t("conversation.diagram.error")}</AlertDescription>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={copying}
            onClick={() => void copy()}
          >
            <CopyIcon data-icon="inline-start" aria-hidden="true" />
            {t(
              copied ? "conversation.codeCopied" : "conversation.diagram.copy"
            )}
          </Button>
        </Alert>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? t("conversation.codeCopied") : ""}
      </span>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        {state.status === "ready" && (
          <ImagePreviewSurface name={t("conversation.diagram.title")}>
            <ImagePreviewViewer
              key={state.diagram.url}
              wheelZoom
              maximumZoom={MAXIMUM_DIAGRAM_ZOOM}
              item={{
                id: "expanded-diagram",
                name: t("conversation.diagram.title"),
                src: state.diagram.url,
                downloadable: false,
              }}
              renderControls={(controls) => (
                <MermaidPreviewToolbar
                  controls={controls}
                  copied={copied}
                  copying={copying}
                  exporting={exporting}
                  onCopy={() => void copy()}
                  onExport={() => void save()}
                />
              )}
            />
          </ImagePreviewSurface>
        )}
      </Dialog>
    </section>
  )
}

function MermaidPending({ streaming }: Readonly<{ streaming: boolean }>) {
  const { t } = useTranslation()
  return (
    <div data-assistant-diagram className="my-3 w-full">
      <AssistantHtmlPreviewLoading
        className="aspect-square min-h-0 max-w-[20rem]"
        label={t(
          streaming
            ? "conversation.diagram.streaming"
            : "conversation.diagram.loading"
        )}
      />
    </div>
  )
}
