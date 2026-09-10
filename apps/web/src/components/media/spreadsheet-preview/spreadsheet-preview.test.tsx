import type { XlsxScrollerRenderProps } from "@extend-ai/react-xlsx"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import JSZip from "jszip"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SpreadsheetPreview } from "@/components/media/spreadsheet-preview/spreadsheet-preview"
import type { SpreadsheetSelectionAction } from "@/components/media/spreadsheet-preview/spreadsheet-preview.types"
import i18n from "@/i18n"
import { mockOfficeSelectionLayout } from "@/test/office-selection-layout"

const xlsx = vi.hoisted(() => ({
  setWasmSource: vi.fn(),
  lastLoadingState: null as ReactNode,
  lastSelectedTabIndex: null as number | null,
  loadModeHistory: [] as boolean[],
  workerError: null as Error | null,
  workerLoading: false,
  mainThreadError: null as Error | null,
  mainThreadLoading: false,
  lastOptions: null as null | {
    allowResizeInReadOnly?: boolean
    file?: ArrayBuffer
    fileName?: string
    readOnly?: boolean
    useWorker?: boolean
  },
}))

vi.mock("@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm?url", () => ({
  default: "/assets/duke-sheets.wasm",
}))

vi.mock("@extend-ai/react-xlsx", async () => {
  const React = await import("react")

  type CellRange = {
    start: { row: number; col: number }
    end: { row: number; col: number }
  }
  function createMockSheet(name: string, workbookSheetIndex: number) {
    return {
      cachedFormulaValues: {},
      colWidthOverridesPx: {},
      colStyleIds: {},
      conditionalFormatRules: [],
      dataValidations: [],
      defaultColWidthPx: 64,
      defaultRowHeightPx: 20,
      freezePanes: null,
      hasHorizontalMerges: false,
      hasVerticalMerges: false,
      hiddenCols: [],
      hiddenRows: [],
      maxHorizontalMergeEndCol: -1,
      maxVerticalMergeEndRow: -1,
      minUsedCol: 0,
      minUsedRow: 0,
      maxUsedCol: 3,
      maxUsedRow: 3,
      name,
      rowCount: 4,
      colCount: 4,
      rowHeightOverridesPx: {},
      rowStyleIds: {},
      namedCellStyleByName: {},
      styleById: {},
      tableStyleByName: {},
      visibleRows: [0, 1, 2, 3],
      visibleCols: [0, 1, 2, 3],
      colWidths: [64, 64, 64, 64],
      rowHeights: [20, 20, 20, 20],
      showGridLines: true,
      sparklines: [],
      themePalette: { colorsByIndex: {} },
      visibility: "visible",
      workbookSheetIndex,
      zoomScale: 100,
    } as const
  }
  type MockController = {
    activeCellAddress: string | null
    activeSheet: ReturnType<typeof createMockSheet> | null
    activeSheetIndex: number
    activeTabIndex: number
    canZoomIn: boolean
    canZoomOut: boolean
    error: Error | null
    getClipboardData: () => { text: string } | null
    isLoading: boolean
    resetZoom: () => void
    selectedChart: null | {
      id: string
      name?: string
      title?: string
      chartType: string
      anchor: {
        kind: "absolute"
        positionEmu: { x: number; y: number }
        sizeEmu: { cx: number; cy: number }
      }
    }
    selectedChartElement: null | {
      kind: "series"
      chartId: string
      seriesId: string
      seriesIndex: number
    }
    selectedChartFormula: string | null
    selectedFormula: string
    selectedImage: null | {
      id: string
      name?: string
      description?: string
      anchor: {
        kind: "absolute"
        positionEmu: { x: number; y: number }
        sizeEmu: { cx: number; cy: number }
      }
    }
    selectedRangeAddress: string | null
    selection: CellRange | null
    setActiveTabIndex: (index: number) => void
    tabs: Array<{
      id: string
      index: number
      kind: "sheet"
      name: string
      sheetIndex: number
      workbookSheetIndex: number
    }>
    workbook: object | null
    zoomIn: () => void
    zoomOut: () => void
    zoomScale: number
    clipboardText: string
  }
  type MockOptions = {
    allowResizeInReadOnly?: boolean
    file?: ArrayBuffer
    fileName?: string
    readOnly?: boolean
    useWorker?: boolean
  }

  function useXlsxViewerController(options: MockOptions): MockController {
    const [, setRevision] = React.useState(0)
    const controllerRef = React.useRef<MockController | null>(null)
    if (!controllerRef.current) {
      const refresh = () => setRevision((current) => current + 1)
      const controller: MockController = {
        activeCellAddress: null,
        activeSheet: createMockSheet("预算", 1),
        activeSheetIndex: 1,
        activeTabIndex: 1,
        canZoomIn: true,
        canZoomOut: true,
        error: options.useWorker ? xlsx.workerError : xlsx.mainThreadError,
        getClipboardData: () =>
          controller.clipboardText ? { text: controller.clipboardText } : null,
        isLoading: options.useWorker
          ? xlsx.workerLoading
          : xlsx.mainThreadLoading,
        resetZoom: () => {
          controller.zoomScale = 100
          refresh()
        },
        selectedChart: null,
        selectedChartElement: null,
        selectedChartFormula: null,
        selectedFormula: "",
        selectedImage: null,
        selectedRangeAddress: null,
        selection: null,
        setActiveTabIndex: (index) => {
          const tab = controller.tabs[index]
          if (!tab) return

          xlsx.lastSelectedTabIndex = index
          controller.activeTabIndex = index
          controller.activeSheetIndex = tab.sheetIndex
          controller.activeSheet = createMockSheet(
            tab.name,
            tab.workbookSheetIndex
          )
          controller.selection = null
          controller.selectedRangeAddress = null
          refresh()
        },
        tabs: [
          {
            id: "sheet-0",
            index: 0,
            kind: "sheet",
            name: "汇总",
            sheetIndex: 0,
            workbookSheetIndex: 0,
          },
          {
            id: "sheet-1",
            index: 1,
            kind: "sheet",
            name: "预算",
            sheetIndex: 1,
            workbookSheetIndex: 1,
          },
          {
            id: "sheet-2",
            index: 2,
            kind: "sheet",
            name: "明细",
            sheetIndex: 2,
            workbookSheetIndex: 2,
          },
        ],
        // Worker-backed loads intentionally keep workbook null and expose the
        // parsed workbook through sheets and async row access instead.
        workbook: null,
        zoomIn: () => {
          controller.zoomScale = 110
          refresh()
        },
        zoomOut: () => {
          controller.zoomScale = 90
          refresh()
        },
        zoomScale: 100,
        clipboardText: "",
      }
      controllerRef.current = controller
    }
    if (xlsx.lastOptions?.useWorker !== options.useWorker) {
      xlsx.loadModeHistory.push(options.useWorker === true)
    }
    xlsx.lastOptions = options
    return controllerRef.current
  }

  function XlsxViewer({
    controller,
    allowResizeInReadOnly,
    getCellStyle,
    loadingState,
    readOnly,
    renderScroller,
    selectionColor,
    selectionFillColor,
    showDefaultToolbar,
    toolbar,
  }: {
    controller: MockController
    allowResizeInReadOnly?: boolean
    getCellStyle?: (context: {
      cell: { row: number; col: number }
      workbookSheetIndex: number
    }) => React.CSSProperties | null | undefined
    loadingState?: React.ReactNode
    readOnly?: boolean
    renderScroller?: (props: XlsxScrollerRenderProps) => React.ReactNode
    selectionColor?: string
    selectionFillColor?: string
    showDefaultToolbar?: boolean
    toolbar?:
      React.ReactNode | ((controller: MockController) => React.ReactNode)
  }) {
    xlsx.lastLoadingState = loadingState ?? null
    const toolbarContent =
      typeof toolbar === "function" ? toolbar(controller) : toolbar
    const annotatedCellStyle = getCellStyle?.({
      cell: { row: 1, col: 1 },
      workbookSheetIndex: controller.activeSheetIndex,
    })
    const scrollerContent = React.createElement(
      "div",
      { "data-testid": "xlsx-scroller-content" },
      React.createElement("div", {
        "data-testid": "xlsx-annotated-cell",
        style: annotatedCellStyle ?? undefined,
      })
    )
    let scrollerElement: HTMLDivElement | null = null
    const scroller =
      renderScroller?.({
        getAnnotationTargetAtPoint: () => ({
          type: "range",
          range: { start: { row: 1, col: 1 }, end: { row: 1, col: 1 } },
        }),
        getAnnotationGeometry: (target) => {
          const scale = controller.zoomScale / 100
          const object =
            target.type === "image"
              ? controller.selectedImage
              : controller.selectedChart
          const range = target.type === "range" ? target.range : null
          const anchor = object?.anchor
          const contentRect = range
            ? {
                left:
                  (40 + Math.min(range.start.col, range.end.col) * 64) * scale,
                top:
                  (24 + Math.min(range.start.row, range.end.row) * 20) * scale,
                width:
                  (Math.abs(range.end.col - range.start.col) + 1) * 64 * scale,
                height:
                  (Math.abs(range.end.row - range.start.row) + 1) * 20 * scale,
              }
            : anchor
              ? {
                  left: (40 + anchor.positionEmu.x / 9525) * scale,
                  top: (24 + anchor.positionEmu.y / 9525) * scale,
                  width: Math.max(1, (anchor.sizeEmu.cx / 9525) * scale),
                  height: Math.max(1, (anchor.sizeEmu.cy / 9525) * scale),
                }
              : null
          if (!contentRect || !scrollerElement) return null
          const left = Math.max(
            40 * scale,
            contentRect.left - scrollerElement.scrollLeft
          )
          const top = Math.max(
            24 * scale,
            contentRect.top - scrollerElement.scrollTop
          )
          const right = Math.min(
            360,
            contentRect.left + contentRect.width - scrollerElement.scrollLeft
          )
          const bottom = Math.min(
            240,
            contentRect.top + contentRect.height - scrollerElement.scrollTop
          )
          return {
            contentRect,
            viewportRects:
              right > left && bottom > top
                ? [{ left, top, width: right - left, height: bottom - top }]
                : [],
          }
        },
        children: scrollerContent,
        viewportProps: {
          ref: (element) => {
            scrollerElement = element
            if (!element) return
            Object.defineProperty(element, "clientWidth", {
              configurable: true,
              get: () => 360,
            })
            Object.defineProperty(element, "clientHeight", {
              configurable: true,
              get: () => 240,
            })
          },
          style: { height: 240, overflow: "auto", width: 360 },
          tabIndex: 0,
        },
      }) ?? scrollerContent
    const refreshSelection = () => {
      controller.zoomIn()
      controller.zoomScale = 100
    }
    return React.createElement(
      "div",
      {
        "data-testid": "xlsx-viewer",
        "data-allow-resize-in-read-only": String(allowResizeInReadOnly),
        "data-read-only": String(readOnly),
        "data-default-toolbar": String(showDefaultToolbar),
        "data-selection-color": selectionColor,
        "data-selection-fill": selectionFillColor,
      },
      toolbarContent,
      scroller,
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            controller.selectedChart = null
            controller.selectedImage = null
            controller.selection = {
              start: { row: 1, col: 1 },
              end: { row: 2, col: 2 },
            }
            controller.selectedRangeAddress = "B2:C3"
            controller.activeCellAddress = "B2"
            controller.selectedFormula = "=SUM(B2:C3)"
            controller.clipboardText = "10\t20\n30\t40"
            refreshSelection()
          },
        },
        "Select range"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            controller.selectedChart = null
            controller.selectedImage = {
              id: "image-8",
              name: "Logo",
              description: "Company logo",
              anchor: {
                kind: "absolute",
                positionEmu: { x: 100, y: 200 },
                sizeEmu: { cx: 300, cy: 400 },
              },
            }
            refreshSelection()
          },
        },
        "Select image"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            controller.selectedImage = null
            controller.selectedChart = {
              id: "chart-3",
              name: "Revenue",
              title: "Quarterly revenue",
              chartType: "bar",
              anchor: {
                kind: "absolute",
                positionEmu: { x: 300, y: 400 },
                sizeEmu: { cx: 500, cy: 600 },
              },
            }
            controller.selectedChartElement = {
              kind: "series",
              chartId: "chart-3",
              seriesId: "series-2",
              seriesIndex: 1,
            }
            controller.selectedChartFormula = "预算!$B$2:$B$5"
            refreshSelection()
          },
        },
        "Select chart"
      )
    )
  }

  return {
    setWasmSource: xlsx.setWasmSource,
    useXlsxViewerController,
    XlsxViewer,
  }
})

function createSelectionAction(
  onSubmit: SpreadsheetSelectionAction["onSubmit"]
): SpreadsheetSelectionAction {
  return {
    label: "问 LinkSense",
    shortcutLabel: "⌘I",
    promptLabel: "描述对所选内容的要求",
    placeholder: "描述要修改的内容",
    submitLabel: "发送要求",
    errorMessage: "发送失败，请重试",
    onSubmit,
  }
}

async function submitCurrentSelection(description: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: /问 LinkSense/u })
  )
  const prompt = screen.getByRole("textbox", {
    name: "描述对所选内容的要求",
  })
  await userEvent.type(prompt, `${description}{Enter}`)
  await waitFor(() => expect(prompt).not.toBeInTheDocument())
}

async function createAbsoluteTargetWorkbook() {
  const zip = new JSZip()
  zip.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml"/>
</Relationships>`
  )
  zip.file("xl/drawings/drawing1.xml", "<drawing/>")
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })
}

describe("spreadsheet preview", () => {
  beforeEach(async () => {
    xlsx.lastLoadingState = null
    xlsx.lastSelectedTabIndex = null
    xlsx.loadModeHistory = []
    xlsx.workerError = null
    xlsx.workerLoading = false
    xlsx.mainThreadError = null
    xlsx.mainThreadLoading = false
    xlsx.lastOptions = null
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    vi.restoreAllMocks()
  })

  it("enables read-only row and column resizing and submits a worker-backed range", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="budget.xlsx"
        selectionAction={createSelectionAction(onSubmit)}
        onClose={vi.fn()}
      />
    )

    expect(xlsx.setWasmSource).toHaveBeenCalledWith("/assets/duke-sheets.wasm")
    expect(xlsx.lastOptions).toMatchObject({
      allowResizeInReadOnly: true,
      fileName: "budget.xlsx",
      readOnly: true,
      useWorker: true,
    })
    expect(xlsx.lastOptions?.file).toBeInstanceOf(ArrayBuffer)
    expect(screen.getByTestId("xlsx-viewer")).toHaveAttribute(
      "data-allow-resize-in-read-only",
      "true"
    )
    expect(screen.getByTestId("xlsx-viewer")).toHaveAttribute(
      "data-read-only",
      "true"
    )
    expect(screen.getByTestId("xlsx-viewer")).toHaveAttribute(
      "data-default-toolbar",
      "false"
    )
    const { container: loadingStateContainer } = render(
      <>{xlsx.lastLoadingState}</>
    )
    expect(
      loadingStateContainer.querySelector('[role="status"]')
    ).toHaveTextContent("正在加载文档")
    expect(loadingStateContainer.querySelector(".shimmer")).not.toBeNull()
    expect(loadingStateContainer.querySelector("svg")).toBeNull()
    expect(screen.getByText("100%")).toBeVisible()

    await userEvent.click(
      screen.getByRole("button", { name: "放大 Excel 工作簿" })
    )
    expect(screen.getByText("110%")).toBeVisible()
    await userEvent.click(
      screen.getAllByRole("button", { name: "重置 Excel 工作簿缩放" })[0]!
    )
    expect(screen.getByText("100%")).toBeVisible()

    await userEvent.click(screen.getByRole("button", { name: "Select range" }))
    await submitCurrentSelection("把合计行加粗")

    expect(onSubmit).toHaveBeenCalledWith(
      {
        type: "range",
        sheetName: "预算",
        sheetIndex: 1,
        rangeAddress: "B2:C3",
        activeCellAddress: "B2",
        startRow: 1,
        startColumn: 1,
        endRow: 2,
        endColumn: 2,
        selectedText: "10\t20\n30\t40",
        selectedFormula: "=SUM(B2:C3)",
      },
      "把合计行加粗"
    )
  })

  it("anchors range actions to the selection through keyboard selection, scrolling, and zoom", async () => {
    mockOfficeSelectionLayout()
    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="budget.xlsx"
        selectionAction={createSelectionAction(vi.fn())}
      />
    )
    const scroller = screen.getByTestId("xlsx-scroller-content").parentElement
    if (!scroller) throw new Error("Missing spreadsheet scroller")
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(300, 100, 360, 240)
    )
    fireEvent.scroll(scroller)
    await userEvent.click(screen.getByRole("button", { name: "Select range" }))
    const action = screen.getByRole("button", { name: /问 LinkSense/u })
    await waitFor(() =>
      expect(action.style.transform).toBe("translate(388px, 192px)")
    )

    fireEvent.keyUp(scroller, { key: "ArrowDown" })
    await waitFor(() =>
      expect(action.style.transform).toBe("translate(388px, 192px)")
    )
    expect(action).not.toHaveClass("invisible")
    scroller.scrollLeft = 30
    scroller.scrollTop = 20
    fireEvent.scroll(scroller)
    await waitFor(() =>
      expect(action.style.transform).toBe("translate(358px, 172px)")
    )
    await userEvent.click(
      screen.getByRole("button", { name: "放大 Excel 工作簿" })
    )
    await waitFor(() =>
      expect(action.style.transform).toBe("translate(381px, 180px)")
    )
  })

  it("previews a hovered worksheet cell without committing a range selection", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="hover.xlsx"
        selectionAction={createSelectionAction(onSubmit)}
      />
    )
    const overlay = await screen.findByTestId("office-annotation-hover-overlay")
    const target = screen.getByTestId("xlsx-scroller-content")
    const scroller = target.parentElement
    if (!scroller) throw new Error("Missing spreadsheet viewport")
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 100, 360, 240)
    )
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 100, 360, 240)
    )
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target)
    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      buttons: 0,
      clientX: 210,
      clientY: 150,
    })
    await waitFor(() =>
      expect(overlay.querySelector("path")).toHaveAttribute(
        "d",
        "M104,44H168V64H104Z"
      )
    )
    expect(screen.queryByRole("button", { name: /问 LinkSense/u })).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
    scroller.scrollLeft = 20
    fireEvent.scroll(scroller)
    await waitFor(() =>
      expect(overlay.querySelector("path")).toHaveAttribute(
        "d",
        "M84,44H148V64H84Z"
      )
    )
    await userEvent.click(screen.getByRole("button", { name: "Select range" }))
    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      buttons: 0,
      clientX: 210,
      clientY: 150,
    })
    await waitFor(() =>
      expect(overlay.querySelector("path")?.getAttribute("d") || "").toBe("")
    )
  })

  it("draws numbered markers for saved worksheet range annotations", async () => {
    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="budget.xlsx"
        annotationMarkers={[
          {
            id: "draft-1",
            index: 1,
            selection: {
              type: "range",
              sheetName: "预算",
              sheetIndex: 1,
              rangeAddress: "B2:C3",
              startRow: 1,
              startColumn: 1,
              endRow: 2,
              endColumn: 2,
            },
          },
        ]}
        onClose={vi.fn()}
      />
    )

    const overlay = await screen.findByTestId("spreadsheet-annotation-overlay")
    const frame = overlay.querySelector(
      '[data-spreadsheet-annotation-frame="draft-1"]'
    )
    expect(
      frame?.closest('[data-testid="spreadsheet-annotation-viewport"]')
    ).toContainElement(
      screen.getByTestId("xlsx-scroller-content").parentElement
    )
    expect(frame).toHaveStyle({
      left: "104px",
      top: "44px",
      width: "128px",
      height: "40px",
    })
    expect(frame).toHaveTextContent("1")
    expect(screen.getByTestId("xlsx-annotated-cell")).toHaveAttribute(
      "style",
      expect.stringContaining("background-color")
    )

    const scroller = screen.getByTestId("xlsx-scroller-content").parentElement
    if (!scroller) throw new Error("Missing spreadsheet scroller")
    scroller.scrollLeft = 30
    scroller.scrollTop = 10
    fireEvent.scroll(scroller)
    await waitFor(() =>
      expect(frame).toHaveStyle({ left: "74px", top: "34px" })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "放大 Excel 工作簿" })
    )
    await waitFor(() => {
      if (!(frame instanceof HTMLElement))
        throw new Error("Missing annotation frame")
      expect(Number.parseFloat(frame.style.left)).toBeCloseTo(84.4)
      expect(Number.parseFloat(frame.style.top)).toBeCloseTo(38.4)
      expect(Number.parseFloat(frame.style.width)).toBeCloseTo(140.8)
      expect(Number.parseFloat(frame.style.height)).toBeCloseTo(44)
    })
    expect(frame).toHaveTextContent("1")
    scroller.scrollLeft = 500
    scroller.scrollTop = 500
    fireEvent.scroll(scroller)
    await waitFor(() =>
      expect(screen.queryByTestId("spreadsheet-annotation-overlay")).toBeNull()
    )
    scroller.scrollLeft = 0
    scroller.scrollTop = 0
    fireEvent.scroll(scroller)
    const restoredOverlay = await screen.findByTestId(
      "spreadsheet-annotation-overlay"
    )
    expect(restoredOverlay).toHaveTextContent("1")
  })

  it("opens the annotation worksheet and scrolls its range into view", async () => {
    const documentState = {
      status: "ready" as const,
      content: new Uint8Array([1, 2, 3]),
    }
    const marker = {
      id: "draft-sheet-3",
      index: 1,
      selection: {
        type: "range" as const,
        sheetName: "明细",
        sheetIndex: 2,
        rangeAddress: "K21:L22",
        startRow: 20,
        startColumn: 10,
        endRow: 21,
        endColumn: 11,
      },
    }
    const { rerender } = render(
      <SpreadsheetPreview
        document={documentState}
        fileName="locate.xlsx"
        annotationMarkers={[marker]}
        onClose={vi.fn()}
      />
    )

    const scroller = screen.getByTestId("xlsx-scroller-content").parentElement
    if (!(scroller instanceof HTMLElement)) {
      throw new Error("Missing mock spreadsheet scroller")
    }
    const scrollTo = vi.fn(({ left, top }: ScrollToOptions) => {
      scroller.scrollLeft = left ?? 0
      scroller.scrollTop = top ?? 0
    })
    Object.defineProperty(scroller, "scrollTo", {
      configurable: true,
      value: scrollTo,
    })

    rerender(
      <SpreadsheetPreview
        document={documentState}
        fileName="locate.xlsx"
        annotationMarkers={[marker]}
        annotationNavigation={{ id: marker.id, sequence: 1 }}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(xlsx.lastSelectedTabIndex).toBe(2))
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({
        left: 564,
        top: 324,
        behavior: "smooth",
      })
    )
  })

  it("passes a normalized preview copy to the XLSX controller", async () => {
    const original = await createAbsoluteTargetWorkbook()
    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: original }}
        fileName="openpyxl-chart.xlsx"
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(xlsx.lastOptions?.file).toBeInstanceOf(ArrayBuffer)
    )
    const preparedFile = xlsx.lastOptions?.file
    expect(preparedFile).toBeInstanceOf(ArrayBuffer)
    const preparedZip = await JSZip.loadAsync(preparedFile!)
    expect(
      await preparedZip
        .file("xl/worksheets/_rels/sheet1.xml.rels")!
        .async("string")
    ).toContain('Target="../drawings/drawing1.xml"')

    const originalZip = await JSZip.loadAsync(original)
    expect(
      await originalZip
        .file("xl/worksheets/_rels/sheet1.xml.rels")!
        .async("string")
    ).toContain('Target="/xl/drawings/drawing1.xml"')
  })

  it("renders every workbook tab and switches the active worksheet", async () => {
    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([7, 8, 9]) }}
        fileName="multi-sheet.xlsx"
        onClose={vi.fn()}
      />
    )

    const tabList = screen.getByRole("tablist", { name: "工作表" })
    expect(tabList).toBeVisible()
    expect(tabList).toHaveClass("min-h-8")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "汇总",
      "预算",
      "明细",
    ])
    expect(screen.getByRole("tab", { name: "预算" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(
      document.querySelector(".office-preview-location-count")
    ).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "预算" })).toHaveClass(
      "min-h-7",
      "rounded-md",
      "px-2.5",
      "py-0.5",
      "text-xs",
      "data-active:bg-[var(--app-user-surface)]!",
      "data-active:text-foreground!",
      "data-active:shadow-none",
      "data-active:after:hidden"
    )

    await userEvent.click(screen.getByRole("tab", { name: "明细" }))

    expect(xlsx.lastSelectedTabIndex).toBe(2)
    expect(screen.getByRole("tab", { name: "明细" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByRole("tab", { name: "明细" })).toHaveClass(
      "min-h-7",
      "rounded-md",
      "px-2.5",
      "py-0.5",
      "text-xs",
      "data-active:bg-[var(--app-user-surface)]!",
      "data-active:text-foreground!",
      "data-active:shadow-none",
      "data-active:after:hidden"
    )
    expect(
      document.querySelector(".office-preview-location-count")
    ).not.toBeInTheDocument()

    await i18n.changeLanguage("en-US")
    expect(
      await screen.findByRole("tablist", { name: "Worksheets" })
    ).toBeVisible()
  })

  it("falls back to the main thread when the workbook Worker fails", async () => {
    xlsx.workerError = new Error("Worker request failed.")

    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="worker-fallback.xlsx"
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(xlsx.lastOptions).toMatchObject({ useWorker: false })
    )
    expect(xlsx.loadModeHistory).toEqual([true, false])
    expect(screen.getByTestId("xlsx-viewer")).toBeVisible()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("falls back to the main thread when the workbook Worker stalls", async () => {
    vi.useFakeTimers()
    xlsx.workerLoading = true

    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([4, 5, 6]) }}
        fileName="worker-timeout.xlsx"
        onClose={vi.fn()}
      />
    )

    expect(xlsx.lastOptions).toMatchObject({ useWorker: true })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(15_000)
    })

    expect(xlsx.lastOptions).toMatchObject({ useWorker: false })
    expect(xlsx.loadModeHistory).toEqual([true, false])
    expect(screen.getByTestId("xlsx-viewer")).toBeVisible()
  })

  it("shows the final error only after both Worker and main-thread parsing fail", async () => {
    xlsx.workerError = new Error("Worker request failed.")
    xlsx.mainThreadError = new Error("Workbook parse failed.")

    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([7, 8, 9]) }}
        fileName="invalid.xlsx"
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法预览此文档，请重试。"
    )
    expect(xlsx.loadModeHistory).toEqual([true, false])
    expect(xlsx.lastOptions).toMatchObject({ useWorker: false })
  })

  it("tries the Worker again when the workbook content changes", async () => {
    xlsx.workerError = new Error("Worker request failed.")
    const { rerender } = render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([10, 11, 12]) }}
        fileName="updated.xlsx"
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(xlsx.lastOptions).toMatchObject({ useWorker: false })
    )

    xlsx.workerError = null
    rerender(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([13, 14, 15]) }}
        fileName="updated.xlsx"
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(xlsx.lastOptions).toMatchObject({ useWorker: true })
    )
    expect(xlsx.loadModeHistory).toEqual([true, false, true])
  })

  it("exposes bounded image and chart selections without workbook payloads", async () => {
    mockOfficeSelectionLayout()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <SpreadsheetPreview
        document={{ status: "ready", content: new Uint8Array([4, 5, 6]) }}
        fileName="dashboard.xlsx"
        selectionAction={createSelectionAction(onSubmit)}
        onClose={vi.fn()}
      />
    )

    const scroller = screen.getByTestId("xlsx-scroller-content").parentElement
    if (!scroller) throw new Error("Missing spreadsheet scroller")
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(300, 100, 360, 240)
    )
    fireEvent.scroll(scroller)
    await userEvent.click(screen.getByRole("button", { name: "Select image" }))
    const imageFill = await screen.findByTestId(
      "spreadsheet-selection-fill-overlay"
    )
    expect(imageFill.firstElementChild).toHaveClass(
      "bg-[color-mix(in_srgb,var(--app-selection)_12%,transparent)]"
    )
    expect(screen.getByTestId("xlsx-viewer")).toHaveAttribute(
      "data-selection-fill",
      "color-mix(in srgb, var(--app-selection) 12%, transparent)"
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /问 LinkSense/u }).style.transform
      ).toBe("translate(197px, 133px)")
    )
    await submitCurrentSelection("替换这张图片")
    expect(onSubmit).toHaveBeenLastCalledWith(
      {
        type: "image",
        sheetName: "预算",
        sheetIndex: 1,
        objectId: "image-8",
        name: "Logo",
        description: "Company logo",
        anchor: {
          kind: "absolute",
          positionEmu: { x: 100, y: 200 },
          sizeEmu: { cx: 300, cy: 400 },
        },
      },
      "替换这张图片"
    )
    expect(onSubmit.mock.calls.at(-1)?.[0]).not.toHaveProperty("src")

    await userEvent.click(screen.getByRole("button", { name: "Select chart" }))
    expect(
      await screen.findByTestId("spreadsheet-selection-fill-overlay")
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /问 LinkSense/u }).style.transform
      ).toBe("translate(197px, 133px)")
    )
    await submitCurrentSelection("改成折线图")
    expect(onSubmit).toHaveBeenLastCalledWith(
      {
        type: "chart",
        sheetName: "预算",
        sheetIndex: 1,
        objectId: "chart-3",
        name: "Revenue",
        title: "Quarterly revenue",
        chartType: "bar",
        anchor: {
          kind: "absolute",
          positionEmu: { x: 300, y: 400 },
          sizeEmu: { cx: 500, cy: 600 },
        },
        element: {
          kind: "series",
          chartId: "chart-3",
          seriesId: "series-2",
          seriesIndex: 1,
        },
        formula: "预算!$B$2:$B$5",
      },
      "改成折线图"
    )
    expect(onSubmit.mock.calls.at(-1)?.[0]).not.toHaveProperty("series")
    expect(onSubmit.mock.calls.at(-1)?.[0]).not.toHaveProperty("raw")
  })
})
