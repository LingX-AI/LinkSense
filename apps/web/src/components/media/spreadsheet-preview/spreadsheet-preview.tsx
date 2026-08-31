import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import {
  setWasmSource,
  type XlsxCellStyleContext,
  type XlsxImageAnchor,
  type XlsxScrollerRenderProps,
  type XlsxSheetData,
  type XlsxViewerController,
  useXlsxViewerController,
  XlsxViewer,
} from "@extend-ai/react-xlsx"
import wasmUrl from "@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm?url"
import { useTranslation } from "react-i18next"

import { OfficeAnnotationNumberBubble } from "@/components/media/office-preview/office-annotation-number-bubble"
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
const spreadsheetHeaderHeightPx = 24
const spreadsheetRowHeaderWidthPx = 40
const spreadsheetEmuPerPixel = 9_525
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

type SpreadsheetViewport = Readonly<{
  left: number
  top: number
  width: number
  height: number
}>

type SpreadsheetAnnotationFrame = Readonly<{
  id: string
  index: number
  left: number
  top: number
  width: number
  height: number
}>

const emptySpreadsheetViewport: SpreadsheetViewport = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
}

function emuToPixels(value: number) {
  return value / spreadsheetEmuPerPixel
}

function spreadsheetAxisSize(
  sheet: XlsxSheetData,
  axis: "row" | "column",
  index: number
) {
  if (axis === "row") {
    return (
      sheet.rowHeightOverridesPx[index] ??
      sheet.rowHeights[sheet.visibleRows.indexOf(index)] ??
      sheet.defaultRowHeightPx
    )
  }
  return (
    sheet.colWidthOverridesPx[index] ??
    sheet.colWidths[sheet.visibleCols.indexOf(index)] ??
    sheet.defaultColWidthPx
  )
}

function spreadsheetAxisOffset(
  sheet: XlsxSheetData,
  axis: "row" | "column",
  index: number,
  zoomFactor: number
) {
  const hidden = new Set(axis === "row" ? sheet.hiddenRows : sheet.hiddenCols)
  let offset = 0
  for (let current = 0; current < index; current += 1) {
    if (!hidden.has(current)) {
      offset += spreadsheetAxisSize(sheet, axis, current) * zoomFactor
    }
  }
  return offset
}

function spreadsheetAxisSpan(
  sheet: XlsxSheetData,
  axis: "row" | "column",
  start: number,
  end: number,
  zoomFactor: number
) {
  const hidden = new Set(axis === "row" ? sheet.hiddenRows : sheet.hiddenCols)
  let span = 0
  for (let current = start; current <= end; current += 1) {
    if (!hidden.has(current)) {
      span += spreadsheetAxisSize(sheet, axis, current) * zoomFactor
    }
  }
  return span
}

function resolveSpreadsheetAnchorFrame(
  sheet: XlsxSheetData,
  anchor: XlsxImageAnchor,
  viewport: SpreadsheetViewport,
  zoomFactor: number
) {
  const headerHeight = spreadsheetHeaderHeightPx * zoomFactor
  const rowHeaderWidth = spreadsheetRowHeaderWidthPx * zoomFactor
  const markerLeft = (col: number, colOffsetEmu: number) =>
    rowHeaderWidth +
    spreadsheetAxisOffset(sheet, "column", col, zoomFactor) +
    emuToPixels(colOffsetEmu) * zoomFactor
  const markerTop = (row: number, rowOffsetEmu: number) =>
    headerHeight +
    spreadsheetAxisOffset(sheet, "row", row, zoomFactor) +
    emuToPixels(rowOffsetEmu) * zoomFactor

  const rect =
    anchor.kind === "absolute"
      ? {
          left: rowHeaderWidth + emuToPixels(anchor.positionEmu.x) * zoomFactor,
          top: headerHeight + emuToPixels(anchor.positionEmu.y) * zoomFactor,
          width: Math.max(1, emuToPixels(anchor.sizeEmu.cx) * zoomFactor),
          height: Math.max(1, emuToPixels(anchor.sizeEmu.cy) * zoomFactor),
        }
      : anchor.kind === "one-cell"
        ? {
            left: markerLeft(anchor.from.col, anchor.from.colOffsetEmu),
            top: markerTop(anchor.from.row, anchor.from.rowOffsetEmu),
            width: Math.max(1, emuToPixels(anchor.sizeEmu.cx) * zoomFactor),
            height: Math.max(1, emuToPixels(anchor.sizeEmu.cy) * zoomFactor),
          }
        : (() => {
            const left = markerLeft(anchor.from.col, anchor.from.colOffsetEmu)
            const top = markerTop(anchor.from.row, anchor.from.rowOffsetEmu)
            const right = markerLeft(anchor.to.col, anchor.to.colOffsetEmu)
            const bottom = markerTop(anchor.to.row, anchor.to.rowOffsetEmu)
            return {
              left,
              top,
              width: Math.max(1, right - left),
              height: Math.max(1, bottom - top),
            }
          })()

  return {
    left: rect.left - viewport.left,
    top: rect.top - viewport.top,
    width: rect.width,
    height: rect.height,
  }
}

function spreadsheetSelectionCenter(
  sheet: XlsxSheetData,
  selection: SpreadsheetSelection,
  zoomFactor: number
) {
  if (selection.type === "range") {
    const startRow = Math.min(selection.startRow, selection.endRow)
    const endRow = Math.max(selection.startRow, selection.endRow)
    const startColumn = Math.min(selection.startColumn, selection.endColumn)
    const endColumn = Math.max(selection.startColumn, selection.endColumn)
    return {
      left:
        spreadsheetRowHeaderWidthPx * zoomFactor +
        spreadsheetAxisOffset(sheet, "column", startColumn, zoomFactor) +
        spreadsheetAxisSpan(
          sheet,
          "column",
          startColumn,
          endColumn,
          zoomFactor
        ) /
          2,
      top:
        spreadsheetHeaderHeightPx * zoomFactor +
        spreadsheetAxisOffset(sheet, "row", startRow, zoomFactor) +
        spreadsheetAxisSpan(sheet, "row", startRow, endRow, zoomFactor) / 2,
    }
  }
  if (!selection.anchor) return null
  const frame = resolveSpreadsheetAnchorFrame(
    sheet,
    selection.anchor,
    emptySpreadsheetViewport,
    zoomFactor
  )
  return {
    left: frame.left + frame.width / 2,
    top: frame.top + frame.height / 2,
  }
}

function resolveSpreadsheetRangeFrame(
  sheet: XlsxSheetData,
  selection: Extract<SpreadsheetSelection, { type: "range" }>,
  viewport: SpreadsheetViewport,
  zoomFactor: number
): Omit<SpreadsheetAnnotationFrame, "id" | "index"> | null {
  const startRow = Math.min(selection.startRow, selection.endRow)
  const endRow = Math.max(selection.startRow, selection.endRow)
  const startColumn = Math.min(selection.startColumn, selection.endColumn)
  const endColumn = Math.max(selection.startColumn, selection.endColumn)
  const headerHeight = spreadsheetHeaderHeightPx * zoomFactor
  const rowHeaderWidth = spreadsheetRowHeaderWidthPx * zoomFactor
  const rawLeft =
    rowHeaderWidth +
    spreadsheetAxisOffset(sheet, "column", startColumn, zoomFactor) -
    viewport.left
  const rawTop =
    headerHeight +
    spreadsheetAxisOffset(sheet, "row", startRow, zoomFactor) -
    viewport.top
  const rawRight =
    rawLeft +
    spreadsheetAxisSpan(sheet, "column", startColumn, endColumn, zoomFactor)
  const rawBottom =
    rawTop + spreadsheetAxisSpan(sheet, "row", startRow, endRow, zoomFactor)

  const left = Math.max(rowHeaderWidth, rawLeft)
  const top = Math.max(headerHeight, rawTop)
  const right = Math.min(viewport.width, rawRight)
  const bottom = Math.min(viewport.height, rawBottom)
  if (right <= left || bottom <= top) return null
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  }
}

function resolveSpreadsheetAnnotationFrames(
  sheet: XlsxSheetData | null,
  activeSheetIndex: number,
  markers: readonly SpreadsheetAnnotationMarker[],
  viewport: SpreadsheetViewport,
  zoomScale: number
): readonly SpreadsheetAnnotationFrame[] {
  if (!sheet || markers.length === 0 || viewport.width <= 0) return []
  const zoomFactor = Math.max(0.1, zoomScale / 100)
  return markers.flatMap((marker) => {
    const { selection } = marker
    if (selection.sheetIndex !== activeSheetIndex) return []
    const frame =
      selection.type === "range"
        ? resolveSpreadsheetRangeFrame(sheet, selection, viewport, zoomFactor)
        : selection.anchor
          ? resolveSpreadsheetAnchorFrame(
              sheet,
              selection.anchor,
              viewport,
              zoomFactor
            )
          : null
    return frame
      ? [
          {
            ...frame,
            id: marker.id,
            index: marker.index,
          },
        ]
      : []
  })
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
  const viewportFrameRef = useRef<number | null>(null)
  const handledAnnotationNavigationSequenceRef = useRef<number | null>(null)
  const [selectionAnchor, setSelectionAnchor] =
    useState<OfficeSelectionAnchor | null>(null)
  const [interactionVersion, setInteractionVersion] = useState(0)
  const [interactionSessionKey, setInteractionSessionKey] = useState<
    number | null
  >(null)
  const [spreadsheetViewport, setSpreadsheetViewport] =
    useState<SpreadsheetViewport>(emptySpreadsheetViewport)
  const selectionEnabled = Boolean(selectionAction)
  const { file, isPreparing } = useWorkbookBuffer(document)
  const controller = useXlsxViewerController({
    file,
    fileName,
    readOnly: true,
    allowResizeInReadOnly: allowSpreadsheetResizeInReadOnly,
    useWorker,
  })

  const updateSpreadsheetViewport = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      setSpreadsheetViewport((current) =>
        current === emptySpreadsheetViewport
          ? current
          : emptySpreadsheetViewport
      )
      return
    }
    const nextViewport = {
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
      width: scroller.clientWidth,
      height: scroller.clientHeight,
    }
    setSpreadsheetViewport((current) =>
      current.left === nextViewport.left &&
      current.top === nextViewport.top &&
      current.width === nextViewport.width &&
      current.height === nextViewport.height
        ? current
        : nextViewport
    )
  }, [])

  const scheduleSpreadsheetViewportUpdate = useCallback(() => {
    if (viewportFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportFrameRef.current)
    }
    viewportFrameRef.current = window.requestAnimationFrame(() => {
      viewportFrameRef.current = null
      updateSpreadsheetViewport()
    })
  }, [updateSpreadsheetViewport])

  useEffect(() => {
    scheduleSpreadsheetViewportUpdate()
    const scroller = scrollerRef.current
    const viewer = viewerRef.current
    if (!scroller && !viewer) return
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleSpreadsheetViewportUpdate)
    if (scroller) resizeObserver?.observe(scroller)
    if (viewer) resizeObserver?.observe(viewer)
    return () => {
      resizeObserver?.disconnect()
      if (viewportFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFrameRef.current)
        viewportFrameRef.current = null
      }
    }
  }, [
    controller.activeSheet,
    controller.activeSheetIndex,
    controller.zoomScale,
    isPreparing,
    scheduleSpreadsheetViewportUpdate,
  ])

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

  const capturePointerAnchor = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!selectionEnabled) return
      const surfaceBounds = event.currentTarget.getBoundingClientRect()
      setSelectionAnchor({
        left: event.clientX - surfaceBounds.left,
        top: event.clientY - surfaceBounds.top,
      })
      setInteractionSessionKey(annotationSessionKey)
      setInteractionVersion((current) => current + 1)
    },
    [annotationSessionKey, selectionEnabled]
  )

  const captureKeyboardSelection = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!selectionEnabled) return
      if (
        event.key.startsWith("Arrow") ||
        event.key === "Enter" ||
        event.key === "Tab" ||
        event.key === " "
      ) {
        setSelectionAnchor(null)
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

  const annotationFrames = useMemo(
    () =>
      resolveSpreadsheetAnnotationFrames(
        controller.activeSheet,
        controller.activeSheetIndex,
        annotationMarkers,
        spreadsheetViewport,
        controller.zoomScale
      ),
    [
      annotationMarkers,
      controller.activeSheet,
      controller.activeSheetIndex,
      controller.zoomScale,
      spreadsheetViewport,
    ]
  )

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

    const sheet = controller.activeSheet
    const scroller = scrollerRef.current
    if (!sheet || !scroller) return
    const center = spreadsheetSelectionCenter(
      sheet,
      marker.selection,
      Math.max(0.1, controller.zoomScale / 100)
    )
    if (!center) return

    const nextScrollLeft = Math.max(0, center.left - scroller.clientWidth / 2)
    const nextScrollTop = Math.max(0, center.top - scroller.clientHeight / 2)
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
    scheduleSpreadsheetViewportUpdate()
  }, [
    annotationMarkers,
    annotationNavigation,
    controller,
    controller.activeSheet,
    controller.activeSheetIndex,
    controller.setActiveTabIndex,
    controller.tabs,
    controller.zoomScale,
    scheduleSpreadsheetViewportUpdate,
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
    ({ children, viewportProps }: XlsxScrollerRenderProps) => {
      const { ref, onScroll, ...restViewportProps } = viewportProps
      return (
        <div
          {...restViewportProps}
          ref={(element) => {
            scrollerRef.current = element
            if (typeof ref === "function") {
              ref(element)
            } else if (ref) {
              ;(ref as { current: HTMLDivElement | null }).current = element
            }
          }}
          onScroll={(event) => {
            onScroll?.(event)
            scheduleSpreadsheetViewportUpdate()
          }}
        >
          {children}
        </div>
      )
    },
    [scheduleSpreadsheetViewportUpdate]
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
            selectionEnabled ? capturePointerAnchor : undefined
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
          {annotationFrames.length > 0 && (
            <div
              className="office-annotation-overlay spreadsheet-preview-annotation-overlay"
              data-testid="spreadsheet-annotation-overlay"
              aria-hidden="true"
            >
              {annotationFrames.map((frame) => (
                <span
                  key={frame.id}
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
