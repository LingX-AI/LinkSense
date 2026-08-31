import {
  LanguageDescription,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { EditorState, type Extension } from "@codemirror/state"
import { EditorView, lineNumbers } from "@codemirror/view"
import {
  FileWarningIcon,
  ImageOffIcon,
  WrapTextIcon,
} from "lucide-react"
import { parse } from "papaparse"
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import ReactMarkdown from "react-markdown"
import { Document as PdfDocument, Page as PdfPage, pdfjs } from "react-pdf"
import { useTranslation } from "react-i18next"
import remarkGfm from "remark-gfm"

import { ImagePreviewViewer } from "@/components/media/image-preview"
import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import { OfficePreviewLoadingState } from "@/components/media/office-preview/office-preview-loading-state"
import type { OfficePreviewUpdateAction } from "@/components/media/office-preview/office-preview.types"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ConversationFilePreviewKind } from "@/features/conversations/conversation-file-preview"
import { cn } from "@/lib/utils"

import {
  decodeFilePreviewText,
  getFilePreviewLanguageFilename,
} from "./read-only-file-preview-utils"

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString()
}

const MAX_CSV_ROWS = 1_000
const MAX_CSV_COLUMNS = 40
const PDF_DOCUMENT_OPTIONS = Object.freeze({ isEvalSupported: false })

/**
 * PDF.js performs rendering outside React and may surface a synchronous error
 * from a worker or canvas. Keep that failure scoped to this preview instead of
 * allowing it to unmount the entire conversation page.
 */
class PdfPreviewErrorBoundary extends Component<
  Readonly<{ children: ReactNode; onError: () => void }>,
  Readonly<{ failed: boolean }>
> {
  state: Readonly<{ failed: boolean }> = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--office-viewer-canvas)",
    color: "var(--app-text)",
    fontSize: "var(--app-ui-font-size)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.65",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "14px 0 28px",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    minHeight: "100%",
    borderRight: "1px solid var(--app-divider)",
    backgroundColor:
      "color-mix(in srgb, var(--app-canvas) 78%, var(--office-viewer-canvas))",
    color: "var(--app-muted)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "transparent",
  },
})

export type ReadOnlyFilePreviewDocumentState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{
      status: "ready"
      content?: Uint8Array
      source?: Readonly<{ url: string; expiresAt?: string }>
    }>

function PreviewProblem({
  label,
  icon = "warning",
  onRetry,
}: Readonly<{
  label: string
  icon?: "warning" | "image"
  onRetry?: () => void
}>) {
  const { t } = useTranslation()
  const Icon = icon === "image" ? ImageOffIcon : FileWarningIcon
  return (
    <div className="read-only-file-preview-problem" role="alert">
      <Icon aria-hidden="true" />
      <p>{label}</p>
      {onRetry && (
        <Button type="button" variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  )
}

function CodeMirrorPreview({
  text,
  fileName,
  wrap,
}: Readonly<{
  text: string
  fileName: string
  wrap: boolean
}>) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [languageState, setLanguageState] = useState<{
    fileName: string
    extension: Extension | null
  }>({ fileName: "", extension: null })
  const languageExtension =
    languageState.fileName === fileName ? languageState.extension : null

  useEffect(() => {
    let disposed = false
    const description = LanguageDescription.matchFilename(
      languages,
      getFilePreviewLanguageFilename(fileName)
    )
    if (!description) return () => undefined

    void description
      .load()
      .then((support) => {
        if (!disposed) {
          setLanguageState({ fileName, extension: support })
        }
      })
      .catch(() => {
        if (!disposed) {
          setLanguageState({ fileName, extension: null })
        }
      })
    return () => {
      disposed = true
    }
  }, [fileName])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const state = EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        ...(wrap ? [EditorView.lineWrapping] : []),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.contentAttributes.of({
          "aria-label": t("filePreview.codeContent", { name: fileName }),
        }),
        editorTheme,
        ...(languageExtension ? [languageExtension] : []),
      ],
    })
    const view = new EditorView({ state, parent: host })
    return () => view.destroy()
  }, [fileName, languageExtension, text, t, wrap])

  return <div ref={hostRef} className="read-only-file-preview-code-editor" />
}

export function CodePreviewWrapButton({
  wrap,
  onWrapChange,
}: Readonly<{
  wrap: boolean
  onWrapChange: (wrap: boolean) => void
}>) {
  const { t } = useTranslation()

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="read-only-file-preview-wrap-button"
      aria-pressed={wrap}
      aria-label={t(
        wrap ? "filePreview.disableWrap" : "filePreview.enableWrap"
      )}
      onClick={() => onWrapChange(!wrap)}
    >
      <WrapTextIcon aria-hidden="true" data-icon="inline-start" />
      {t("filePreview.wrap")}
    </Button>
  )
}

function CodePreview({
  content,
  fileName,
  wrap: controlledWrap,
  onWrapChange,
  showToolbar = true,
}: Readonly<{
  content: Uint8Array
  fileName: string
  wrap?: boolean
  onWrapChange?: (wrap: boolean) => void
  showToolbar?: boolean
}>) {
  const { t } = useTranslation()
  const [uncontrolledWrap, setUncontrolledWrap] = useState(true)
  const wrap = controlledWrap ?? uncontrolledWrap
  const decoded = useMemo(() => decodeFilePreviewText(content), [content])

  if (!decoded) {
    return <PreviewProblem label={t("filePreview.binaryContent")} />
  }

  return (
    <div
      className="read-only-file-preview-code"
      data-testid="code-file-preview"
    >
      {showToolbar && (
        <div className="read-only-file-preview-toolbar">
          <CodePreviewWrapButton
            wrap={wrap}
            onWrapChange={(nextWrap) => {
              if (controlledWrap === undefined) {
                setUncontrolledWrap(nextWrap)
              }
              onWrapChange?.(nextWrap)
            }}
          />
        </div>
      )}
      {decoded.truncated && (
        <p className="read-only-file-preview-note" role="status">
          {t("filePreview.contentTruncated")}
        </p>
      )}
      <CodeMirrorPreview text={decoded.text} fileName={fileName} wrap={wrap} />
    </div>
  )
}

function MarkdownPreview({ content }: Readonly<{ content: Uint8Array }>) {
  const { t } = useTranslation()
  const decoded = useMemo(() => decodeFilePreviewText(content), [content])
  if (!decoded) {
    return <PreviewProblem label={t("filePreview.binaryContent")} />
  }

  return (
    <div
      className="read-only-file-preview-markdown"
      data-testid="markdown-file-preview"
    >
      {decoded.truncated && (
        <p className="read-only-file-preview-note" role="status">
          {t("filePreview.contentTruncated")}
        </p>
      )}
      <article className="read-only-file-preview-markdown-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, href }) => (
              <a href={href} rel="noreferrer" target="_blank">
                {children}
              </a>
            ),
          }}
        >
          {decoded.text}
        </ReactMarkdown>
      </article>
    </div>
  )
}

function CsvPreview({
  content,
  fileName,
}: Readonly<{
  content: Uint8Array
  fileName: string
}>) {
  const { t } = useTranslation()
  const decoded = useMemo(() => decodeFilePreviewText(content), [content])
  const result = useMemo(() => {
    if (!decoded) return null
    return parse<string[]>(decoded.text, {
      delimiter: fileName.trim().toLowerCase().endsWith(".tsv") ? "\t" : "",
      skipEmptyLines: "greedy",
    })
  }, [decoded, fileName])

  if (!decoded) {
    return <PreviewProblem label={t("filePreview.binaryContent")} />
  }
  if (!result || result.errors.length > 0) {
    return <PreviewProblem label={t("filePreview.csvFailed")} />
  }

  const rows = result.data.slice(0, MAX_CSV_ROWS)
  const columnCount = Math.min(
    MAX_CSV_COLUMNS,
    rows.reduce((count, row) => Math.max(count, row.length), 0)
  )
  const [header = [], ...bodyRows] = rows
  const wasTruncated =
    decoded.truncated ||
    result.data.length > rows.length ||
    columnCount < rows.reduce((count, row) => Math.max(count, row.length), 0)

  return (
    <div className="read-only-file-preview-csv" data-testid="csv-file-preview">
      <div className="read-only-file-preview-toolbar">
        <span className="read-only-file-preview-toolbar-label">
          {t("filePreview.csvSummary", {
            rows: result.data.length,
            columns: columnCount,
          })}
        </span>
      </div>
      {wasTruncated && (
        <p className="read-only-file-preview-note" role="status">
          {t("filePreview.tableTruncated")}
        </p>
      )}
      {columnCount === 0 ? (
        <div className="read-only-file-preview-empty" role="status">
          {t("filePreview.emptyTable")}
        </div>
      ) : (
        <div className="read-only-file-preview-csv-table-wrap">
          <Table className="read-only-file-preview-csv-table">
            <TableHeader>
              <TableRow>
                {Array.from({ length: columnCount }, (_, index) => (
                  <TableHead key={`header-${index}`}>
                    {header[index] ||
                      t("filePreview.unnamedColumn", { index: index + 1 })}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bodyRows.map((row, rowIndex) => (
                <TableRow key={`row-${rowIndex}`}>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <TableCell key={`cell-${rowIndex}-${columnIndex}`}>
                      {row[columnIndex] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function PdfPreview({ content }: Readonly<{ content: Uint8Array }>) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [pageWidth, setPageWidth] = useState(640)
  const [failed, setFailed] = useState(false)
  // PDF.js transfers typed-array ownership to its worker. A stable Blob makes
  // react-pdf read fresh worker-owned bytes while preserving the cached
  // conversation content for downloads and later React renders.
  const documentFile = useMemo(() => {
    const data = new Uint8Array(content.byteLength)
    data.set(content)
    return new Blob([data.buffer], { type: "application/pdf" })
  }, [content])
  const handlePdfFailure = useCallback(() => setFailed(true), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updateWidth = () => {
      const width = Math.floor(container.getBoundingClientRect().width)
      setPageWidth(Math.max(240, Math.min(1_040, width - 40)))
    }
    updateWidth()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(updateWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  if (failed) {
    return <PreviewProblem label={t("filePreview.pdfFailed")} />
  }

  return (
    <div
      ref={containerRef}
      className="read-only-file-preview-pdf"
      data-testid="pdf-file-preview"
    >
      <PdfPreviewErrorBoundary onError={handlePdfFailure}>
        <PdfDocument
          className="read-only-file-preview-pdf-document"
          error={null}
          file={documentFile}
          loading={
            <OfficePreviewLoadingState
              className="read-only-file-preview-pdf-loading"
              label={t("filePreview.pdfLoading")}
            />
          }
          onLoadError={handlePdfFailure}
          onSourceError={handlePdfFailure}
          onLoadSuccess={({ numPages }) => {
            setPageCount(numPages)
          }}
          options={PDF_DOCUMENT_OPTIONS}
        >
          {Array.from(
            { length: Math.max(pageCount, 1) },
            (_, pageIndex) => (
              <PdfPage
                key={pageIndex + 1}
                className="read-only-file-preview-pdf-page"
                error={null}
                pageNumber={pageIndex + 1}
                renderAnnotationLayer={false}
                renderTextLayer={false}
                width={pageWidth}
                onLoadError={handlePdfFailure}
                onRenderError={handlePdfFailure}
              />
            )
          )}
        </PdfDocument>
      </PdfPreviewErrorBoundary>
    </div>
  )
}

function SourcePreview({
  kind,
  source,
  content,
  mimeType,
  fileName,
  onRetry,
}: Readonly<{
  kind: Extract<ConversationFilePreviewKind, "image" | "audio" | "video">
  source?: Readonly<{ url: string; expiresAt?: string }>
  content?: Uint8Array
  mimeType: string
  fileName: string
  onRetry?: () => void
}>) {
  const { t } = useTranslation()
  const [failedSourceUrl, setFailedSourceUrl] = useState<string | null>(null)
  const objectUrl = useMemo(() => {
    if (source || !content) return null
    const blobContent = new Uint8Array(content.byteLength)
    blobContent.set(content)
    return URL.createObjectURL(new Blob([blobContent.buffer], { type: mimeType }))
  }, [content, mimeType, source])
  const sourceUrl = source?.url ?? objectUrl

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    },
    [objectUrl]
  )

  if (!sourceUrl) {
    return <PreviewProblem label={t("filePreview.contentUnavailable")} />
  }

  if (failedSourceUrl === sourceUrl) {
    return (
      <PreviewProblem
        icon={kind === "image" ? "image" : "warning"}
        label={t(
          kind === "image"
            ? "filePreview.imageFailed"
            : "filePreview.mediaFailed"
        )}
        onRetry={onRetry}
      />
    )
  }

  if (kind === "image") {
    return (
      <div
        className="read-only-file-preview-image"
        data-testid="image-file-preview"
      >
        <ImagePreviewViewer
          key={sourceUrl}
          className="read-only-file-preview-image-viewer"
          item={{ id: sourceUrl, name: fileName, src: sourceUrl }}
          onLoadError={() => setFailedSourceUrl(sourceUrl)}
        />
      </div>
    )
  }

  if (kind === "audio") {
    return (
      <div
        className="read-only-file-preview-media read-only-file-preview-audio"
        data-testid="audio-file-preview"
      >
        <audio
          controls
          onError={() => setFailedSourceUrl(sourceUrl)}
          preload="metadata"
        >
          <source src={sourceUrl} type={mimeType} />
          {t("filePreview.mediaUnsupported")}
        </audio>
      </div>
    )
  }

  return (
    <div
      className="read-only-file-preview-media read-only-file-preview-video"
      data-testid="video-file-preview"
    >
      <video
        controls
        onError={() => setFailedSourceUrl(sourceUrl)}
        playsInline
        preload="metadata"
      >
        <source src={sourceUrl} type={mimeType} />
        {t("filePreview.mediaUnsupported")}
      </video>
    </div>
  )
}

function ReadyPreviewContent({
  kind,
  document,
  fileName,
  mimeType,
  onRetry,
  codeWrap,
  onCodeWrapChange,
  showCodeToolbar,
}: Readonly<{
  kind: Exclude<
    ConversationFilePreviewKind,
    "presentation" | "word" | "spreadsheet" | "html" | "archive"
  >
  document: Extract<ReadOnlyFilePreviewDocumentState, { status: "ready" }>
  fileName: string
  mimeType: string
  onRetry?: () => void
  codeWrap?: boolean
  onCodeWrapChange?: (wrap: boolean) => void
  showCodeToolbar?: boolean
}>) {
  const { t } = useTranslation()
  if (kind === "image" || kind === "audio" || kind === "video") {
    return document.source || document.content ? (
      <SourcePreview
        key={document.source?.url}
        content={document.content}
        kind={kind}
        mimeType={mimeType}
        source={document.source}
        fileName={fileName}
        onRetry={onRetry}
      />
    ) : (
      <PreviewProblem label={t("filePreview.contentUnavailable")} />
    )
  }

  if (!document.content) {
    return <PreviewProblem label={t("filePreview.contentUnavailable")} />
  }

  if (kind === "pdf") return <PdfPreview content={document.content} />
  if (kind === "csv") {
    return <CsvPreview content={document.content} fileName={fileName} />
  }
  if (kind === "markdown") return <MarkdownPreview content={document.content} />
  return (
    <CodePreview
      content={document.content}
      fileName={fileName}
      wrap={codeWrap}
      onWrapChange={onCodeWrapChange}
      showToolbar={showCodeToolbar}
    />
  )
}

/**
 * Renders a safe generic file preview without an OfficePreviewShell. This is
 * used by archive entries so the archive remains the single preview surface.
 */
export function ReadOnlyFilePreviewContent({
  kind,
  document,
  fileName,
  mimeType,
  onRetry,
  codeWrap,
  onCodeWrapChange,
  showCodeToolbar,
}: Readonly<{
  kind: Exclude<
    ConversationFilePreviewKind,
    "presentation" | "word" | "spreadsheet" | "html" | "archive"
  >
  document: ReadOnlyFilePreviewDocumentState
  fileName: string
  mimeType: string
  onRetry?: () => void
  codeWrap?: boolean
  onCodeWrapChange?: (wrap: boolean) => void
  showCodeToolbar?: boolean
}>) {
  const { t } = useTranslation()

  if (document.status === "loading") {
    return <OfficePreviewLoadingState label={t("filePreview.loading")} />
  }

  if (document.status === "error") {
    return <PreviewProblem label={t("filePreview.loadFailed")} onRetry={onRetry} />
  }

  return (
    <ReadyPreviewContent
      document={document}
      fileName={fileName}
      kind={kind}
      mimeType={mimeType}
      onRetry={onRetry}
      codeWrap={codeWrap}
      onCodeWrapChange={onCodeWrapChange}
      showCodeToolbar={showCodeToolbar}
    />
  )
}

export function ReadOnlyFilePreview({
  kind,
  document,
  fileName,
  mimeType,
  onRetry,
  onDownload,
  updateAction,
  onClose,
  className,
}: Readonly<{
  kind: Exclude<
    ConversationFilePreviewKind,
    "presentation" | "word" | "spreadsheet" | "html" | "archive"
  >
  document: ReadOnlyFilePreviewDocumentState
  fileName: string
  mimeType: string
  onRetry?: () => void
  onDownload?: () => void
  updateAction?: OfficePreviewUpdateAction
  onClose?: () => void
  className?: string
}>) {
  const { t } = useTranslation()
  return (
    <OfficePreviewShell
      className={cn("read-only-file-preview-pane", className)}
      bodyClassName="read-only-file-preview-body"
      document={document}
      fileName={fileName}
      loadFailedLabel={t("filePreview.loadFailed")}
      loadingLabel={t("filePreview.loading")}
      mimeType={mimeType}
      onClose={onClose}
      onDownload={onDownload}
      onRetry={onRetry}
      updateAction={updateAction}
    >
      <ReadOnlyFilePreviewContent
        document={document}
        fileName={fileName}
        kind={kind}
        mimeType={mimeType}
        onRetry={onRetry}
      />
    </OfficePreviewShell>
  )
}
