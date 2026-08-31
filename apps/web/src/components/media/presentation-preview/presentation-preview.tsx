import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import { OfficePreviewZoomControls } from "@/components/media/office-preview/office-preview-zoom-controls"
import { OfficeSelectionPrompt } from "@/components/media/office-preview/office-selection-prompt"
import type {
  OfficeAnnotationNavigationRequest,
  OfficePreviewUpdateAction,
} from "@/components/media/office-preview/office-preview.types"
import {
  PptxViewerAdapter,
  type PptxViewerAdapterHandle,
  type PresentationSelectionAnchor,
} from "@/components/media/presentation-preview/pptx-viewer-adapter"
import type {
  PresentationAnnotationMarker,
  PresentationDocumentState,
  PresentationSelection,
  PresentationSelectionAction,
} from "@/components/media/presentation-preview/presentation-preview.types"
import { PPTX_MIME_TYPE } from "@/components/media/presentation-preview/presentation-preview.types"

const emptyPresentationAnnotationMarkers: readonly PresentationAnnotationMarker[] =
  []

export type PresentationPreviewProps = Readonly<{
  document: PresentationDocumentState
  fileName: string
  selectionAction?: PresentationSelectionAction
  annotationControls?: ReactNode
  annotationMarkers?: readonly PresentationAnnotationMarker[]
  annotationNavigation?: OfficeAnnotationNavigationRequest | null
  floatingContent?: ReactNode
  onRetry?: () => void
  onDownload?: () => void
  updateAction?: OfficePreviewUpdateAction
  onClose?: () => void
  className?: string
}>

export function PresentationPreview({
  document,
  fileName,
  selectionAction,
  annotationControls,
  annotationMarkers = emptyPresentationAnnotationMarkers,
  annotationNavigation,
  floatingContent,
  onRetry,
  onDownload,
  updateAction,
  onClose,
  className,
}: PresentationPreviewProps) {
  const { t } = useTranslation()
  const paneRef = useRef<HTMLElement>(null)
  const viewerRef = useRef<PptxViewerAdapterHandle>(null)
  const handledAnnotationNavigationSequenceRef = useRef<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [slideIndex, setSlideIndex] = useState(0)
  const [slideCount, setSlideCount] = useState(0)
  const [selection, setSelection] = useState<PresentationSelection | null>(null)
  const [selectionAnchor, setSelectionAnchor] =
    useState<PresentationSelectionAnchor | null>(null)
  const selectionKey = selection
    ? `${selection.slideIndex}:${selection.elementIds.join("\u0000")}`
    : null

  useEffect(() => {
    if (
      !annotationNavigation ||
      handledAnnotationNavigationSequenceRef.current ===
        annotationNavigation.sequence
    ) {
      return
    }
    const marker = annotationMarkers.find(
      (candidate) => candidate.id === annotationNavigation.id
    )
    const viewer = viewerRef.current
    if (!marker || !viewer) return
    handledAnnotationNavigationSequenceRef.current =
      annotationNavigation.sequence
    viewer.goToSlide(marker.selection.slideIndex)
  }, [annotationMarkers, annotationNavigation])

  return (
    <OfficePreviewShell
      ref={paneRef}
      document={document}
      fileName={fileName}
      mimeType={PPTX_MIME_TYPE}
      className={className}
      onRetry={onRetry}
      onDownload={onDownload}
      updateAction={updateAction}
      onClose={onClose}
      floatingContent={floatingContent}
      controls={
        <>
          {annotationControls}
          <OfficePreviewZoomControls
            zoomPercent={Math.round(zoom * 100)}
            zoomOutLabel={t("presentation.zoomOut")}
            zoomInLabel={t("presentation.zoomIn")}
            resetZoomLabel={t("presentation.resetZoom")}
            onZoomOut={() => viewerRef.current?.zoomOut()}
            onZoomIn={() => viewerRef.current?.zoomIn()}
            onResetZoom={() => viewerRef.current?.zoomReset()}
            trailing={
              slideCount > 0 ? (
                <span className="office-preview-location-count">
                  {t("presentation.slideCount", {
                    current: slideIndex + 1,
                    total: slideCount,
                  })}
                </span>
              ) : null
            }
          />
        </>
      }
    >
      <PptxViewerAdapter
        ref={viewerRef}
        content={
          document.status === "ready" ? document.content : new Uint8Array()
        }
        fileName={fileName}
        selectElementLabel={t("presentation.selectElement")}
        selectionEnabled={Boolean(selectionAction)}
        annotationMarkers={annotationMarkers}
        onSelectionChange={setSelection}
        onSelectionAnchorChange={setSelectionAnchor}
        onActiveSlideChange={setSlideIndex}
        onZoomChange={setZoom}
        onSlideCountChange={setSlideCount}
      />
      {selection && selectionAction && (
        <OfficeSelectionPrompt
          key={selectionKey}
          scopeRef={paneRef}
          selection={selection}
          anchor={selectionAnchor}
          action={selectionAction}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {selection
          ? t("presentation.selectionStatus", {
              count: selection.elementIds.length,
              slide: selection.slideNumber,
            })
          : ""}
      </span>
    </OfficePreviewShell>
  )
}

export default PresentationPreview
