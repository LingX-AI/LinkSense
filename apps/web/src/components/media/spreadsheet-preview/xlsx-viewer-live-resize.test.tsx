import { act, cleanup, fireEvent, render } from "@testing-library/react"
import {
  XlsxViewer,
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
