import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import FileViewer, {
  type FileViewerHandle,
  type ViewerOptions,
  type ViewerState,
} from "@file-viewer/react"
import { useTranslation } from "react-i18next"

// Register Flyfish presets only when a lazy knowledge preview route is loaded.
import "virtual:file-viewer-renderers"

import { getErrorMessage } from "@/api/error-message"
import { useTheme } from "@/app/theme-state"
import { ErrorState } from "@/components/feedback/page-state"
import { installKnowledgeFileViewerTheme } from "@/features/knowledge-bases/knowledge-file-viewer-theme"
import { normalizeLanguage } from "@/i18n"
import { cn } from "@/lib/utils"

type KnowledgeFileViewerState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; file: File }>
  | Readonly<{ status: "error"; error: unknown }>

type KnowledgeFileViewerResult = Exclude<
  KnowledgeFileViewerState,
  Readonly<{ status: "loading" }>
> &
  Readonly<{ requestKey: string }>

type KnowledgeFileViewerRenderResult = Readonly<{
  requestKey: string
  status: "loading" | "ready" | "error"
}>

export type KnowledgeFileViewerProps = Readonly<{
  filename: string
  mimeType?: string | null
  loadFile: (signal: AbortSignal) => Promise<Blob>
  sourceKey: string
}>

function KnowledgeFileViewerLoadingState({
  className,
  filename,
  label,
}: Readonly<{
  className?: string
  filename: string
  label: string
}>) {
  return (
    <div
      className={cn("knowledge-file-viewer-loading", className)}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="knowledge-file-viewer-loading-stage" aria-hidden="true">
        <div className="knowledge-file-viewer-loading-sidebar">
          <span className="knowledge-file-viewer-loading-sidebar-heading" />
          <span className="knowledge-file-viewer-loading-sidebar-row" />
          <span className="knowledge-file-viewer-loading-sidebar-row" />
          <span className="knowledge-file-viewer-loading-sidebar-row" />
          <span className="knowledge-file-viewer-loading-sidebar-row" />
        </div>
        <div className="knowledge-file-viewer-loading-document">
          <span className="knowledge-file-viewer-loading-title" />
          <span className="knowledge-file-viewer-loading-line knowledge-file-viewer-loading-line-long" />
          <span className="knowledge-file-viewer-loading-line" />
          <span className="knowledge-file-viewer-loading-line knowledge-file-viewer-loading-line-short" />
          <span className="knowledge-file-viewer-loading-block" />
          <span className="knowledge-file-viewer-loading-line knowledge-file-viewer-loading-line-long" />
          <span className="knowledge-file-viewer-loading-line" />
        </div>
      </div>
      <span className="sr-only">
        {label}: {filename}
      </span>
    </div>
  )
}

export function KnowledgeFileViewer({
  filename,
  mimeType,
  loadFile,
  sourceKey,
}: KnowledgeFileViewerProps) {
  const { t, i18n } = useTranslation()
  const { theme } = useTheme()
  const viewerRef = useRef<FileViewerHandle>(null)
  const [loadKey, setLoadKey] = useState(0)
  const [result, setResult] = useState<KnowledgeFileViewerResult | null>(null)
  const [renderResult, setRenderResult] =
    useState<KnowledgeFileViewerRenderResult | null>(null)
  const requestKey = JSON.stringify([sourceKey, filename, mimeType, loadKey])
  const state: KnowledgeFileViewerState =
    result?.requestKey === requestKey ? result : { status: "loading" }
  const renderStatus =
    renderResult?.requestKey === requestKey ? renderResult.status : "loading"
  const locale = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const options = useMemo<ViewerOptions>(
    () => ({
      autoRenderers: false,
      locale,
      preset: ["lite", "office"],
      rendererMode: "replace",
      styleIsolation: "shadow",
      theme,
      toolbar: {
        download: false,
        exportHtml: false,
        permissions: {
          download: false,
          "export-html": false,
          print: false,
        },
        position: "bottom-right",
        print: false,
        search: true,
        theme: false,
        zoom: true,
      },
      ui: {
        density: "compact",
        surfaceBackground: "var(--office-viewer-canvas)",
      },
    }),
    [locale, theme]
  )

  const installViewerTheme = useCallback(() => {
    const container = viewerRef.current?.getController()?.container
    if (container) installKnowledgeFileViewerTheme(container)
  }, [])

  const handleViewerStateChange = useCallback(
    (nextState: ViewerState) => {
      installViewerTheme()
      const nextStatus = nextState.error
        ? "error"
        : nextState.ready
          ? "ready"
          : "loading"
      setRenderResult((current) =>
        current?.requestKey === requestKey && current.status === nextStatus
          ? current
          : { requestKey, status: nextStatus }
      )
    },
    [installViewerTheme, requestKey]
  )

  useEffect(() => {
    const controller = new AbortController()
    void loadFile(controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        if (blob.size === 0) throw new Error("knowledge_preview_empty")
        setResult({
          requestKey,
          status: "ready",
          file: new File([blob], filename, {
            lastModified: 0,
            type: blob.type || mimeType || "application/octet-stream",
          }),
        })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ requestKey, status: "error", error })
        }
      })
    return () => controller.abort()
  }, [filename, loadFile, mimeType, requestKey])

  useEffect(() => {
    if (state.status === "ready") installViewerTheme()
  }, [installViewerTheme, requestKey, state.status])

  if (state.status === "loading") {
    return (
      <KnowledgeFileViewerLoadingState
        filename={filename}
        label={t("knowledge.preview.loadingOriginal")}
      />
    )
  }
  if (state.status === "error") {
    return (
      <div className="knowledge-file-viewer-state">
        <ErrorState
          message={getErrorMessage(state.error, t)}
          onRetry={() => setLoadKey((current) => current + 1)}
        />
      </div>
    )
  }

  return (
    <div className="knowledge-file-viewer-surface">
      <FileViewer
        ref={viewerRef}
        aria-label={t("knowledge.preview.openNamed", { name: filename })}
        className="knowledge-flyfish-file-viewer"
        file={state.file}
        filename={filename}
        onStateChange={handleViewerStateChange}
        options={options}
        size={state.file.size}
      />
      {renderStatus === "loading" && (
        <div className="knowledge-file-viewer-rendering-overlay">
          <KnowledgeFileViewerLoadingState
            className="knowledge-file-viewer-loading-overlay"
            filename={filename}
            label={t("knowledge.preview.loadingOriginal")}
          />
        </div>
      )}
    </div>
  )
}
