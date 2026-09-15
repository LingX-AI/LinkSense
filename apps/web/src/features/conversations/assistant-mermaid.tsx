import { useEffect, useRef, useState } from "react"
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExpandIcon,
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useResolvedTheme } from "@/app/use-resolved-theme"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  renderMermaidDiagram,
  type MermaidDiagram,
} from "@/features/conversations/mermaid-renderer"
import { exportMermaidPng } from "@/features/conversations/mermaid-export"
import { downloadBlob } from "@/lib/download-blob"

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
  const { t, i18n } = useTranslation()
  const [state, setState] = useState<RenderState>({ status: "loading" })
  const [expanded, setExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)
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
  const actions = (
    <div
      className="flex shrink-0 items-center gap-1"
      role="group"
      aria-label={t("conversation.diagram.actions")}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={t(
          copied ? "conversation.codeCopied" : "conversation.diagram.copy"
        )}
        aria-label={t(
          copied ? "conversation.codeCopied" : "conversation.diagram.copy"
        )}
        disabled={copying}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={t("conversation.diagram.export")}
        aria-label={t("conversation.diagram.export")}
        disabled={state.status !== "ready" || exporting}
        onClick={() => void save()}
      >
        {exporting ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <DownloadIcon />
        )}
      </Button>
    </div>
  )
  return (
    <section
      className="my-3 min-w-0 overflow-hidden rounded-xl border border-border/60 bg-background"
      aria-label={t("conversation.diagram.title")}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("conversation.diagram.title")}
        </span>
        <div className="flex items-center gap-1">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t("conversation.diagram.expand")}
            aria-label={t("conversation.diagram.expand")}
            disabled={state.status !== "ready"}
            onClick={() => {
              setZoom(1)
              setExpanded(true)
            }}
          >
            <ExpandIcon />
          </Button>
        </div>
      </div>
      {state.status === "ready" ? (
        <div className="px-4 pt-1 pb-5">
          <img
            data-diagram-image
            src={state.diagram.url}
            alt={t("conversation.diagram.title")}
            width={state.diagram.width}
            height={state.diagram.height}
            className="mx-auto block h-auto max-h-[32rem] max-w-full object-contain"
          />
        </div>
      ) : state.status === "error" ? (
        <Alert className="rounded-none border-0">
          <AlertDescription>{t("conversation.diagram.error")}</AlertDescription>
        </Alert>
      ) : (
        <div
          role="status"
          className="flex min-h-28 items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground"
        >
          <LoaderCircleIcon
            className="size-4 animate-spin"
            aria-hidden="true"
          />
          {t(
            streaming
              ? "conversation.diagram.streaming"
              : "conversation.diagram.loading"
          )}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? t("conversation.codeCopied") : ""}
      </span>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="flex max-h-[90dvh] flex-col gap-3 sm:max-w-[calc(100%-4rem)]"
          closeLabel={t("conversation.diagram.close")}
          aria-describedby={undefined}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pr-10">
            <DialogTitle>{t("conversation.diagram.title")}</DialogTitle>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("conversation.diagram.zoomOut")}
                title={t("conversation.diagram.zoomOut")}
                disabled={zoom <= 0.5}
                onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
              >
                <MinusIcon />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("conversation.diagram.resetZoom")}
                onClick={() => setZoom(1)}
              >
                {new Intl.NumberFormat(i18n.resolvedLanguage, {
                  style: "percent",
                }).format(zoom)}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("conversation.diagram.zoomIn")}
                title={t("conversation.diagram.zoomIn")}
                disabled={zoom >= 3}
                onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
              >
                <PlusIcon />
              </Button>
              {actions}
            </div>
          </div>
          {state.status === "ready" && (
            <div
              className="min-h-0 overflow-auto overscroll-contain rounded-lg bg-background p-4"
              tabIndex={0}
              role="region"
              aria-label={t("conversation.diagram.title")}
            >
              <img
                data-diagram-image
                src={state.diagram.url}
                alt={t("conversation.diagram.title")}
                width={Math.ceil(state.diagram.width * zoom)}
                height={Math.ceil(state.diagram.height * zoom)}
                className="mx-auto block max-w-none"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
