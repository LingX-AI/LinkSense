import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"
import {
  setWasmSource,
  type XlsxCellStyleContext,
  type XlsxImageRect,
  type XlsxScrollerRenderProps,
  type XlsxViewerController,
  useXlsxViewerController,
  XlsxViewer,
} from "@extend-ai/react-xlsx"
import wasmUrl from "@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm?url"
import { useTranslation } from "react-i18next"

import { OfficeAnnotationNumberBubble } from "@/components/media/office-preview/office-annotation-number-bubble"
import { OfficeAnnotationHover } from "@/components/media/office-preview/office-annotation-hover"
import { officeDocumentSessionKey } from "@/components/media/office-preview/office-document-session"
import { OfficePreviewLoadingState } from "@/components/media/office-preview/office-preview-loading-state"
import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import { OfficePreviewZoomControls } from "@/components/media/office-preview/office-preview-zoom-controls"
import { OfficeSelectionPrompt } from "@/components/media/office-preview/office-selection-prompt"
import type {
  OfficeAnnotationNavigationRequest,
  OfficePreviewUpdateAction,
  OfficeSelectionAnchor,
} from "@/components/media/office-preview/office-preview.types"
import {
  XLSX_MIME_TYPE,
  type SpreadsheetAnnotationMarker,
  type SpreadsheetDocumentState,
  type SpreadsheetSelection,
  type SpreadsheetSelectionAction,
} from "@/components/media/spreadsheet-preview/spreadsheet-preview.types"
import {
  isZipXlsxPreviewCandidate,
  prepareXlsxPreviewBuffer,
} from "@/components/media/spreadsheet-preview/xlsx-preview-relationship-normalizer"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

setWasmSource(wasmUrl)

const selectionTextLimit = 4_000
const selectionFormulaLimit = 2_000
const allowSpreadsheetResizeInReadOnly = true
const spreadsheetWorkerLoadTimeoutMs = 15_000
const emptySpreadsheetAnnotationMarkers: readonly SpreadsheetAnnotationMarker[] =
  []
const preparedWorkbookBufferCache = new WeakMap<
  Uint8Array,
  Promise<ArrayBuffer>
>()

export type SpreadsheetPreviewProps = Readonly<{
  document: SpreadsheetDocumentState
  fileName: string
  selectionAction?: SpreadsheetSelectionAction
  annotationControls?: ReactNode
  annotationSessionKey?: number
  annotationMarkers?: readonly SpreadsheetAnnotationMarker[]
  annotationNavigation?: OfficeAnnotationNavigationRequest | null
  floatingContent?: ReactNode
  onRetry?: () => void
  onDownload?: () => void
  updateAction?: OfficePreviewUpdateAction
  onClose?: () => void
  className?: string
}>

function originalWorkbookBuffer(content: Uint8Array) {
  return new Uint8Array(content).buffer
}

function cachedPreparedWorkbookBuffer(content: Uint8Array) {
  const cached = preparedWorkbookBufferCache.get(content)
  if (cached) return cached

  const pending = prepareXlsxPreviewBuffer(content)
  preparedWorkbookBufferCache.set(content, pending)
  return pending
}

function useWorkbookBuffer(document: SpreadsheetDocumentState) {
  const content = document.status === "ready" ? document.content : undefined
  const immediateFile = useMemo(
    () =>
      content && !isZipXlsxPreviewCandidate(content)
        ? originalWorkbookBuffer(content)
        : undefined,
    [content]
  )
  const [prepared, setPrepared] = useState<Readonly<{
    content: Uint8Array
    file: ArrayBuffer
  }> | null>(null)

  useEffect(() => {
    if (!content || immediateFile) return

    let active = true
    void cachedPreparedWorkbookBuffer(content).then((file) => {
      if (active) setPrepared({ content, file })
    })
    return () => {
      active = false
    }
  }, [content, immediateFile])

  const preparedFile =
    prepared && prepared.content === content ? prepared.file : undefined
  const file = immediateFile ?? preparedFile
  return {
    file,
    isPreparing: Boolean(content) && !file,
  }
}

function spreadsheetSelectionKey(selection: SpreadsheetSelection) {
  switch (selection.type) {
    case "range":
      return `range:${selection.sheetIndex}:${selection.rangeAddress}`
    case "image":
      return `image:${selection.sheetIndex}:${selection.objectId}`
    case "chart":
      return `chart:${selection.sheetIndex}:${selection.objectId}:${selection.element?.kind ?? "chart"}`
  }
}

type SpreadsheetAnnotationFrame = Readonly<{
  id: string
  index: number
  partIndex: number
  left: number
  top: number
  width: number
  height: number
}>

type SpreadsheetGeometryResolver =
  XlsxScrollerRenderProps["getAnnotationGeometry"]
function spreadsheetGeometryTarget(
  selection: SpreadsheetSelection
): Parameters<SpreadsheetGeometryResolver>[0] {
  return selection.type === "range"
    ? {
        type: "range",
        range: {
          start: { row: selection.startRow, col: selection.startColumn },
          end: { row: selection.endRow, col: selection.endColumn },
        },
      }
    : { type: selection.type, id: selection.objectId }
}

function isSpreadsheetAnnotatedCell(
  markers: readonly SpreadsheetAnnotationMarker[],
  workbookSheetIndex: number,
  row: number,
  col: number
) {
  return markers.some((marker) => {
    const { selection } = marker
    return (
      selection.type === "range" &&
      selection.sheetIndex === workbookSheetIndex &&
      row >= Math.min(selection.startRow, selection.endRow) &&
      row <= Math.max(selection.startRow, selection.endRow) &&
      col >= Math.min(selection.startColumn, selection.endColumn) &&
      col <= Math.max(selection.startColumn, selection.endColumn)
    )
  })
}

function SpreadsheetWorkbookTabs({
  controller,
}: Readonly<{ controller: XlsxViewerController }>) {
  const { t } = useTranslation()

  if (controller.tabs.length <= 1) return null

  return (
    <div className="shrink-0 overflow-x-auto border-b border-divider bg-background px-2">
      <Tabs
        value={String(controller.activeTabIndex)}
        onValueChange={(value) => controller.setActiveTabIndex(Number(value))}
        className="w-max min-w-full gap-0"
      >
        <TabsList
          variant="line"
          aria-label={t("spreadsheetPreview.sheetTabsLabel")}
          className="min-h-8 justify-start gap-1 px-1"
        >
          {controller.tabs.map((tab, index) => (
            <TabsTrigger
              key={tab.id}
              value={String(index)}
              title={tab.name}
              className="min-h-7 flex-none rounded-md px-2.5 py-0.5 text-xs data-active:bg-[var(--app-user-surface)]! data-active:text-foreground! data-active:shadow-none data-active:after:hidden"
            >
              {tab.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}

export function SpreadsheetPreview(props: SpreadsheetPreviewProps) {
  return (
    <SpreadsheetPreviewSession
      key={officeDocumentSessionKey(props.fileName, props.document)}
      {...props}
    />
  )
}

function SpreadsheetPreviewSession({ ...props }: SpreadsheetPreviewProps) {
  const [loadMode, setLoadMode] = useState<"worker" | "main-thread">("worker")
  const handleWorkerUnavailable = useCallback(() => {
    setLoadMode("main-thread")
  }, [])

  return (
    <SpreadsheetPreviewControllerSession
      key={loadMode}
      {...props}
      useWorker={loadMode === "worker"}
      onWorkerUnavailable={handleWorkerUnavailable}
    />
  )
}

function SpreadsheetPreviewControllerSession({
  document,
  fileName,
  selectionAction,
  annotationControls,
  annotationSessionKey = 0,
  annotationMarkers = emptySpreadsheetAnnotationMarkers,
  annotationNavigation,
  floatingContent,
  onRetry,
  onDownload,
  updateAction,
  onClose,
  className,
  useWorker,
  onWorkerUnavailable,
}: SpreadsheetPreviewProps &
  Readonly<{
    useWorker: boolean
    onWorkerUnavailable: () => void
  }>) {
  const { t } = useTranslation()
  const paneRef = useRef<HTMLElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const geometryResolverRef = useRef<SpreadsheetGeometryResolver | null>(null)
  const hoverTargetResolverRef = useRef<
    XlsxScrollerRenderProps["getAnnotationTargetAtPoint"] | null
  >(null)
  const handledAnnotationNavigationSequenceRef = useRef<number | null>(null)
  const [interactionVersion, setInteractionVersion] = useState(0)
  const [interactionSessionKey, setInteractionSessionKey] = useState<
    number | null
  >(null)
  const [annotationFrames, setAnnotationFrames] = useState<
    readonly SpreadsheetAnnotationFrame[]
  >([])
  const [selectionAnchor, setSelectionAnchor] =
    useState<OfficeSelectionAnchor | null>(null)
  const [selectionFillFrames, setSelectionFillFrames] = useState<
    readonly XlsxImageRect[]
  >([])
  const selectionEnabled = Boolean(selectionAction)
  const { file, isPreparing } = useWorkbookBuffer(document)
  const controller = useXlsxViewerController({
    file,
    fileName,
    readOnly: true,
    allowResizeInReadOnly: allowSpreadsheetResizeInReadOnly,
    useWorker,
  })

  useEffect(() => {
    if (!useWorker || document.status !== "ready" || isPreparing) return
    if (controller.error) {
      onWorkerUnavailable()
      return
    }
    if (!controller.isLoading) return

    const timeout = window.setTimeout(
      onWorkerUnavailable,
      spreadsheetWorkerLoadTimeoutMs
    )
    return () => window.clearTimeout(timeout)
  }, [
    controller.error,
    controller.isLoading,
    document.status,
    isPreparing,
    onWorkerUnavailable,
    useWorker,
  ])

  const capturePointerSelection = useCallback(() => {
    if (!selectionEnabled) return
    setInteractionSessionKey(annotationSessionKey)
    setInteractionVersion((current) => current + 1)
  }, [annotationSessionKey, selectionEnabled])

  const captureKeyboardSelection = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!selectionEnabled) return
      if (
        event.key.startsWith("Arrow") ||
        event.key === "Enter" ||
        event.key === "Tab" ||
        event.key === " "
      ) {
        setInteractionSessionKey(annotationSessionKey)
        setInteractionVersion((current) => current + 1)
      }
    },
    [annotationSessionKey, selectionEnabled]
  )

  const selection = ((): SpreadsheetSelection | null => {
    if (
      !selectionEnabled ||
      interactionVersion === 0 ||
      interactionSessionKey !== annotationSessionKey ||
      !controller.activeSheet
    ) {
      return null
    }

    const location = {
      sheetName: controller.activeSheet.name,
      sheetIndex: controller.activeSheetIndex,
    }

    if (controller.selectedChart) {
      const formula = controller.selectedChartFormula?.trim()
      return {
        ...location,
        type: "chart",
        objectId: controller.selectedChart.id,
        ...(controller.selectedChart.name
          ? { name: controller.selectedChart.name }
          : {}),
        ...(controller.selectedChart.title
          ? { title: controller.selectedChart.title }
          : {}),
        chartType: controller.selectedChart.chartType,
        anchor: controller.selectedChart.anchor,
        ...(controller.selectedChartElement
          ? { element: controller.selectedChartElement }
          : {}),
        ...(formula
          ? { formula: formula.slice(0, selectionFormulaLimit) }
          : {}),
      }
    }

    if (controller.selectedImage) {
      return {
        ...location,
        type: "image",
        objectId: controller.selectedImage.id,
        ...(controller.selectedImage.name
          ? { name: controller.selectedImage.name }
          : {}),
        ...(controller.selectedImage.description
          ? { description: controller.selectedImage.description }
          : {}),
        anchor: controller.selectedImage.anchor,
      }
    }

    if (controller.selection && controller.selectedRangeAddress) {
      const clipboardText = controller.getClipboardData()?.text.trim()
      const formula = controller.selectedFormula.trim()
      return {
        ...location,
        type: "range",
        rangeAddress: controller.selectedRangeAddress,
        ...(controller.activeCellAddress
          ? { activeCellAddress: controller.activeCellAddress }
          : {}),
        startRow: controller.selection.start.row,
        startColumn: controller.selection.start.col,
        endRow: controller.selection.end.row,
        endColumn: controller.selection.end.col,
        ...(clipboardText
          ? { selectedText: clipboardText.slice(0, selectionTextLimit) }
          : {}),
        ...(formula
          ? { selectedFormula: formula.slice(0, selectionFormulaLimit) }
          : {}),
      }
    }

    return null
  })()

  useEffect(() => {
    let animationFrame: number | null = null
    const refresh = () => {
      const resolve = geometryResolverRef.current
      const scroller = scrollerRef.current
      const frames =
        resolve && scroller
          ? annotationMarkers.flatMap((marker) => {
              if (marker.selection.sheetIndex !== controller.activeSheetIndex)
                return []
              const geometry = resolve(
                spreadsheetGeometryTarget(marker.selection)
              )
              return (
                geometry?.viewportRects.map((rect, partIndex) => ({
                  ...rect,
                  id: marker.id,
                  index: marker.index,
                  partIndex,
                })) ?? []
              )
            })
          : []
      setAnnotationFrames((current) =>
        JSON.stringify(current) === JSON.stringify(frames) ? current : frames
      )
      const rects =
        selection && resolve
          ? resolve(spreadsheetGeometryTarget(selection))?.viewportRects
          : undefined
      const fillFrames =
        selection &&
        selection.type !== "range" &&
        !annotationMarkers.some(
          (marker) =>
            marker.selection.sheetIndex === selection.sheetIndex &&
            marker.selection.type === selection.type &&
            marker.selection.objectId === selection.objectId
        )
          ? (rects ?? [])
          : []
      setSelectionFillFrames((current) =>
        JSON.stringify(current) === JSON.stringify(fillFrames)
          ? current
          : fillFrames
      )
      const bounds = scroller?.getBoundingClientRect()
      const anchor =
        rects?.length && bounds
          ? {
              left:
                bounds.left +
                Math.max(...rects.map((rect) => rect.left + rect.width)),
              top:
                bounds.top +
                Math.max(...rects.map((rect) => rect.top + rect.height)),
            }
          : null
      setSelectionAnchor((current) =>
        current?.left === anchor?.left && current?.top === anchor?.top
          ? current
          : anchor
      )
      if (annotationMarkers.length || selection)
        animationFrame = window.requestAnimationFrame(refresh)
    }
    refresh()
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
    }
  }, [
    annotationMarkers,
    controller.activeSheetIndex,
    controller.zoomScale,
    selection,
  ])

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
    if (!marker) return

    if (controller.activeSheetIndex !== marker.selection.sheetIndex) {
      const tabIndex = controller.tabs.findIndex(
        (tab) =>
          tab.kind === "sheet" && tab.sheetIndex === marker.selection.sheetIndex
      )
      if (tabIndex >= 0) controller.setActiveTabIndex(tabIndex)
      return
    }

    const scroller = scrollerRef.current
    const geometry = geometryResolverRef.current?.(
      spreadsheetGeometryTarget(marker.selection)
    )
    if (!scroller || !geometry) return
    const rect = geometry.contentRect
    const nextScrollLeft = Math.max(
      0,
      rect.left + rect.width / 2 - scroller.clientWidth / 2
    )
    const nextScrollTop = Math.max(
      0,
      rect.top + rect.height / 2 - scroller.clientHeight / 2
    )
    handledAnnotationNavigationSequenceRef.current =
      annotationNavigation.sequence
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({
        left: nextScrollLeft,
        top: nextScrollTop,
        behavior: "smooth",
      })
    } else {
      scroller.scrollLeft = nextScrollLeft
      scroller.scrollTop = nextScrollTop
    }
  }, [
    annotationMarkers,
    annotationNavigation,
    controller,
    controller.activeSheet,
    controller.activeSheetIndex,
    controller.setActiveTabIndex,
    controller.tabs,
    controller.zoomScale,
  ])

  const getAnnotatedCellStyle = useCallback(
    (context: XlsxCellStyleContext) =>
      isSpreadsheetAnnotatedCell(
        annotationMarkers,
        context.workbookSheetIndex,
        context.cell.row,
        context.cell.col
      )
        ? {
            backgroundColor:
              "color-mix(in srgb, var(--app-selection) 12%, transparent)",
          }
        : undefined,
    [annotationMarkers]
  )

  const renderSpreadsheetScroller = useCallback(
    ({
      children,
      viewportProps,
      getAnnotationGeometry,
      getAnnotationTargetAtPoint,
    }: XlsxScrollerRenderProps) => {
      const { ref, ...restViewportProps } = viewportProps
      return (
        <div
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
          data-testid="spreadsheet-annotation-viewport"
        >
          <div
            {...restViewportProps}
            ref={(element) => {
              scrollerRef.current = element
              geometryResolverRef.current = element
                ? getAnnotationGeometry
                : null
              hoverTargetResolverRef.current = element
                ? getAnnotationTargetAtPoint
                : null
              if (typeof ref === "function") {
                ref(element)
              } else if (ref) {
                ;(ref as { current: HTMLDivElement | null }).current = element
              }
            }}
          >
            {children}
          </div>
          {selectionFillFrames.length > 0 && (
            <div
              className="office-annotation-overlay"
              data-testid="spreadsheet-selection-fill-overlay"
              aria-hidden="true"
            >
              {selectionFillFrames.map((rect) => (
                <span
                  key={`${rect.left}:${rect.top}:${rect.width}:${rect.height}`}
                  className="absolute bg-[color-mix(in_srgb,var(--app-selection)_12%,transparent)]"
                  style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  }}
                />
              ))}
            </div>
          )}
          <OfficeAnnotationHover
            scopeRef={scrollerRef}
            enabled={selectionEnabled}
            resolve={(point) => {
              const target = hoverTargetResolverRef.current?.(point.x, point.y)
              const scroller = scrollerRef.current
              if (!target || !scroller) return []
              const selectedMarkers = selection
                ? [...annotationMarkers, { id: "active", index: 0, selection }]
                : annotationMarkers
              if (
                target.type === "range"
                  ? isSpreadsheetAnnotatedCell(
                      selectedMarkers,
                      controller.activeSheetIndex,
                      target.range.start.row,
                      target.range.start.col
                    )
                  : selectedMarkers.some(
                      (marker) =>
                        marker.selection.sheetIndex ===
                          controller.activeSheetIndex &&
                        marker.selection.type === target.type &&
                        marker.selection.objectId === target.id
                    )
              )
                return []
              const bounds = scroller.getBoundingClientRect()
              return (
                geometryResolverRef
                  .current?.(target)
                  ?.viewportRects.map((rect) => ({
                    ...rect,
                    left: bounds.left + rect.left,
                    top: bounds.top + rect.top,
                  })) ?? []
              )
            }}
          />
          {annotationFrames.length > 0 && (
            <div
              className="office-annotation-overlay spreadsheet-preview-annotation-overlay"
              data-testid="spreadsheet-annotation-overlay"
              aria-hidden="true"
            >
              {annotationFrames.map((frame) => (
                <span
                  key={`${frame.id}:${frame.partIndex}`}
                  className="office-annotation-frame spreadsheet-preview-annotation-frame"
                  data-spreadsheet-annotation-frame={frame.id}
                  style={{
                    left: frame.left,
                    top: frame.top,
                    width: frame.width,
                    height: frame.height,
                  }}
                >
                  <OfficeAnnotationNumberBubble
                    index={frame.index}
                    className="spreadsheet-preview-annotation-index"
                  />
                </span>
              ))}
            </div>
          )}
        </div>
      )
    },
    [
      annotationFrames,
      selectionFillFrames,
      selectionEnabled,
      selection,
      annotationMarkers,
      controller.activeSheetIndex,
    ]
  )

  const shellDocument = useMemo<SpreadsheetDocumentState>(() => {
    if (document.status !== "ready") return document
    if (isPreparing) return { status: "loading" }
    if (controller.error) {
      return useWorker ? { status: "loading" } : { status: "error" }
    }
    if (controller.isLoading) return { status: "loading" }
    return document
  }, [controller.error, controller.isLoading, document, isPreparing, useWorker])

  return (
    <OfficePreviewShell
      ref={paneRef}
      document={shellDocument}
      fileName={fileName}
      mimeType={XLSX_MIME_TYPE}
      className={className}
      bodyClassName="spreadsheet-preview-body"
      onRetry={onRetry}
      onDownload={onDownload}
      updateAction={updateAction}
      onClose={onClose}
      floatingContent={floatingContent}
      controls={
        <>
          {annotationControls}
          <OfficePreviewZoomControls
            zoomPercent={Math.round(controller.zoomScale)}
            zoomOutLabel={t("spreadsheetPreview.zoomOut")}
            zoomInLabel={t("spreadsheetPreview.zoomIn")}
            resetZoomLabel={t("spreadsheetPreview.resetZoom")}
            canZoomOut={controller.canZoomOut}
            canZoomIn={controller.canZoomIn}
            onZoomOut={controller.zoomOut}
            onZoomIn={controller.zoomIn}
            onResetZoom={controller.resetZoom}
          />
        </>
      }
    >
      {document.status === "ready" && !isPreparing && !controller.error && (
        <div
          ref={viewerRef}
          className="spreadsheet-preview-viewer"
          onPointerUpCapture={
            selectionEnabled ? capturePointerSelection : undefined
          }
          onKeyUpCapture={
            selectionEnabled ? captureKeyboardSelection : undefined
          }
        >
          <XlsxViewer
            controller={controller}
            allowResizeInReadOnly={allowSpreadsheetResizeInReadOnly}
            className="spreadsheet-preview-grid"
            getCellStyle={getAnnotatedCellStyle}
            height="100%"
            loadingState={
              <OfficePreviewLoadingState label={t("officePreview.loading")} />
            }
            readOnly
            selectionColor="var(--app-selection)"
            selectionFillColor="color-mix(in srgb, var(--app-selection) 12%, transparent)"
            renderScroller={renderSpreadsheetScroller}
            rounded={false}
            showDefaultToolbar={false}
            toolbar={(viewerController) => (
              <SpreadsheetWorkbookTabs controller={viewerController} />
            )}
            isDark={globalThis.document.documentElement.classList.contains(
              "dark"
            )}
          />
        </div>
      )}
      {selection && selectionAction && (
        <OfficeSelectionPrompt
          key={spreadsheetSelectionKey(selection)}
          scopeRef={paneRef}
          selection={selection}
          anchor={selectionAnchor}
          action={selectionAction}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {selection
          ? t(`spreadsheetPreview.selectionStatus.${selection.type}`, {
              sheet: selection.sheetName,
              address: selection.type === "range" ? selection.rangeAddress : "",
              name:
                selection.type === "range"
                  ? ""
                  : (selection.name ?? selection.objectId),
            })
          : ""}
      </span>
    </OfficePreviewShell>
  )
}

export default SpreadsheetPreview
