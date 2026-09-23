import { act, cleanup, fireEvent, render } from "@testing-library/react"
import {
  XlsxViewer,
  type XlsxChart,
  type XlsxImage,
  type XlsxScrollerRenderProps,
  type XlsxSheetData,
  type XlsxViewerController,
  type XlsxWorkbookTab,
} from "@extend-ai/react-xlsx"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const zoomScale = 150
const logicalColumnWidth = 100
const logicalRowHeight = 40
let nextAnimationFrameId = 1
let animationFrames = new Map<number, FrameRequestCallback>()

type CanvasContextMock = CanvasRenderingContext2D & {
  fillRect: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
}

function createCanvasContextMock(): CanvasContextMock {
  const gradient = { addColorStop: vi.fn() }
  const methods = new Map<PropertyKey, ReturnType<typeof vi.fn>>()
  const context = {
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createPattern: vi.fn(() => null),
    createRadialGradient: vi.fn(() => gradient),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    setTransform: vi.fn(),
  }

  return new Proxy(context, {
    get(target, property) {
      if (property in target) {
        return Reflect.get(target, property)
      }
      const method = methods.get(property) ?? vi.fn()
      methods.set(property, method)
      return method
    },
    set(target, property, value) {
      return Reflect.set(target, property, value)
    },
  }) as unknown as CanvasContextMock
}

function createSheet(): XlsxSheetData {
  return {
    cachedFormulaValues: {},
    colCount: 2,
    colStyleIds: {},
    colWidthOverridesPx: {},
    colWidths: [logicalColumnWidth, logicalColumnWidth],
    conditionalFormatRules: [],
    dataValidations: [],
    defaultColWidthPx: logicalColumnWidth,
    defaultRowHeightPx: logicalRowHeight,
    freezePanes: { col: 1, row: 1 },
    hasHorizontalMerges: false,
    hasVerticalMerges: false,
    maxHorizontalMergeEndCol: -1,
    maxUsedCol: 1,
    maxUsedRow: 1,
    maxVerticalMergeEndRow: -1,
    minUsedCol: 0,
    minUsedRow: 0,
    name: "Sheet1",
    namedCellStyleByName: {},
    rowCount: 2,
    rowHeightOverridesPx: {},
    rowHeights: [logicalRowHeight, logicalRowHeight],
    rowStyleIds: {},
    showGridLines: false,
    sparklines: [],
    styleById: {},
    tableStyleByName: {},
    themePalette: { colorsByIndex: {} },
    visibility: "visible",
    visibleCols: [0, 1],
    visibleRows: [0, 1],
    workbookSheetIndex: 0,
    zoomScale,
  }
}

function createController() {
  const sheet = createSheet()
  const activeTab: XlsxWorkbookTab = {
    id: "sheet-1",
    index: 0,
    kind: "sheet",
    name: sheet.name,
    sheetIndex: 0,
    workbookSheetIndex: 0,
  }

  return {
    activeCell: null,
    activeCellAddress: null,
    activeSheet: sheet,
    activeSheetIndex: 0,
    activeTab,
    activeTabIndex: 0,
    addFormControl: vi.fn(() => null),
    addSheet: vi.fn(),
    canDownload: false,
    canExport: false,
    canLoadDeferred: false,
    canRedo: false,
    canUndo: false,
    canZoomIn: true,
    canZoomOut: true,
    charts: [],
    chartsheets: [],
    clearSelectedCells: vi.fn(),
    clearSelectedChart: vi.fn(),
    clearSelectedChartElement: vi.fn(),
    clearSelectedImage: vi.fn(),
    clearSelection: vi.fn(),
    continueDeferredLoad: vi.fn(),
    copySelectionToClipboard: vi.fn(async () => false),
    defaultZoomScale: 100,
    deferredLoadFileSize: null,
    defineNamedRange: vi.fn(),
    displayFileName: "resize.xlsx",
    download: vi.fn(),
    error: null,
    exportCsv: vi.fn(),
    exportXlsx: vi.fn(),
    fillSelection: vi.fn(),
    formControls: [],
    getActiveWorksheet: vi.fn(() => null),
    getCellDisplayValue: vi.fn(() => ""),
    getCellFormula: vi.fn(() => ""),
    getChartById: vi.fn(() => null),
    getChartSeriesFormula: vi.fn(() => ""),
    getChartsheetById: vi.fn(() => null),
    getClipboardData: vi.fn(() => null),
    getFormControlItems: vi.fn(() => []),
    getImageById: vi.fn(() => null),
    getSheetCharts: vi.fn(() => []),
    getSheetFormControls: vi.fn(() => []),
    getSheetImages: vi.fn(() => []),
    getSheetShapes: vi.fn(() => []),
    images: [],
    isChartsLoading: false,
    isLoadDeferred: false,
    isLoading: false,
    isWorkerBacked: true,
    maxZoomScale: 200,
    mergeSelection: vi.fn(),
    minZoomScale: 50,
    moveChartBy: vi.fn(),
    moveImageBy: vi.fn(),
    pasteFromClipboard: vi.fn(async () => false),
    pasteStructuredClipboardData: vi.fn(() => false),
    pasteText: vi.fn(() => false),
    readOnly: true,
    recalculate: vi.fn(),
    redo: vi.fn(),
    removeActiveSheet: vi.fn(),
    removeFormControl: vi.fn(() => false),
    resetZoom: vi.fn(),
    resizeChartBy: vi.fn(),
    resizeColumn: vi.fn(),
    resizeImageBy: vi.fn(),
    resizeRow: vi.fn(),
    revision: 0,
    selectedCellFormula: "",
    selectedChart: null,
    selectedChartElement: null,
    selectedChartFormula: null,
    selectedChartId: null,
    selectedFormula: "",
    selectedFormulaTarget: null,
    selectedImage: null,
    selectedImageId: null,
    selectedRangeAddress: null,
    selectedValue: "",
    selection: null,
    selectCell: vi.fn(),
    selectChart: vi.fn(),
    selectChartElement: vi.fn(),
    selectImage: vi.fn(),
    selectRange: vi.fn(),
    setActiveSheetIndex: vi.fn(),
    setActiveTabIndex: vi.fn(),
    setCellFormula: vi.fn(),
    setCellStyle: vi.fn(),
    setCellValue: vi.fn(),
    setChartRect: vi.fn(),
    setChartSeriesFormula: vi.fn(() => false),
    setImageRect: vi.fn(),
    setRangeStyle: vi.fn(),
    setSelectedCellFormula: vi.fn(),
    setSelectedCellStyle: vi.fn(),
    setSelectedCellValue: vi.fn(),
    setSelectedFormula: vi.fn(() => false),
    setZoomScale: vi.fn(),
    shapes: [],
    sheets: [sheet],
    sortState: null,
    sortTable: vi.fn(),
    tables: [],
    tabs: [activeTab],
    undo: vi.fn(),
    unmergeSelection: vi.fn(),
    updateChart: vi.fn(),
    updateFormControl: vi.fn(() => false),
    workbook: null,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomScale,
  } satisfies XlsxViewerController
}

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string
): T {
  const element = root.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing test element: ${selector}`)
  }
  return element
}

function renderViewer(controller: XlsxViewerController) {
  return render(
    <XlsxViewer
      allowResizeInReadOnly
      controller={controller}
      experimentalCanvas={false}
      height={400}
      readOnly
      showDefaultToolbar={false}
    />
  )
}

function renderCanvasViewer(controller: XlsxViewerController) {
  return render(
    <XlsxViewer
      allowResizeInReadOnly
      controller={controller}
      height={400}
      readOnly
      showDefaultToolbar={false}
    />
  )
}

function flushAnimationFrames() {
  const pendingFrames = [...animationFrames.values()]
  animationFrames.clear()
  pendingFrames.forEach((callback) => callback(performance.now()))
}

describe("@extend-ai/react-xlsx live row and column resizing", () => {
  beforeEach(() => {
    nextAnimationFrameId = 1
    animationFrames = new Map()
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextAnimationFrameId
        nextAnimationFrameId += 1
        animationFrames.set(id, callback)
        return id
      })
    )
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => animationFrames.delete(id))
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each(["ctrlKey", "metaKey"] as const)(
    "preserves ordinary scrolling and bounds native %s wheel zoom in read-only mode",
    (modifier) => {
      vi.useFakeTimers()
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        createCanvasContextMock()
      )
      const controller = createController()
      const { container, unmount } = renderCanvasViewer(controller)
      const scroller = requireElement<HTMLElement>(container, '[role="grid"]')
      for (const init of [
        { deltaY: 100 },
        { deltaY: 100, shiftKey: true },
        { deltaX: 100 },
        { deltaY: 0, [modifier]: true },
      ]) {
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ...init,
        })
        fireEvent(scroller, event)
        expect(event.defaultPrevented).toBe(false)
      }
      act(() => vi.advanceTimersByTime(500))
      expect(controller.setZoomScale).not.toHaveBeenCalled()

      const zoomIn = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -10000,
        [modifier]: true,
      })
      fireEvent(scroller, zoomIn)
      expect(zoomIn.defaultPrevented).toBe(true)
      act(() => vi.advanceTimersByTime(500))
      expect(controller.setZoomScale).toHaveBeenLastCalledWith(165)
      for (let step = 0; step < 10; step += 1) {
        fireEvent.wheel(scroller, { deltaY: -10000, [modifier]: true })
      }
      act(() => vi.advanceTimersByTime(500))
      expect(controller.setZoomScale).toHaveBeenLastCalledWith(
        controller.maxZoomScale
      )
      for (let step = 0; step < 20; step += 1) {
        fireEvent.wheel(scroller, { deltaY: 10000, [modifier]: true })
      }
      act(() => vi.advanceTimersByTime(500))
      expect(controller.setZoomScale).toHaveBeenLastCalledWith(
        controller.minZoomScale
      )

      unmount()
      controller.setZoomScale.mockClear()
      fireEvent.wheel(scroller, { deltaY: -100, [modifier]: true })
      act(() => vi.advanceTimersByTime(500))
      expect(controller.setZoomScale).not.toHaveBeenCalled()
    }
  )

  it("keeps native trackpad gesture zoom active in the worksheet", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      createCanvasContextMock()
    )
    const controller = createController()
    const { container } = renderCanvasViewer(controller)
    const scroller = requireElement<HTMLElement>(container, '[role="grid"]')
    const gesture = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, "scale", { value: scale })
      Object.defineProperty(event, "clientX", { value: 100 })
      Object.defineProperty(event, "clientY", { value: 100 })
      fireEvent(scroller, event)
      return event
    }
    expect(gesture("gesturestart", 1).defaultPrevented).toBe(true)
    expect(gesture("gesturechange", 1.5).defaultPrevented).toBe(true)
    gesture("gestureend", 1.5)
    expect(controller.setZoomScale).toHaveBeenLastCalledWith(200)
  })

  it.each([
    { deltaY: -0.5, expectedZoom: 158 },
    { deltaY: 0.5, expectedZoom: 143 },
  ])(
    "accumulates small trackpad pinch deltas ($deltaY) into $expectedZoom%",
    ({ deltaY, expectedZoom }) => {
      vi.useFakeTimers()
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        createCanvasContextMock()
      )
      const controller = createController()
      const { container } = renderCanvasViewer(controller)
      const scroller = requireElement<HTMLElement>(container, '[role="grid"]')
      for (let frame = 0; frame < 10; frame += 1) {
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY,
          clientX: 100,
          clientY: 100,
        })
        fireEvent(scroller, event)
        expect(event.defaultPrevented).toBe(true)
        act(() => {
          vi.advanceTimersByTime(16)
          flushAnimationFrames()
        })
      }
      act(() => vi.advanceTimersByTime(100))
      expect(controller.setZoomScale).toHaveBeenLastCalledWith(expectedZoom)
    }
  )

  it.each([-100, 100])(
    "keeps row and column headers on their viewport edges during a live zoom (%i)",
    (deltaY) => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        createCanvasContextMock()
      )
      const controller = createController()
      const { container } = renderCanvasViewer(controller)
      const scroller = requireElement<HTMLElement>(container, '[role="grid"]')
      scroller.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400)
      fireEvent.wheel(scroller, {
        ctrlKey: true,
        deltaY,
        clientX: 300,
        clientY: 200,
      })

      const canvases = container.querySelectorAll("canvas")
      const topBody = canvases.item(1)
      const leftBody = canvases.item(2)
      const cornerBody = canvases.item(3)
      const topFrozen = canvases.item(4)
      const topScroll = canvases.item(5)
      const leftFrozen = canvases.item(6)
      const leftScroll = canvases.item(7)
      const corner = canvases.item(8)
      const transform = (canvas: HTMLCanvasElement) => {
        const match =
          /^translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale\(([-\d.]+)\)$/u.exec(
            canvas.style.transform
          )
        if (!match) throw new Error("Missing canvas zoom transform")
        return {
          x: Number(match[1]),
          y: Number(match[2]),
          scale: Number(match[3]),
        }
      }
      const scale = transform(corner).scale
      const frozenColumnOffset = 60 * (scale - 1)
      const frozenRowOffset = 36 * (scale - 1)
      expect(transform(corner)).toEqual({ x: 0, y: 0, scale })
      expect(transform(topScroll).y).toBe(0)
      expect(transform(leftScroll).x).toBe(0)
      expect(transform(topFrozen).x).toBeCloseTo(frozenColumnOffset)
      expect(transform(topFrozen).y).toBe(0)
      expect(transform(leftFrozen).x).toBe(0)
      expect(transform(leftFrozen).y).toBeCloseTo(frozenRowOffset)
      expect(transform(topBody).y).toBeCloseTo(frozenRowOffset)
      expect(transform(leftBody).x).toBeCloseTo(frozenColumnOffset)
      expect(transform(cornerBody).x).toBeCloseTo(frozenColumnOffset)
      expect(transform(cornerBody).y).toBeCloseTo(frozenRowOffset)
    }
  )

  it.each([false, true])(
    "returns native annotation bounds through scrolling and zoom with canvas=%s",
    (experimentalCanvas) => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        createCanvasContextMock()
      )
      const controller = createController()
      let scrollerProps: XlsxScrollerRenderProps | undefined
      const renderScroller = (props: XlsxScrollerRenderProps) => {
        scrollerProps = props
        return <div {...props.viewportProps}>{props.children}</div>
      }
      const view = () => (
        <XlsxViewer
          controller={controller}
          experimentalCanvas={experimentalCanvas}
          renderScroller={renderScroller}
          height={400}
          readOnly
          showDefaultToolbar={false}
        />
      )
      const { container, rerender } = render(view())
      const scroller = requireElement<HTMLElement>(container, '[role="grid"]')
      Object.defineProperty(scroller, "clientWidth", {
        configurable: true,
        value: 500,
      })
      Object.defineProperty(scroller, "clientHeight", {
        configurable: true,
        value: 400,
      })
      scroller.getBoundingClientRect = () => new DOMRect(300, 100, 500, 400)
      const hover = (x: number, y: number) => {
        if (!scrollerProps) throw new Error("Missing native scroller layout")
        return scrollerProps.getAnnotationTargetAtPoint(x, y)
      }
      expect(hover(380, 150)).toEqual({
        type: "range",
        range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      })
      expect(hover(310, 150)).toBeNull()
      expect(hover(380, 110)).toBeNull()
      const geometry = () => {
        if (!scrollerProps) throw new Error("Missing native scroller layout")
        return scrollerProps.getAnnotationGeometry({
          type: "range",
          range: { start: { row: 0, col: 0 }, end: { row: 1, col: 1 } },
        })
      }
      expect(geometry()?.contentRect).toEqual({
        left: 60,
        top: 36,
        width: 300,
        height: 120,
      })
      scroller.scrollLeft = 30
      scroller.scrollTop = 10
      expect(hover(550, 230)).toEqual({
        type: "range",
        range: { start: { row: 1, col: 1 }, end: { row: 1, col: 1 } },
      })
      expect(geometry()?.viewportRects).toEqual([
        { left: 60, top: 36, width: 150, height: 60 },
        { left: 210, top: 36, width: 120, height: 60 },
        { left: 60, top: 96, width: 150, height: 50 },
        { left: 210, top: 96, width: 120, height: 50 },
      ])
      controller.zoomScale = 100
      rerender(view())
      expect(hover(470, 185)).toEqual({
        type: "range",
        range: { start: { row: 1, col: 1 }, end: { row: 1, col: 1 } },
      })
      expect(geometry()?.contentRect).toEqual({
        left: 40,
        top: 24,
        width: 200,
        height: 80,
      })
      scroller.scrollLeft = 500
      scroller.scrollTop = 500
      expect(geometry()?.viewportRects).toEqual([
        { left: 40, top: 24, width: 100, height: 40 },
      ])
      Object.defineProperty(scroller, "clientWidth", { value: 100 })
      Object.defineProperty(scroller, "clientHeight", { value: 50 })
      expect(geometry()?.viewportRects).toEqual([
        { left: 40, top: 24, width: 60, height: 26 },
      ])
    }
  )

  it("includes native gridline thickness and changed row dimensions in annotation geometry", () => {
    const controller = createController()
    controller.activeSheet.showGridLines = true
    controller.activeSheet.rowHeightOverridesPx[0] = 70
    let scrollerProps: XlsxScrollerRenderProps | undefined
    render(
      <XlsxViewer
        controller={controller}
        experimentalCanvas={false}
        renderScroller={(props) => {
          scrollerProps = props
          return <div {...props.viewportProps}>{props.children}</div>
        }}
        height={400}
        readOnly
      />
    )
    if (!scrollerProps) throw new Error("Missing native scroller layout")
    expect(
      scrollerProps.getAnnotationGeometry({
        type: "range",
        range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      })?.contentRect
    ).toEqual({ left: 60, top: 36, width: 151.5, height: 106.5 })
  })

  it("previews the topmost chart or image without changing the sheet selection", () => {
    const image: XlsxImage = {
      id: "preview-image",
      anchor: {
        kind: "absolute",
        positionEmu: { x: 10 * 9525, y: 5 * 9525 },
        sizeEmu: { cx: 60 * 9525, cy: 30 * 9525 },
      },
      mimeType: "image/png",
      src: "data:image/png;base64,AA==",
      sheetIndex: 0,
      workbookSheetIndex: 0,
      zIndex: 1,
    }
    const chart: XlsxChart = {
      id: "preview-chart",
      anchor: image.anchor,
      axes: [],
      chartType: "bar",
      series: [],
      sheetIndex: 0,
      workbookSheetIndex: 0,
      zIndex: 2,
    }
    const controller: XlsxViewerController = {
      ...createController(),
      images: [image],
      charts: [chart],
      getSheetImages: () => [image],
      getSheetCharts: () => [chart],
    }
    let scrollerProps: XlsxScrollerRenderProps | undefined
    const view = () => (
      <XlsxViewer
        controller={controller}
        experimentalCanvas={false}
        renderScroller={(props) => {
          scrollerProps = props
          return <div {...props.viewportProps}>{props.children}</div>
        }}
        height={400}
        readOnly
      />
    )
    const { container, rerender } = render(view())
    const scroller = requireElement<HTMLElement>(container, '[role="grid"]')
    Object.defineProperty(scroller, "clientWidth", { value: 500 })
    Object.defineProperty(scroller, "clientHeight", { value: 400 })
    scroller.getBoundingClientRect = () => new DOMRect(300, 100, 500, 400)
    if (!scrollerProps) throw new Error("Missing native scroller layout")
    expect(scrollerProps.getAnnotationTargetAtPoint(400, 160)).toEqual({
      type: "chart",
      id: chart.id,
    })
    controller.charts = []
    controller.getSheetCharts = () => []
    rerender(view())
    expect(scrollerProps.getAnnotationTargetAtPoint(400, 160)).toEqual({
      type: "image",
      id: image.id,
    })
    expect(controller.selectCell).not.toHaveBeenCalled()
    expect(controller.selectChart).not.toHaveBeenCalled()
    expect(controller.selectImage).not.toHaveBeenCalled()
  })

  it("keeps saved annotations aligned with the frozen canvas during a live zoom gesture", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      createCanvasContextMock()
    )
    const controller = createController()
    let scrollerProps: XlsxScrollerRenderProps | undefined
    const { container } = render(
      <XlsxViewer
        controller={controller}
        experimentalCanvas
        readOnly
        enableGestureZoom
        renderScroller={(props) => {
          scrollerProps = props
          return <div {...props.viewportProps}>{props.children}</div>
        }}
        height={400}
      />
    )
    const scroller = requireElement<HTMLElement>(container, '[role="grid"]')
    Object.defineProperty(scroller, "clientWidth", { value: 500 })
    Object.defineProperty(scroller, "clientHeight", { value: 400 })
    scroller.getBoundingClientRect = () => new DOMRect(0, 0, 500, 400)
    fireEvent.wheel(scroller, {
      ctrlKey: true,
      deltaY: 100,
      clientX: 300,
      clientY: 200,
    })
    const canvas = container.querySelectorAll("canvas").item(3)
    const scale = Number(/scale\(([^)]+)\)/u.exec(canvas.style.transform)?.[1])
    expect(scale).toBeLessThan(1)
    expect(scale).toBeGreaterThan(0)
    if (!scrollerProps) throw new Error("Missing native scroller layout")
    const geometry = scrollerProps.getAnnotationGeometry({
      type: "range",
      range: {
        start: { row: 0, col: 0 },
        end: { row: 0, col: 0 },
      },
    })
    expect(geometry?.viewportRects).toHaveLength(1)
    expect(geometry?.viewportRects[0]?.left).toBeCloseTo(60 * scale)
    expect(geometry?.viewportRects[0]?.top).toBeCloseTo(36 * scale)
    expect(geometry?.viewportRects[0]?.width).toBeCloseTo(150 * scale)
    expect(geometry?.viewportRects[0]?.height).toBeCloseTo(60 * scale)
    expect(
      scrollerProps.getAnnotationTargetAtPoint(80 * scale, 46 * scale)
    ).toEqual({
      type: "range",
      range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
    })
    const scrollingCell = scrollerProps.getAnnotationGeometry({
      type: "range",
      range: { start: { row: 1, col: 1 }, end: { row: 1, col: 1 } },
    })?.viewportRects[0]
    if (!scrollingCell) throw new Error("Missing zoomed scrolling cell")
    expect(
      scrollerProps.getAnnotationTargetAtPoint(
        scrollingCell.left + scrollingCell.width / 2,
        scrollingCell.top + scrollingCell.height / 2
      )
    ).toEqual({
      type: "range",
      range: { start: { row: 1, col: 1 }, end: { row: 1, col: 1 } },
    })
  })

  it("updates the column DOM on pointermove and commits the final logical width on pointerup", () => {
    const controller = createController()
    const { container } = renderViewer(controller)
    const column = requireElement<HTMLTableColElement>(
      container,
      "colgroup col:nth-of-type(2)"
    )
    const resizeHandle = requireElement<HTMLElement>(
      container,
      '[data-xlsx-col-header="0"] > div > div'
    )

    expect(column.style.width).toBe("150px")

    fireEvent.pointerDown(resizeHandle, {
      button: 0,
      clientX: 200,
      pointerId: 11,
    })
    act(() => {
      fireEvent.pointerMove(window, { clientX: 230, pointerId: 11 })
      flushAnimationFrames()
    })

    expect(column.style.width).toBe("180px")
    expect(controller.resizeColumn).not.toHaveBeenCalled()

    act(() => {
      fireEvent.pointerMove(window, { clientX: 260, pointerId: 11 })
      flushAnimationFrames()
    })

    expect(column.style.width).toBe("210px")
    expect(controller.resizeColumn).not.toHaveBeenCalled()

    act(() => {
      fireEvent.pointerUp(window, { clientX: 260, pointerId: 11 })
    })

    expect(controller.resizeColumn).toHaveBeenCalledOnce()
    expect(controller.resizeColumn).toHaveBeenCalledWith(0, 140)
  })

  it("updates the row DOM on pointermove and commits the final logical height on pointerup", () => {
    const controller = createController()
    const { container } = renderViewer(controller)
    const row = requireElement<HTMLTableRowElement>(
      container,
      'tr[data-xlsx-row="0"]'
    )
    const resizeHandle = requireElement<HTMLElement>(
      row,
      "td:first-child > div > div"
    )

    expect(row.style.height).toBe("60px")

    fireEvent.pointerDown(resizeHandle, {
      button: 0,
      clientY: 100,
      pointerId: 12,
    })
    act(() => {
      fireEvent.pointerMove(window, { clientY: 115, pointerId: 12 })
      flushAnimationFrames()
    })

    expect(row.style.height).toBe("75px")
    expect(controller.resizeRow).not.toHaveBeenCalled()

    act(() => {
      fireEvent.pointerMove(window, { clientY: 130, pointerId: 12 })
      flushAnimationFrames()
    })

    expect(row.style.height).toBe("90px")
    expect(controller.resizeRow).not.toHaveBeenCalled()

    act(() => {
      fireEvent.pointerUp(window, { clientY: 130, pointerId: 12 })
    })

    expect(controller.resizeRow).toHaveBeenCalledOnce()
    expect(controller.resizeRow).toHaveBeenCalledWith(0, 60)
  })

  describe("canvas headers", () => {
    let canvasContexts: WeakMap<HTMLCanvasElement, CanvasContextMock>

    function requireCanvasContext(canvas: HTMLCanvasElement) {
      const context = canvasContexts.get(canvas)
      if (!context) {
        throw new Error("Missing mocked canvas context")
      }
      return context
    }

    beforeEach(() => {
      canvasContexts = new WeakMap()
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600)
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
        400
      )
      vi.spyOn(
        HTMLCanvasElement.prototype,
        "getBoundingClientRect"
      ).mockReturnValue(new DOMRect(0, 0, 600, 400))
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 600, 400)
      )
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        function (this: HTMLCanvasElement) {
          const existingContext = canvasContexts.get(this)
          if (existingContext) {
            return existingContext
          }
          const context = createCanvasContextMock()
          canvasContexts.set(this, context)
          return context
        }
      )
    })

    it("repaints the frozen first row without exposing an unpainted canvas", () => {
      const controller = createController()
      const { container } = renderCanvasViewer(controller)
      const canvases = container.querySelectorAll("canvas")
      const frozenBody = canvases.item(3)
      const frozenRowHeader = canvases.item(6)
      expect(frozenBody).toBeInstanceOf(HTMLCanvasElement)
      expect(frozenRowHeader).toBeInstanceOf(HTMLCanvasElement)

      const bodyContext = requireCanvasContext(frozenBody)
      const headerContext = requireCanvasContext(frozenRowHeader)
      bodyContext.fillRect.mockClear()
      headerContext.fillRect.mockClear()
      headerContext.fillText.mockClear()

      fireEvent.pointerDown(frozenRowHeader, {
        button: 0,
        clientX: 30,
        clientY: 96,
        pointerId: 20,
      })
      act(() => {
        fireEvent.pointerMove(window, { clientY: 126, pointerId: 20 })
        flushAnimationFrames()
      })

      expect(frozenRowHeader.style.height).toBe("90px")
      expect(frozenRowHeader.height).toBe(90)
      expect(headerContext.fillRect).toHaveBeenCalledWith(0, 0, 60, 90)
      expect(headerContext.fillText).toHaveBeenCalledWith("1", 30, 45)
      expect(frozenBody.style.height).toBe("90px")
      expect(frozenBody.height).toBe(90)
      expect(bodyContext.fillRect).toHaveBeenCalledWith(0, 0, 150, 90)
      expect(controller.resizeRow).not.toHaveBeenCalled()
    })

    it("repaints the frozen first column at the live column width", () => {
      const controller = createController()
      const { container } = renderCanvasViewer(controller)
      const canvases = container.querySelectorAll("canvas")
      const frozenBody = canvases.item(3)
      const frozenColumnHeader = canvases.item(4)
      expect(frozenBody).toBeInstanceOf(HTMLCanvasElement)
      expect(frozenColumnHeader).toBeInstanceOf(HTMLCanvasElement)

      const bodyContext = requireCanvasContext(frozenBody)
      const headerContext = requireCanvasContext(frozenColumnHeader)
      bodyContext.fillRect.mockClear()
      headerContext.fillRect.mockClear()
      headerContext.fillText.mockClear()

      fireEvent.pointerDown(frozenColumnHeader, {
        button: 0,
        clientX: 210,
        clientY: 18,
        pointerId: 23,
      })
      act(() => {
        fireEvent.pointerMove(window, { clientX: 240, pointerId: 23 })
        flushAnimationFrames()
      })

      expect(frozenColumnHeader.style.width).toBe("180px")
      expect(frozenColumnHeader.width).toBe(180)
      expect(headerContext.fillRect).toHaveBeenCalledWith(0, 0, 180, 36)
      expect(headerContext.fillText).toHaveBeenCalledWith("A", 90, 18)
      expect(frozenBody.style.width).toBe("180px")
      expect(frozenBody.width).toBe(180)
      expect(bodyContext.fillRect).toHaveBeenCalledWith(0, 0, 180, 60)
      expect(controller.resizeColumn).not.toHaveBeenCalled()
    })

    it("repaints the scrolling row header at the live row height", () => {
      const controller = createController()
      const { container } = renderCanvasViewer(controller)
      const canvases = container.querySelectorAll("canvas")
      const scrollingRowHeader = canvases.item(7)
      expect(scrollingRowHeader).toBeInstanceOf(HTMLCanvasElement)

      const canvasContext = requireCanvasContext(scrollingRowHeader)
      canvasContext.fillRect.mockClear()
      canvasContext.fillText.mockClear()
      fireEvent.pointerDown(scrollingRowHeader, {
        button: 0,
        clientX: 30,
        clientY: 156,
        pointerId: 21,
      })
      act(() => {
        fireEvent.pointerMove(window, { clientY: 186, pointerId: 21 })
        flushAnimationFrames()
      })

      expect(canvasContext.fillRect).toHaveBeenCalledWith(0, 0, 60, 912)
      expect(canvasContext.fillText).toHaveBeenCalledWith("2", 30, 349)
      expect(controller.resizeRow).not.toHaveBeenCalled()
    })

    it("repaints the scrolling column header at the live column width", () => {
      const controller = createController()
      const { container } = renderCanvasViewer(controller)
      const canvases = container.querySelectorAll("canvas")
      const scrollingColumnHeader = canvases.item(5)
      expect(scrollingColumnHeader).toBeInstanceOf(HTMLCanvasElement)

      const canvasContext = requireCanvasContext(scrollingColumnHeader)
      canvasContext.fillRect.mockClear()
      canvasContext.fillText.mockClear()
      fireEvent.pointerDown(scrollingColumnHeader, {
        button: 0,
        clientX: 360,
        clientY: 18,
        pointerId: 22,
      })
      act(() => {
        fireEvent.pointerMove(window, { clientX: 420, pointerId: 22 })
        flushAnimationFrames()
      })

      expect(canvasContext.fillRect).toHaveBeenCalledWith(0, 0, 1170, 36)
      expect(canvasContext.fillText).toHaveBeenCalledWith("B", 495, 18)
      expect(controller.resizeColumn).not.toHaveBeenCalled()
    })
  })
})
