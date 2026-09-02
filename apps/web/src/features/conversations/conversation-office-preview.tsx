import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MessageCirclePlusIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { maximumOfficeAnnotationCount } from "@linksense/shared"

import type { ConversationFile } from "@/api/contracts"
import { useProductName } from "@/app/product-branding"
import {
  HTML_MIME_TYPE,
  type HtmlAnnotationMarker,
  type HtmlSelection,
} from "@/components/media/html-preview/html-preview.types"
import {
  ImagePreviewViewer,
  type ImagePreviewItem,
} from "@/components/media/image-preview"
import { downloadImagePreviewItem } from "@/components/media/image-preview-download"
import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import { OfficePreviewSuspenseBoundary } from "@/components/media/office-preview/office-preview-suspense-boundary"
import type {
  OfficeAnnotationNavigationRequest,
  OfficeDocumentState,
  OfficePreviewUpdateAction,
} from "@/components/media/office-preview/office-preview.types"
import type { PresentationSelection } from "@/components/media/presentation-preview/presentation-preview.types"
import type { PresentationAnnotationMarker } from "@/components/media/presentation-preview/presentation-preview.types"
import type { ReadOnlyFilePreviewDocumentState } from "@/components/media/read-only-file-preview/read-only-file-preview"
import type { SpreadsheetSelection } from "@/components/media/spreadsheet-preview/spreadsheet-preview.types"
import type { SpreadsheetAnnotationMarker } from "@/components/media/spreadsheet-preview/spreadsheet-preview.types"
import type { WordSelection } from "@/components/media/word-preview/word-preview.types"
import type { WordAnnotationMarker } from "@/components/media/word-preview/word-preview.types"
import { Button } from "@/components/ui/button"
import {
  OfficeAnnotationBatchTray,
  type OfficeAnnotationDraft,
} from "@/features/conversations/office-annotation-batch-tray"
import {
  getConversationFilePreviewKind,
  getConversationFilePreviewLoadMode,
  getConversationOfficeDocumentKind,
  type ConversationFilePreviewKind,
  type ConversationFilePreviewSource,
} from "@/features/conversations/conversation-file-preview"

const PresentationPreview = lazy(
  () => import("@/components/media/presentation-preview/presentation-preview")
)
const WordPreview = lazy(
  () => import("@/components/media/word-preview/word-preview")
)
const SpreadsheetPreview = lazy(
  () => import("@/components/media/spreadsheet-preview/spreadsheet-preview")
)
const HtmlPreview = lazy(
  () => import("@/components/media/html-preview/html-preview")
)
const ArchivePreview = lazy(
  () => import("@/components/media/archive-preview/archive-preview")
)
const ReadOnlyFilePreview = lazy(() =>
  import("@/components/media/read-only-file-preview/read-only-file-preview").then(
    ({ ReadOnlyFilePreview: Component }) => ({ default: Component })
  )
)

const textEncoder = new TextEncoder()

export type ConversationOfficeSelection =
  | Readonly<{ kind: "presentation"; selection: PresentationSelection }>
  | Readonly<{ kind: "word"; selection: WordSelection }>
  | Readonly<{ kind: "spreadsheet"; selection: SpreadsheetSelection }>
  | Readonly<{ kind: "html"; selection: HtmlSelection }>

export type ConversationOfficeAnnotationRequest = Readonly<{
  officeSelection: ConversationOfficeSelection
  request: string
}>

export type LoadConversationFileContent = (
  file: ConversationFile,
  signal: AbortSignal
) => Promise<Uint8Array>

export type LoadConversationOfficeDocument = LoadConversationFileContent

export type DownloadConversationOfficeDocument = (
  file: ConversationFile,
  content: Uint8Array
) => void

export type LoadConversationFilePreviewSource = (
  file: ConversationFile,
  signal: AbortSignal
) => Promise<ConversationFilePreviewSource>

export type DownloadConversationFilePreviewSource = (
  file: ConversationFile
) => void | Promise<void>

type ConversationOfficePreviewProps = Readonly<{
  file: ConversationFile
  loadContent: LoadConversationFileContent
  onAskSelection?: (
    file: ConversationFile,
    requests: readonly ConversationOfficeAnnotationRequest[]
  ) => Promise<void>
  selectionDisabled?: boolean
  updateAction?: OfficePreviewUpdateAction
  onDownload?: DownloadConversationOfficeDocument
  /**
   * Loads a short-lived browser URL for media previews. Content previews
   * continue to use `loadContent` so they stay in memory only.
   */
  loadPreviewSource?: LoadConversationFilePreviewSource
  /** Uses the host's current-page Blob download path for source-based previews. */
  onDownloadSource?: DownloadConversationFilePreviewSource
  onClose?: () => void
  animateEntrance?: boolean
}>

export function ConversationOfficePreview(
  props: ConversationOfficePreviewProps
) {
  return <ConversationOfficePreviewContent key={props.file.id} {...props} />
}

function ConversationOfficePreviewContent({
  file,
  loadContent,
  onAskSelection,
  selectionDisabled = false,
  updateAction,
  onDownload,
  loadPreviewSource,
  onDownloadSource,
  onClose,
  animateEntrance = true,
}: ConversationOfficePreviewProps) {
  const { t } = useTranslation()
  const productName = useProductName()
  const draftSequenceRef = useRef(0)
  const annotationNavigationSequenceRef = useRef(0)
  const draftsRef = useRef<readonly OfficeAnnotationDraft[]>([])
  const [annotationDrafts, setAnnotationDrafts] = useState<
    readonly OfficeAnnotationDraft[]
  >([])
  const [annotationMode, setAnnotationMode] = useState(false)
  const [annotationSessionKey, setAnnotationSessionKey] = useState(0)
  const [annotationNavigation, setAnnotationNavigation] =
    useState<OfficeAnnotationNavigationRequest | null>(null)
  const [loadKey, setLoadKey] = useState(0)
  const documentKind = getConversationOfficeDocumentKind(file)
  const previewKind = getConversationFilePreviewKind(file)
  const genericKind =
    previewKind && previewKind !== documentKind ? previewKind : null
  const requestKey = `office:${file.id}:${loadKey}`
  const [loadResult, setLoadResult] = useState<{
    requestKey: string
    document: OfficeDocumentState
  }>({ requestKey, document: { status: "loading" } })

  const document = useMemo<OfficeDocumentState>(
    () =>
      loadResult.requestKey === requestKey
        ? loadResult.document
        : { status: "loading" },
    [loadResult, requestKey]
  )

  useEffect(() => {
    if (!documentKind) return
    const controller = new AbortController()
    void loadContent(file, controller.signal)
      .then((content) => {
        if (controller.signal.aborted) return
        if (content.byteLength === 0) throw new Error("office_document_empty")
        setLoadResult({
          requestKey,
          document: { status: "ready", content },
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadResult({ requestKey, document: { status: "error" } })
        }
      })
    return () => controller.abort()
  }, [documentKind, file, loadContent, requestKey])

  const genericRequestKey = `generic:${file.id}:${loadKey}`
  const [genericLoadResult, setGenericLoadResult] = useState<{
    requestKey: string
    document: ReadOnlyFilePreviewDocumentState
  }>({ requestKey: genericRequestKey, document: { status: "loading" } })
  const genericDocument = useMemo(
    () =>
      genericLoadResult.requestKey === genericRequestKey
        ? genericLoadResult.document
        : { status: "loading" as const },
    [genericLoadResult, genericRequestKey]
  )
  const genericPreviewSource =
    genericDocument.status === "ready"
      ? (genericDocument.source as ConversationFilePreviewSource | undefined)
      : undefined

  useEffect(() => {
    if (!genericKind) return

    const controller = new AbortController()
    const loadMode = getConversationFilePreviewLoadMode(genericKind)

    if (loadMode === "source" && loadPreviewSource) {
      void Promise.resolve()
        .then(() => loadPreviewSource(file, controller.signal))
        .then((source) => {
          if (controller.signal.aborted || !source.url.trim()) {
            source.release?.()
            return
          }
          setGenericLoadResult({
            requestKey: genericRequestKey,
            document: { status: "ready", source },
          })
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setGenericLoadResult({
              requestKey: genericRequestKey,
              document: { status: "error" },
            })
          }
        })
      return () => controller.abort()
    }

    void loadContent(file, controller.signal)
      .then((content) => {
        if (controller.signal.aborted) return
        if (content.byteLength === 0) throw new Error("file_preview_empty")
        setGenericLoadResult({
          requestKey: genericRequestKey,
          document: { status: "ready", content },
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setGenericLoadResult({
            requestKey: genericRequestKey,
            document: { status: "error" },
          })
        }
      })
    return () => controller.abort()
  }, [file, genericKind, genericRequestKey, loadContent, loadPreviewSource])

  useEffect(
    () => () => {
      genericPreviewSource?.release?.()
    },
    [genericPreviewSource]
  )

  const handleDownload = useCallback(() => {
    if (document.status !== "ready") return
    onDownload?.(file, document.content)
  }, [document, file, onDownload])
  const handleGenericContentDownload = useCallback(() => {
    if (genericDocument.status !== "ready" || !genericDocument.content) return
    onDownload?.(file, genericDocument.content)
  }, [file, genericDocument, onDownload])
  const handleGenericSourceDownload = useCallback(() => {
    if (
      genericDocument.status !== "ready" ||
      !genericDocument.source ||
      !onDownloadSource
    ) {
      return
    }
    void onDownloadSource?.(file)
  }, [file, genericDocument, onDownloadSource])
  const commonProps = {
    document,
    fileName: file.name,
    onRetry: () => setLoadKey((current) => current + 1),
    onDownload:
      onDownload && document.status === "ready" ? handleDownload : undefined,
    updateAction,
    onClose,
  }
  const selectionActionText = {
    label: t("officePreview.askLinkSense", { productName }),
    shortcutLabel: t("officePreview.askShortcut"),
    disabled: selectionDisabled,
    disabledReason: t("officePreview.selectionUnavailableWhileBusy"),
    promptLabel: t("officePreview.selectionPromptLabel", { productName }),
    placeholder: t("officePreview.selectionPromptPlaceholder"),
    submitLabel: t("officePreview.selectionPromptSubmit"),
    errorMessage: t(
      annotationDrafts.length >= maximumOfficeAnnotationCount
        ? "officePreview.annotationBatch.limitReached"
        : "officePreview.selectionPromptError"
    ),
  }
  const presentationSelectionActionText = {
    label: t("presentation.askLinkSense", { productName }),
    shortcutLabel: t("presentation.askShortcut"),
    disabled: selectionDisabled,
    disabledReason: t("officePreview.selectionUnavailableWhileBusy"),
    promptLabel: t("presentation.selectionPromptLabel", { productName }),
    placeholder: t("presentation.selectionPromptPlaceholder"),
    submitLabel: t("presentation.selectionPromptSubmit"),
    errorMessage: t(
      annotationDrafts.length >= maximumOfficeAnnotationCount
        ? "officePreview.annotationBatch.limitReached"
        : "presentation.selectionPromptError"
    ),
  }
  const updateAnnotationDrafts = useCallback(
    (
      update: (
        current: readonly OfficeAnnotationDraft[]
      ) => readonly OfficeAnnotationDraft[]
    ) => {
      const next = update(draftsRef.current)
      draftsRef.current = next
      setAnnotationDrafts(next)
    },
    []
  )
  const addAnnotationDraft = useCallback(
    (officeSelection: ConversationOfficeSelection, request: string) => {
      if (draftsRef.current.length >= maximumOfficeAnnotationCount) {
        return Promise.reject(new Error("office_annotation_limit_reached"))
      }
      draftSequenceRef.current += 1
      updateAnnotationDrafts((current) => [
        ...current,
        {
          id: `${file.id}:${draftSequenceRef.current}`,
          officeSelection,
          request,
        },
      ])
      return Promise.resolve()
    },
    [file.id, updateAnnotationDrafts]
  )
  const submitPresentationSelection = useCallback(
    (selection: PresentationSelection, description: string) => {
      return addAnnotationDraft(
        { kind: "presentation", selection },
        description
      )
    },
    [addAnnotationDraft]
  )
  const submitWordSelection = useCallback(
    (selection: WordSelection, description: string) => {
      return addAnnotationDraft({ kind: "word", selection }, description)
    },
    [addAnnotationDraft]
  )
  const submitSpreadsheetSelection = useCallback(
    (selection: SpreadsheetSelection, description: string) => {
      return addAnnotationDraft({ kind: "spreadsheet", selection }, description)
    },
    [addAnnotationDraft]
  )
  const submitHtmlSelection = useCallback(
    (selection: HtmlSelection, description: string) => {
      return addAnnotationDraft({ kind: "html", selection }, description)
    },
    [addAnnotationDraft]
  )
  const annotationModeSupported =
    onAskSelection !== undefined &&
    (documentKind === "presentation" ||
      documentKind === "word" ||
      documentKind === "spreadsheet")
  const annotationModeControl = annotationModeSupported ? (
    <Button
      type="button"
      variant={annotationMode ? "secondary" : "ghost"}
      size="xs"
      className="office-preview-annotation-toggle"
      aria-label={t(
        annotationMode
          ? "officePreview.exitAnnotationMode"
          : "officePreview.enterAnnotationMode"
      )}
      aria-pressed={annotationMode}
      onClick={() => {
        setAnnotationSessionKey((current) => current + 1)
        setAnnotationMode((current) => !current)
      }}
    >
      <MessageCirclePlusIcon data-icon="inline-start" aria-hidden="true" />
      <span className="office-preview-annotation-toggle-label">
        {t(
          annotationMode ? "officePreview.annotating" : "officePreview.annotate"
        )}
      </span>
    </Button>
  ) : null
  const presentationAnnotationMarkers = useMemo<
    readonly PresentationAnnotationMarker[]
  >(
    () =>
      annotationDrafts.flatMap((draft, index) =>
        draft.officeSelection.kind === "presentation"
          ? [
              {
                id: draft.id,
                index: index + 1,
                selection: draft.officeSelection.selection,
              },
            ]
          : []
      ),
    [annotationDrafts]
  )
  const wordAnnotationMarkers = useMemo<readonly WordAnnotationMarker[]>(
    () =>
      annotationDrafts.flatMap((draft, index) =>
        draft.officeSelection.kind === "word"
          ? [
              {
                id: draft.id,
                index: index + 1,
                selection: draft.officeSelection.selection,
              },
            ]
          : []
      ),
    [annotationDrafts]
  )
  const spreadsheetAnnotationMarkers = useMemo<
    readonly SpreadsheetAnnotationMarker[]
  >(
    () =>
      annotationDrafts.flatMap((draft, index) =>
        draft.officeSelection.kind === "spreadsheet"
          ? [
              {
                id: draft.id,
                index: index + 1,
                selection: draft.officeSelection.selection,
              },
            ]
          : []
      ),
    [annotationDrafts]
  )
  const htmlAnnotationMarkers = useMemo<readonly HtmlAnnotationMarker[]>(
    () =>
      annotationDrafts.flatMap((draft, index) =>
        draft.officeSelection.kind === "html"
          ? [
              {
                id: draft.id,
                index: index + 1,
                selection: draft.officeSelection.selection,
              },
            ]
          : []
      ),
    [annotationDrafts]
  )
  const locateAnnotationDraft = useCallback((draft: OfficeAnnotationDraft) => {
    annotationNavigationSequenceRef.current += 1
    setAnnotationNavigation({
      id: draft.id,
      sequence: annotationNavigationSequenceRef.current,
    })
  }, [])

  const annotationBatchTray = onAskSelection ? (
    <OfficeAnnotationBatchTray
      key={file.id}
      drafts={annotationDrafts}
      submitting={selectionDisabled}
      onRemove={(draftId) =>
        updateAnnotationDrafts((current) =>
          current.filter((draft) => draft.id !== draftId)
        )
      }
      onClear={() => updateAnnotationDrafts(() => [])}
      onLocate={locateAnnotationDraft}
      onSend={async () => {
        const drafts = draftsRef.current
        if (drafts.length === 0) return
        await onAskSelection(
          file,
          drafts.map(({ officeSelection, request }) => ({
            officeSelection,
            request,
          }))
        )
        updateAnnotationDrafts(() => [])
      }}
    />
  ) : null

  const renderPreview = (paneClassName?: string) => {
    const initialLoadPaneClassName = animateEntrance ? paneClassName : undefined

    return documentKind === "presentation" ? (
      <PresentationPreview
        key={requestKey}
        {...commonProps}
        className={initialLoadPaneClassName}
        selectionAction={
          onAskSelection && annotationMode
            ? {
                ...presentationSelectionActionText,
                onSubmit: submitPresentationSelection,
              }
            : undefined
        }
        annotationControls={annotationModeControl}
        annotationMarkers={presentationAnnotationMarkers}
        annotationNavigation={annotationNavigation}
        floatingContent={annotationBatchTray}
      />
    ) : documentKind === "word" ? (
      <WordPreview
        key={requestKey}
        {...commonProps}
        className={initialLoadPaneClassName}
        selectionAction={
          onAskSelection && annotationMode
            ? { ...selectionActionText, onSubmit: submitWordSelection }
            : undefined
        }
        annotationControls={annotationModeControl}
        annotationSessionKey={annotationSessionKey}
        annotationMarkers={wordAnnotationMarkers}
        annotationNavigation={annotationNavigation}
        floatingContent={annotationBatchTray}
      />
    ) : documentKind === "spreadsheet" ? (
      <SpreadsheetPreview
        key={requestKey}
        {...commonProps}
        className={initialLoadPaneClassName}
        selectionAction={
          onAskSelection && annotationMode
            ? { ...selectionActionText, onSubmit: submitSpreadsheetSelection }
            : undefined
        }
        annotationControls={annotationModeControl}
        annotationSessionKey={annotationSessionKey}
        annotationMarkers={spreadsheetAnnotationMarkers}
        annotationNavigation={annotationNavigation}
        floatingContent={annotationBatchTray}
      />
    ) : documentKind === "html" ? (
      <HtmlPreview
        key={requestKey}
        {...commonProps}
        className={initialLoadPaneClassName}
        selectionAction={
          onAskSelection
            ? { ...selectionActionText, onSubmit: submitHtmlSelection }
            : undefined
        }
        annotationMarkers={htmlAnnotationMarkers}
        annotationNavigation={annotationNavigation}
        floatingContent={annotationBatchTray}
      />
    ) : documentKind === "archive" ? (
      <ArchivePreview
        key={requestKey}
        {...commonProps}
        className={initialLoadPaneClassName}
        mimeType={file.mime_type ?? "application/zip"}
      />
    ) : genericKind ? (
      <ReadOnlyFilePreview
        key={genericRequestKey}
        document={genericDocument}
        fileName={file.name}
        kind={
          genericKind as Exclude<
            ConversationFilePreviewKind,
            "presentation" | "word" | "spreadsheet" | "html" | "archive"
          >
        }
        mimeType={file.mime_type ?? "application/octet-stream"}
        onClose={onClose}
        onDownload={
          genericDocument.status === "ready" && genericDocument.content
            ? handleGenericContentDownload
            : genericDocument.status === "ready" &&
                genericDocument.source &&
                onDownloadSource
              ? handleGenericSourceDownload
              : undefined
        }
        onRetry={() => setLoadKey((current) => current + 1)}
        updateAction={updateAction}
        className={initialLoadPaneClassName}
      />
    ) : null
  }

  return (
    <OfficePreviewSuspenseBoundary
      key={file.id}
      fallback={(paneClassName) => (
        <OfficePreviewShell
          className={animateEntrance ? paneClassName : undefined}
          document={{ status: "loading" }}
          fileName={file.name}
          mimeType={file.mime_type ?? "application/octet-stream"}
          onClose={onClose}
        />
      )}
    >
      {renderPreview}
    </OfficePreviewSuspenseBoundary>
  )
}

export function ConversationHtmlCodePreview({
  html,
  fileName,
  onClose,
  animateEntrance = true,
}: Readonly<{
  html: string
  fileName: string
  onClose?: () => void
  animateEntrance?: boolean
}>) {
  const document = useMemo<OfficeDocumentState>(
    () => ({ status: "ready", content: textEncoder.encode(html) }),
    [html]
  )

  return (
    <OfficePreviewSuspenseBoundary
      fallback={(paneClassName) => (
        <OfficePreviewShell
          className={animateEntrance ? paneClassName : undefined}
          document={{ status: "loading" }}
          fileName={fileName}
          mimeType={HTML_MIME_TYPE}
          onClose={onClose}
        />
      )}
    >
      {(paneClassName) => (
        <HtmlPreview
          document={document}
          fileName={fileName}
          className={animateEntrance ? paneClassName : undefined}
          onClose={onClose}
        />
      )}
    </OfficePreviewSuspenseBoundary>
  )
}

export function ConversationImagePreview({
  item,
  onClose,
  onDownload,
  animateEntrance = true,
}: Readonly<{
  item: ImagePreviewItem
  onClose?: () => void
  onDownload?: (item: ImagePreviewItem) => void | Promise<void>
  animateEntrance?: boolean
}>) {
  const document = useMemo<Readonly<{ status: "ready" }>>(
    () => ({ status: "ready" }),
    []
  )
  const [downloadPending, setDownloadPending] = useState(false)
  const handleDownload = useCallback(() => {
    if (downloadPending || item.downloadable === false) return
    setDownloadPending(true)
    void downloadImagePreviewItem(item, onDownload)
      .catch(() => undefined)
      .finally(() => setDownloadPending(false))
  }, [downloadPending, item, onDownload])

  return (
    <OfficePreviewSuspenseBoundary
      fallback={(paneClassName) => (
        <OfficePreviewShell
          className={animateEntrance ? paneClassName : undefined}
          document={{ status: "loading" }}
          fileName={item.name}
          mimeType="image/*"
          onClose={onClose}
        />
      )}
    >
      {(paneClassName) => (
        <OfficePreviewShell
          document={document}
          fileName={item.name}
          mimeType="image/*"
          onClose={onClose}
          onDownload={item.downloadable === false ? undefined : handleDownload}
          className={animateEntrance ? paneClassName : undefined}
          bodyClassName="conversation-image-preview-body"
        >
          <ImagePreviewViewer
            key={`${item.id}:${item.src}`}
            item={item}
            className="conversation-image-preview-viewer"
          />
        </OfficePreviewShell>
      )}
    </OfficePreviewSuspenseBoundary>
  )
}

/** Generic name for the Office-like file preview entrypoint. */
export const ConversationFilePreview = ConversationOfficePreview
