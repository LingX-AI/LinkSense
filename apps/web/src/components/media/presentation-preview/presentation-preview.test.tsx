import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PresentationPreview } from "@/components/media/presentation-preview/presentation-preview"
import { mockOfficeSelectionLayout } from "@/test/office-selection-layout"
import type {
  PresentationAnnotationMarker,
  PresentationSelectionAction,
} from "@/components/media/presentation-preview/presentation-preview.types"
import i18n from "@/i18n"

const viewer = vi.hoisted(() => ({
  activeSlideIndex: 0,
  ignoreLoadingState: false,
  loading: false,
  reportSlideCountWhileLoading: false,
  slideCount: 4,
  viewportWidth: 1_000,
  viewportHeight: 800,
  slideWrapperWidth: 0,
  slideWrapperHeight: 0,
  zoom: 1,
  clearSelection: vi.fn(),
  selectElements: vi.fn(),
  setZoom: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomReset: vi.fn(),
  goTo: vi.fn(),
  slideItemClick: vi.fn(),
  elementPointerDown: vi.fn(),
  elementMouseDown: vi.fn(),
  elementMouseEnter: vi.fn(),
  elementDragStart: vi.fn(),
  elementDoubleClick: vi.fn(),
  elementContextMenu: vi.fn(),
  dirtyChange: undefined as ((dirty: boolean) => void) | undefined,
  compactLayout: true,
  setCompactLayout: undefined as ((compact: boolean) => void) | undefined,
  setLoading: undefined as ((loading: boolean) => void) | undefined,
  mountCount: 0,
}))

vi.mock("pptx-react-viewer", async () => {
  const React = await import("react")
  const elements = [
    {
      id: "title-1",
      shapeId: "42",
      type: "text",
      name: "Title",
      text: "认识人工智能",
      x: 120,
      y: 80,
      width: 520,
      height: 90,
    },
    {
      id: "image-1",
      type: "image",
      altText: "AI network diagram",
      x: 720,
      y: 60,
      width: 180,
      height: 260,
    },
    {
      id: "shape-1",
      type: "shape",
      name: "Hexagon",
      x: 320,
      y: 260,
      width: 120,
      height: 120,
    },
    {
      id: "connector-1",
      type: "connector",
      name: "Arrow connector",
      x: 460,
      y: 420,
      width: 260,
      height: 20,
    },
    {
      id: "table-1",
      type: "table",
      name: "Comparison table",
      x: 240,
      y: 500,
      width: 500,
      height: 180,
    },
  ]

  const PowerPointViewer = React.forwardRef(function PowerPointViewer(
    props: {
      canEdit?: boolean
      loadingState?: React.ReactNode
      onSelectionChange?: (ids: string[]) => void
      onActiveSlideChange?: (index: number) => void
      onZoomChange?: (zoom: number) => void
      onSlideCountChange?: (count: number) => void
      onDirtyChange?: (dirty: boolean) => void
    },
    ref: React.ForwardedRef<unknown>
  ) {
    const {
      onActiveSlideChange,
      onDirtyChange,
      onSelectionChange,
      onSlideCountChange,
      onZoomChange,
    } = props
    const [compactLayout, setCompactLayout] = React.useState(
      viewer.compactLayout
    )
    const [loading, setLoading] = React.useState(viewer.loading)
    const [slidesPaneOpen, setSlidesPaneOpen] = React.useState(true)
    const [activeSlideIndex, setActiveSlideIndex] = React.useState(
      viewer.activeSlideIndex
    )
    const [selectedIds, setSelectedIds] = React.useState<string[]>([])
    viewer.setCompactLayout = setCompactLayout
    viewer.setLoading = (nextLoading) => {
      viewer.loading = nextLoading
      setLoading(nextLoading)
    }
    const navigateToSlide = (slideIndex: number) => {
      viewer.activeSlideIndex = slideIndex
      setActiveSlideIndex(slideIndex)
    }
    React.useEffect(() => {
      viewer.mountCount += 1
    }, [])
    React.useEffect(
      () =>
        onSlideCountChange?.(
          loading && !viewer.reportSlideCountWhileLoading
            ? 0
            : viewer.slideCount
        ),
      [loading, onSlideCountChange]
    )
    React.useEffect(
      () => onActiveSlideChange?.(activeSlideIndex),
      [activeSlideIndex, onActiveSlideChange]
    )
    React.useEffect(() => onZoomChange?.(viewer.zoom), [onZoomChange])
    React.useEffect(
      () => onSelectionChange?.(selectedIds),
      [onSelectionChange, selectedIds]
    )
    viewer.dirtyChange = onDirtyChange

    React.useImperativeHandle(ref, () => ({
      getActiveSlideIndex: () => viewer.activeSlideIndex,
      getElements: () => elements,
      getElementById: (id: string) => elements.find((item) => item.id === id),
      getSelectedElementIds: () => selectedIds,
      selectElements: (ids: string[]) => {
        viewer.selectElements(ids)
        setSelectedIds(ids)
      },
      clearSelection: () => {
        viewer.clearSelection()
        setSelectedIds([])
      },
      goTo: (slideIndex: number) => {
        viewer.goTo(slideIndex)
        navigateToSlide(slideIndex)
      },
      getZoom: () => viewer.zoom,
      setZoom: (zoom: number) => {
        viewer.zoom = zoom
        viewer.setZoom(zoom)
        props.onZoomChange?.(zoom)
      },
      zoomIn: () => {
        viewer.zoomIn()
        viewer.zoom = 1.25
        props.onZoomChange?.(1.25)
      },
      zoomOut: () => {
        viewer.zoomOut()
        viewer.zoom = 0.75
        props.onZoomChange?.(0.75)
      },
      zoomReset: () => {
        viewer.zoomReset()
        viewer.zoom = 1
        props.onZoomChange?.(1)
      },
    }))

    if (loading) {
      const nativeLoadingState = React.createElement(
        "div",
        { "data-testid": "pptx-default-loading" },
        React.createElement("svg", { className: "animate-spin" }),
        "PPTX default loading"
      )
      return React.createElement(
        "div",
        { "data-pptx-viewer": "" },
        viewer.ignoreLoadingState
          ? nativeLoadingState
          : props.loadingState !== undefined
            ? props.loadingState
            : nativeLoadingState
      )
    }

    const elementRects = {
      "title-1": { left: 200, top: 160, width: 400, height: 80 },
      "image-1": { left: 650, top: 140, width: 180, height: 260 },
      "shape-1": { left: 320, top: 300, width: 120, height: 120 },
      "connector-1": { left: 460, top: 460, width: 260, height: 20 },
      "table-1": { left: 240, top: 520, width: 500, height: 180 },
    } as const
    const setElementRect =
      (elementId: keyof typeof elementRects) =>
      (node: HTMLDivElement | null) => {
        if (!node) return
        const rect = elementRects[elementId]
        node.getBoundingClientRect = () =>
          ({
            x: rect.left,
            y: rect.top,
            top: rect.top,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            toJSON: () => ({}),
          }) as DOMRect
      }
    const setSlideWrapperRect = (node: HTMLDivElement | null) => {
      if (!node || node.dataset.testRectInitialized === "true") return
      node.dataset.testRectInitialized = "true"
      node.getBoundingClientRect = () => {
        const width = viewer.slideWrapperWidth || elementRects["title-1"].width
        const height =
          viewer.slideWrapperHeight || elementRects["title-1"].height
        return {
          x: 200,
          y: 160,
          top: 160,
          right: 200 + width,
          bottom: 160 + height,
          left: 200,
          width,
          height,
          toJSON: () => ({}),
        } as DOMRect
      }
    }

    const setViewportRect = (node: HTMLDivElement | null) => {
      if (!node || node.dataset.testRectInitialized === "true") return
      node.dataset.testRectInitialized = "true"
      Object.defineProperty(node, "clientWidth", {
        configurable: true,
        get: () => viewer.viewportWidth,
      })
      Object.defineProperty(node, "clientHeight", {
        configurable: true,
        get: () => viewer.viewportHeight,
      })
      node.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          top: 0,
          right: viewer.viewportWidth,
          bottom: viewer.viewportHeight,
          left: 0,
          width: viewer.viewportWidth,
          height: viewer.viewportHeight,
          toJSON: () => ({}),
        }) as DOMRect
    }

    const slideNavigation = React.createElement(
      "aside",
      { role: "navigation" },
      React.createElement(
        "div",
        null,
        Array.from({ length: viewer.slideCount }, (_, slideIndex) =>
          React.createElement(
            "div",
            {
              key: slideIndex,
              className: "group",
              onClick: () => viewer.slideItemClick(slideIndex),
            },
            React.createElement("span", null, slideIndex + 1),
            React.createElement(
              "div",
              {
                className:
                  slideIndex === activeSlideIndex
                    ? "border-primary/60"
                    : "border-transparent",
              },
              React.createElement(
                "div",
                { "data-testid": `thumbnail-visual-${slideIndex + 1}` },
                `Slide ${slideIndex + 1}`
              )
            )
          )
        )
      )
    )

    return React.createElement(
      "div",
      { "data-pptx-viewer": "", "data-can-edit": props.canEdit },
      React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "relative z-10" },
          !compactLayout && slidesPaneOpen ? slideNavigation : null,
          React.createElement(
            "div",
            { ref: setViewportRect, "data-pptx-viewport": true },
            React.createElement(
              "div",
              {
                ref: setSlideWrapperRect,
                "data-testid": "pptx-slide-wrapper",
              },
              React.createElement(
                "div",
                {
                  ref: setElementRect("title-1"),
                  "data-pptx-element": "true",
                  "data-element-id": "title-1",
                  "aria-selected": selectedIds.includes("title-1"),
                  onPointerDown: viewer.elementPointerDown,
                  onMouseDown: viewer.elementMouseDown,
                  onMouseEnter: viewer.elementMouseEnter,
                  onDragStart: viewer.elementDragStart,
                  onDoubleClick: viewer.elementDoubleClick,
                  onContextMenu: viewer.elementContextMenu,
                },
                React.createElement("span", null, "认识人工智能")
              ),
              React.createElement("div", {
                ref: setElementRect("image-1"),
                "data-pptx-element": "true",
                "data-element-id": "image-1",
                "aria-selected": selectedIds.includes("image-1"),
                style: {
                  overflow: "hidden",
                  clipPath: "inset(8% 12%)",
                },
              }),
              React.createElement("div", {
                ref: setElementRect("shape-1"),
                "data-pptx-element": "true",
                "data-element-id": "shape-1",
                "aria-selected": selectedIds.includes("shape-1"),
                style: {
                  clipPath:
                    "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)",
                },
              }),
              React.createElement("div", {
                ref: setElementRect("connector-1"),
                "data-pptx-element": "true",
                "data-element-id": "connector-1",
              }),
              React.createElement("div", {
                ref: setElementRect("table-1"),
                "data-pptx-element": "true",
                "data-element-id": "table-1",
                "aria-selected": selectedIds.includes("table-1"),
              }),
              React.createElement("div", {
                "data-pptx-element": "true",
                "data-element-id": "template-1",
              })
            )
          )
        ),
        compactLayout && slidesPaneOpen
          ? React.createElement(
              "div",
              { role: "dialog", "aria-modal": "true" },
              React.createElement("button", {
                type: "button",
                "aria-label": "Close",
                onClick: () => setSlidesPaneOpen(false),
              }),
              React.createElement(
                "div",
                null,
                React.createElement("div", null, "Slides"),
                React.createElement("div", null, slideNavigation)
              )
            )
          : null,
        React.createElement(
          "div",
          { role: "toolbar" },
          React.createElement(
            "button",
            {
              type: "button",
              "aria-label": "Toggle slides panel",
              onClick: () => setSlidesPaneOpen((open) => !open),
            },
            "Toggle slides panel"
          )
        ),
        compactLayout
          ? React.createElement(
              "div",
              { className: "contents" },
              React.createElement(
                "nav",
                { "aria-label": "Editor actions" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    "aria-pressed": slidesPaneOpen,
                    onClick: () => setSlidesPaneOpen((open) => !open),
                  },
                  "Slides"
                ),
                ["Insert", "Format", "Comments", "Notes"].map((label) =>
                  React.createElement(
                    "button",
                    { key: label, type: "button", "aria-pressed": false },
                    label
                  )
                )
              )
            )
          : null
      )
    )
  })

  return { PowerPointViewer }
})

function createSelectionAction(
  onSubmit: PresentationSelectionAction["onSubmit"] = vi
    .fn()
    .mockResolvedValue(undefined)
): PresentationSelectionAction {
  return {
    label: "问 LinkSense",
    shortcutLabel: "⌘I",
    promptLabel: "描述对所选元素的要求",
    placeholder: "描述要修改的内容或提出问题",
    submitLabel: "发送要求",
    errorMessage: "发送失败，请重试",
    onSubmit,
  }
}

function setBoundingRect(
  element: HTMLElement,
  rect: { left: number; top: number; width: number; height: number }
) {
  element.getBoundingClientRect = () =>
    ({
      x: rect.left,
      y: rect.top,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }) as DOMRect
}

function controlAnimationFrames() {
  let sequence = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++sequence
    callbacks.set(id, callback)
    return id
  })
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id)
  })

  return async () => {
    await act(async () => {
      const frame = [...callbacks.entries()]
      for (const [id, callback] of frame) {
        if (!callbacks.delete(id)) continue
        callback(performance.now())
      }
    })
  }
}

describe("presentation preview", () => {
  beforeEach(async () => {
    viewer.activeSlideIndex = 0
    viewer.ignoreLoadingState = false
    viewer.loading = false
    viewer.reportSlideCountWhileLoading = false
    viewer.slideCount = 4
    viewer.viewportWidth = 1_000
    viewer.viewportHeight = 800
    viewer.slideWrapperWidth = 0
    viewer.slideWrapperHeight = 0
    viewer.zoom = 1
    viewer.dirtyChange = undefined
    viewer.compactLayout = true
    viewer.setCompactLayout = undefined
    viewer.setLoading = undefined
    viewer.mountCount = 0
    vi.clearAllMocks()
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders loading and retryable error states without mounting the viewer", async () => {
    const { rerender } = render(
      <PresentationPreview
        document={{ status: "loading" }}
        fileName="ai-introduction.pptx"
        onClose={vi.fn()}
      />
    )
    const loadingStatus = screen.getByRole("status")
    expect(screen.getByText("正在加载文档")).toHaveClass("shimmer")
    expect(loadingStatus.querySelector("svg")).toBeNull()

    const onRetry = vi.fn()
    rerender(
      <PresentationPreview
        document={{ status: "error" }}
        fileName="ai-introduction.pptx"
        onRetry={onRetry}
        onClose={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("replaces the pptx viewer loading UI with the shared shimmer state", () => {
    viewer.loading = true

    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="ai-introduction.pptx"
        onClose={vi.fn()}
      />
    )

    const loadingStatus = screen.getByRole("status")
    expect(screen.getByText("正在加载文档")).toHaveClass("shimmer")
    expect(loadingStatus.querySelector("svg")).toBeNull()
    expect(screen.queryByTestId("pptx-default-loading")).not.toBeInTheDocument()
  })

  it("keeps a stale pre-bundled pptx loader hidden behind the shared loading state", () => {
    viewer.loading = true
    viewer.ignoreLoadingState = true

    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="ai-introduction.pptx"
        onClose={vi.fn()}
      />
    )

    const adapter = screen.getByTestId("pptx-viewer-adapter")
    const nativeLoadingState = screen.getByTestId("pptx-default-loading")
    const viewerSurface = nativeLoadingState.closest(
      ".presentation-preview-pptx-surface"
    )

    expect(adapter).toHaveAttribute("data-pptx-ready", "false")
    expect(adapter).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("正在加载文档")).toHaveClass("shimmer")
    expect(viewerSurface).toHaveAttribute("aria-hidden", "true")
  })

  it("keeps the shared loading state until the pptx viewport is actually mounted", async () => {
    viewer.loading = true
    viewer.reportSlideCountWhileLoading = true

    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="ai-introduction.pptx"
        onClose={vi.fn()}
      />
    )

    const adapter = screen.getByTestId("pptx-viewer-adapter")
    const viewerSurface = document.querySelector(
      ".presentation-preview-pptx-surface"
    )

    expect(adapter).toHaveAttribute("data-pptx-ready", "false")
    expect(adapter).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("正在加载文档")).toHaveClass("shimmer")
    expect(viewerSurface).toHaveAttribute("aria-hidden", "true")

    act(() => viewer.setLoading?.(false))

    await waitFor(() =>
      expect(adapter).toHaveAttribute("data-pptx-ready", "true")
    )
    expect(adapter).toHaveAttribute("aria-busy", "false")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(viewerSurface).not.toHaveAttribute("aria-hidden")
    expect(screen.getByText("认识人工智能")).toBeVisible()
  })

  it("keeps an oversized mount frame covered until the slide has fitted the viewport", async () => {
    viewer.viewportWidth = 800
    viewer.viewportHeight = 600
    viewer.slideWrapperWidth = 1_280
    viewer.slideWrapperHeight = 720

    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="layout-stability.pptx"
        onClose={vi.fn()}
      />
    )

    const adapter = screen.getByTestId("pptx-viewer-adapter")
    const viewerSurface = document.querySelector(
      ".presentation-preview-pptx-surface"
    )
    expect(adapter).toHaveAttribute("data-pptx-ready", "false")
    expect(viewerSurface).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByText("正在加载文档")).toHaveClass("shimmer")

    viewer.slideWrapperWidth = 760
    viewer.slideWrapperHeight = 428
    fireEvent.resize(window)

    await waitFor(() =>
      expect(adapter).toHaveAttribute("data-pptx-ready", "true")
    )
    expect(viewerSurface).not.toHaveAttribute("aria-hidden")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("keeps fitting slides covered while their dimensions are still shrinking", async () => {
    const nextFrame = controlAnimationFrames()
    viewer.viewportWidth = 800
    viewer.viewportHeight = 600
    viewer.slideWrapperWidth = 780
    viewer.slideWrapperHeight = 440
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="settling-slide.pptx"
      />
    )

    const adapter = screen.getByTestId("pptx-viewer-adapter")
    const surface = document.querySelector(".presentation-preview-pptx-surface")
    await nextFrame()
    for (const width of [760, 740, 720]) {
      viewer.slideWrapperWidth = width
      viewer.slideWrapperHeight = (width * 9) / 16
      await nextFrame()
      expect(adapter).toHaveAttribute("data-pptx-ready", "false")
      expect(surface).toHaveAttribute("aria-hidden", "true")
    }

    await nextFrame()
    expect(adapter).toHaveAttribute("aria-busy", "true")
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "true")
    expect(surface).not.toHaveAttribute("aria-hidden")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()

    // Normal user resizing and zooming must not bring the loading mask back.
    viewer.viewportWidth = 640
    fireEvent.resize(window)
    fireEvent.click(screen.getByRole("button", { name: "放大演示文稿" }))
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "true")
    expect(viewer.zoomIn).toHaveBeenCalledOnce()
    expect(viewer.mountCount).toBe(1)
  })

  it("waits for the viewport dimensions and compact navigation layout to settle", async () => {
    const nextFrame = controlAnimationFrames()
    viewer.compactLayout = false
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="settling-pane.pptx"
      />
    )

    const adapter = screen.getByTestId("pptx-viewer-adapter")
    await nextFrame()
    viewer.viewportWidth = 720
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "false")
    viewer.viewportHeight = 560
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "false")
    await act(async () => viewer.setCompactLayout?.(true))
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "false")
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "false")
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "true")
  })

  it("keeps an unmeasured viewport covered until it has a usable size", async () => {
    const nextFrame = controlAnimationFrames()
    viewer.viewportWidth = 0
    viewer.viewportHeight = 0
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="unmeasured-pane.pptx"
      />
    )

    const adapter = screen.getByTestId("pptx-viewer-adapter")
    await nextFrame()
    await nextFrame()
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "false")
    expect(screen.getByRole("status")).toBeInTheDocument()

    viewer.viewportWidth = 800
    viewer.viewportHeight = 600
    await nextFrame()
    await nextFrame()
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "true")
  })

  it("includes the viewport padding when deciding whether the initial slide fits", async () => {
    const nextFrame = controlAnimationFrames()
    viewer.viewportWidth = 800
    viewer.viewportHeight = 600
    viewer.slideWrapperWidth = 798
    viewer.slideWrapperHeight = 570
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="canvas-gutters.pptx"
      />
    )

    const adapter = screen.getByTestId("pptx-viewer-adapter")
    const viewport = document.querySelector<HTMLElement>(
      "[data-pptx-viewport]"
    )!
    viewport.style.padding = "16px 4px"
    await nextFrame()
    await nextFrame()
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "false")

    viewer.slideWrapperWidth = 792
    viewer.slideWrapperHeight = 568
    await nextFrame()
    await nextFrame()
    await nextFrame()
    expect(adapter).toHaveAttribute("data-pptx-ready", "true")
  })

  it("exposes a compact download action without a dropdown affordance", async () => {
    const onDownload = vi.fn()
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="ai-introduction.pptx"
        onDownload={onDownload}
        onClose={vi.fn()}
      />
    )

    const download = screen.getByRole("button", {
      name: "下载文档 ai-introduction.pptx",
    })
    expect(download).not.toHaveTextContent("下载")
    expect(download.querySelector("span")).toBeNull()
    expect(download.querySelector(".lucide-download")).not.toBeNull()
    expect(download.querySelector(".lucide-chevron-down")).toBeNull()

    await userEvent.click(download)
    expect(onDownload).toHaveBeenCalledOnce()
    expect(screen.queryByText("打开")).not.toBeInTheDocument()

    await act(async () => i18n.changeLanguage("en-US"))
    expect(
      screen.getByRole("button", {
        name: "Download document ai-introduction.pptx",
      })
    ).not.toHaveTextContent("Download")
  })

  it("keeps the close action as the rightmost document action", async () => {
    const onClose = vi.fn()
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="header-controls.pptx"
        onDownload={vi.fn()}
        onClose={onClose}
      />
    )

    const header = document.querySelector<HTMLElement>(
      ".office-preview-header"
    )!
    const fileTab = header.querySelector<HTMLElement>(
      ".office-preview-file-tab"
    )!
    const headerActions = header.querySelector<HTMLElement>(
      ".office-preview-header-actions"
    )!
    const close = screen.getByRole("button", { name: "关闭文档预览" })
    const windowControls = header.querySelector<HTMLElement>(
      ".office-preview-window-controls"
    )!
    const documentControls = header.querySelector<HTMLElement>(
      ".office-preview-controls"
    )!

    expect(documentControls).not.toBeNull()
    expect(fileTab).not.toContainElement(close)
    expect(windowControls).toContainElement(close)
    expect(windowControls.lastElementChild).toBe(close)
    expect(
      fileTab.compareDocumentPosition(headerActions) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      documentControls.compareDocumentPosition(windowControls) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(document.querySelector(".office-preview-toolbar")).toBeNull()

    await userEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("uses the paired corner icons for entering and exiting full screen", async () => {
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="fullscreen-controls.pptx"
        onClose={vi.fn()}
      />
    )

    const enterFullscreen = screen.getByRole("button", {
      name: "全屏预览文档",
    })
    expect(
      enterFullscreen.querySelector(".lucide-office-preview-enter-fullscreen")
    ).not.toBeNull()
    expect(enterFullscreen.querySelectorAll("path")).toHaveLength(2)

    await userEvent.click(enterFullscreen)

    const exitFullscreen = screen.getByRole("button", {
      name: "退出全屏预览",
    })
    expect(
      exitFullscreen.querySelector(".lucide-office-preview-exit-fullscreen")
    ).not.toBeNull()
    expect(exitFullscreen.querySelectorAll("path")).toHaveLength(2)
  })

  it("keeps pptx-react-viewer read-only and returns a bounded element selection", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="ai-introduction.pptx"
        selectionAction={createSelectionAction(onSubmit)}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByTestId("pptx-viewer-adapter")).toBeVisible()
    expect(document.querySelector("[data-can-edit='false']")).not.toBeNull()

    const clearSelectionCount = viewer.clearSelection.mock.calls.length
    await userEvent.click(screen.getByText("认识人工智能"))
    const ask = await screen.findByRole("button", { name: /问 LinkSense/u })
    expect(viewer.clearSelection).toHaveBeenCalledTimes(clearSelectionCount)
    await userEvent.click(ask)
    const prompt = await screen.findByRole("textbox", {
      name: "描述对所选元素的要求",
    })
    expect(prompt).toHaveFocus()
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.type(prompt, "  改为英文  ")
    await userEvent.click(screen.getByRole("button", { name: "发送要求" }))

    expect(viewer.selectElements).toHaveBeenCalledWith(["title-1"])
    expect(onSubmit).toHaveBeenCalledWith(
      {
        slideIndex: 0,
        slideNumber: 1,
        elementIds: ["title-1"],
        elements: [
          {
            elementId: "title-1",
            shapeId: "42",
            type: "text",
            name: "Title",
            text: "认识人工智能",
            bounds: {
              x: 120,
              y: 80,
              width: 520,
              height: 90,
            },
          },
        ],
      },
      "改为英文"
    )
    await waitFor(() => expect(prompt).not.toBeInTheDocument())
  })

  it("restores the inline prompt after an optimistically closed submission fails", async () => {
    let rejectSubmission: ((reason?: unknown) => void) | undefined
    const failedSubmission = new Promise<void>((_, reject) => {
      rejectSubmission = reject
    })
    const onSubmit = vi
      .fn()
      .mockReturnValueOnce(failedSubmission)
      .mockResolvedValueOnce(undefined)
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="inline-prompt.pptx"
        selectionAction={createSelectionAction(onSubmit)}
        onClose={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText("认识人工智能"))
    await userEvent.click(
      await screen.findByRole("button", { name: /问 LinkSense/u })
    )
    const prompt = await screen.findByRole("textbox", {
      name: "描述对所选元素的要求",
    })
    const submit = screen.getByRole("button", { name: "发送要求" })
    expect(submit).toBeDisabled()

    await userEvent.type(prompt, "调整标题")
    await userEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(prompt).not.toBeInTheDocument()

    act(() => rejectSubmission?.(new Error("request failed")))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "发送失败，请重试"
    )
    const restoredPrompt = screen.getByRole("textbox", {
      name: "描述对所选元素的要求",
    })
    expect(restoredPrompt).toBeEnabled()
    expect(restoredPrompt).toHaveValue("调整标题")

    await userEvent.type(restoredPrompt, "并缩小字号{Enter}")
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ elementIds: ["title-1"] }),
      "调整标题并缩小字号"
    )
    await waitFor(() => expect(restoredPrompt).not.toBeInTheDocument())
  })

  it("dismisses and resets an unfinished prompt on Escape or selection change", async () => {
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="dismiss-prompt.pptx"
        selectionAction={createSelectionAction()}
        onClose={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText("认识人工智能"))
    const ask = await screen.findByRole("button", { name: /问 LinkSense/u })
    await userEvent.click(ask)
    let prompt = await screen.findByRole("textbox", {
      name: "描述对所选元素的要求",
    })
    await userEvent.type(prompt, "未发送的内容")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(prompt).not.toBeInTheDocument())

    await userEvent.click(ask)
    prompt = await screen.findByRole("textbox", {
      name: "描述对所选元素的要求",
    })
    expect(prompt).toHaveValue("")
    await userEvent.type(prompt, "另一段未发送内容")

    await userEvent.click(
      document.querySelector<HTMLElement>("[data-element-id='image-1']")!
    )
    await waitFor(() => expect(prompt).not.toBeInTheDocument())
    await waitFor(() =>
      expect(viewer.selectElements).toHaveBeenLastCalledWith(["image-1"])
    )
  })

  it("replaces the embedded mobile action bar with a compact slide navigator", async () => {
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="compact-navigation.pptx"
        onClose={vi.fn()}
      />
    )

    const adapter = screen.getByTestId("pptx-viewer-adapter")
    await waitFor(() =>
      expect(adapter).toHaveAttribute("data-pptx-ready", "true")
    )
    adapter.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        right: 800,
        bottom: 600,
        left: 0,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }) as DOMRect
    fireEvent.resize(window)
    await waitFor(() => {
      expect(
        adapter.style.getPropertyValue("--presentation-compact-slides-left")
      ).toBe("")
      expect(
        adapter.style.getPropertyValue("--presentation-compact-slides-top")
      ).toBe("")
      expect(
        adapter.style.getPropertyValue(
          "--presentation-compact-slides-panel-left"
        )
      ).toBe("")
    })
    const mobileActions = adapter.querySelector(
      "[data-pptx-viewer] > div > .contents > nav"
    )
    await waitFor(() =>
      expect(mobileActions).toHaveAttribute("data-pptx-mobile-actions", "true")
    )
    expect(adapter).toHaveAttribute("data-pptx-compact-layout", "true")

    const trigger = screen.getByRole("button", {
      name: "显示或隐藏幻灯片缩略图",
    })
    const viewport = adapter.querySelector<HTMLElement>("[data-pptx-viewport]")
    expect(trigger.parentElement).toBe(adapter)
    expect(viewport).not.toBeNull()
    expect(viewport).not.toContainElement(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(trigger.querySelector(".lucide-menu")).toBeNull()

    const slideWrapper = screen.getByTestId("pptx-slide-wrapper")
    slideWrapper.getBoundingClientRect = () =>
      ({
        x: 620,
        y: 430,
        top: 430,
        right: 740,
        bottom: 498,
        left: 620,
        width: 120,
        height: 68,
        toJSON: () => ({}),
      }) as DOMRect
    fireEvent.resize(window)
    await waitFor(() => {
      expect(
        adapter.style.getPropertyValue("--presentation-compact-slides-left")
      ).toBe("")
      expect(
        adapter.style.getPropertyValue("--presentation-compact-slides-top")
      ).toBe("")
      expect(
        adapter.style.getPropertyValue(
          "--presentation-compact-slides-panel-left"
        )
      ).toBe("")
    })

    const lines = [
      ...trigger.querySelectorAll<HTMLElement>(
        "[data-pptx-compact-slide-line]"
      ),
    ]
    expect(lines).toHaveLength(4)
    expect(lines[0]).toHaveAttribute("data-active", "true")
    lines
      .slice(1)
      .forEach((line) => expect(line).toHaveAttribute("data-active", "false"))

    fireEvent.pointerEnter(trigger, { pointerType: "mouse" })
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "true")
    )

    const sheet = await waitFor(() => {
      const element = adapter.querySelector<HTMLElement>(
        '[data-pptx-mobile-slides-sheet="true"]'
      )
      expect(element).not.toBeNull()
      return element!
    })
    expect(sheet).toHaveAttribute("aria-label", "幻灯片缩略图")
    expect(sheet).toHaveAttribute("aria-modal", "false")

    const firstSlide = within(sheet).getByRole("button", {
      name: "转到第 1 页",
    })
    const secondSlide = within(sheet).getByRole("button", {
      name: "转到第 2 页",
    })
    expect(
      within(sheet).getAllByRole("button", { name: /转到第 \d+ 页/u })
    ).toHaveLength(4)
    expect(firstSlide).toHaveAttribute("aria-current", "page")
    expect(firstSlide).toHaveAttribute("tabindex", "0")
    expect(secondSlide).toHaveAttribute("tabindex", "-1")
    expect(secondSlide).toHaveAttribute("data-pptx-compact-slide-index", "1")

    firstSlide.focus()
    fireEvent.keyDown(firstSlide, { key: "ArrowDown" })
    expect(secondSlide).toHaveFocus()
    const secondSlideThumbnail =
      within(secondSlide).getByTestId("thumbnail-visual-2")
    await userEvent.pointer([
      {
        target: secondSlideThumbnail,
        keys: "[MouseLeft>]",
        coords: { x: 100, y: 100 },
      },
      {
        target: secondSlideThumbnail,
        coords: { x: 106, y: 100 },
      },
      {
        target: secondSlideThumbnail,
        keys: "[/MouseLeft]",
        coords: { x: 106, y: 100 },
      },
    ])

    await waitFor(() => expect(screen.getByText("2 / 4")).toBeVisible())
    expect(viewer.goTo).toHaveBeenCalledWith(1)
    expect(viewer.slideItemClick).not.toHaveBeenCalled()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(lines[0]).toHaveAttribute("data-active", "false")
    expect(lines[1]).toHaveAttribute("data-active", "true")
    const retainedSheet = await waitFor(() => {
      const element = adapter.querySelector<HTMLElement>(
        '[data-pptx-mobile-slides-sheet="true"]'
      )
      expect(element).not.toBeNull()
      return element!
    })
    await waitFor(() =>
      expect(
        within(retainedSheet).getByRole("button", { name: "转到第 2 页" })
      ).toHaveAttribute("aria-current", "page")
    )
    expect(
      within(retainedSheet).getByRole("button", { name: "转到第 1 页" })
    ).not.toHaveAttribute("aria-current")
  })

  it("restores desktop slide thumbnails after shrinking and expanding the preview", async () => {
    viewer.compactLayout = false
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="responsive-navigation.pptx"
        onClose={vi.fn()}
      />
    )

    const adapter = screen.getByTestId("pptx-viewer-adapter")
    await waitFor(() =>
      expect(adapter).toHaveAttribute("data-pptx-ready", "true")
    )
    const desktopNavigationSelector =
      '[data-pptx-viewer] > div > .relative.z-10 > aside[role="navigation"]'
    expect(adapter.querySelector(desktopNavigationSelector)).not.toBeNull()

    act(() => viewer.setCompactLayout?.(true))
    const mobileActions = await waitFor(() => {
      const actions = adapter.querySelector<HTMLElement>(
        "[data-pptx-viewer] > div > .contents > nav"
      )
      expect(actions).not.toBeNull()
      return actions!
    })
    await waitFor(() =>
      expect(
        mobileActions.querySelector(":scope > button:first-of-type")
      ).toHaveAttribute("aria-pressed", "false")
    )
    expect(adapter.querySelector(desktopNavigationSelector)).toBeNull()

    const trigger = screen.getByRole("button", {
      name: "显示或隐藏幻灯片缩略图",
    })
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" })
    const sheet = await waitFor(() => {
      const element = adapter.querySelector<HTMLElement>(
        '[data-pptx-mobile-slides-sheet="true"]'
      )
      expect(element).not.toBeNull()
      return element!
    })
    await userEvent.click(
      within(sheet).getByRole("button", { name: "转到第 2 页" })
    )
    await waitFor(() => expect(screen.getByText("2 / 4")).toBeVisible())

    act(() => viewer.setCompactLayout?.(false))
    const desktopNavigation = await waitFor(() => {
      const navigation = adapter.querySelector<HTMLElement>(
        desktopNavigationSelector
      )
      expect(navigation).not.toBeNull()
      return navigation!
    })
    expect(adapter).toHaveAttribute("data-pptx-compact-layout", "false")
    expect(
      within(desktopNavigation).getByText("Slide 2").parentElement
    ).toHaveClass("border-primary/60")
    expect(
      adapter.querySelector('[data-pptx-mobile-slides-sheet="true"]')
    ).toBeNull()
    expect(viewer.mountCount).toBe(1)
  })

  it("blocks editing gestures while preserving keyboard selection and zoom controls", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="readonly.pptx"
        selectionAction={createSelectionAction(onSubmit)}
        onClose={vi.fn()}
      />
    )
    const element = screen.getByText("认识人工智能").parentElement!

    fireEvent.pointerDown(element)
    fireEvent.mouseDown(element)
    fireEvent.mouseEnter(element)
    fireEvent.dragStart(element)
    fireEvent.doubleClick(element)
    fireEvent.contextMenu(element)
    fireEvent.keyDown(element, { key: "Delete" })
    fireEvent.keyDown(element, { key: "v", metaKey: true })
    expect(viewer.elementPointerDown).not.toHaveBeenCalled()
    expect(viewer.elementMouseDown).not.toHaveBeenCalled()
    expect(viewer.elementMouseEnter).not.toHaveBeenCalled()
    expect(viewer.elementDragStart).not.toHaveBeenCalled()
    expect(viewer.elementDoubleClick).not.toHaveBeenCalled()
    expect(viewer.elementContextMenu).not.toHaveBeenCalled()

    element.focus()
    fireEvent.keyDown(element, { key: "Enter" })
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /问 LinkSense/u })
      ).toBeVisible()
    )

    await userEvent.click(screen.getByRole("button", { name: "放大演示文稿" }))
    expect(viewer.zoomIn).toHaveBeenCalledOnce()
    expect(screen.getByText("125%")).toBeVisible()

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: true })),
    })
    fireEvent.keyDown(window, { key: "i", metaKey: true })
    expect(
      await screen.findByRole("textbox", {
        name: "描述对所选元素的要求",
      })
    ).toHaveFocus()
    expect(onSubmit).not.toHaveBeenCalled()

    act(() => viewer.dirtyChange?.(true))
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /问 LinkSense/u })
      ).not.toBeInTheDocument()
    )
    expect(viewer.mountCount).toBe(2)
  })

  it("pans a fitted slide and only zooms for a trackpad pinch, not two-finger scrolling", async () => {
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="gestures.pptx"
        selectionAction={createSelectionAction()}
        onClose={vi.fn()}
      />
    )

    const viewport = document.querySelector<HTMLElement>(
      "[data-pptx-viewport]"
    )!
    const slideWrapper = screen.getByTestId("pptx-slide-wrapper")
    const adapter = screen.getByTestId("pptx-viewer-adapter")
    const element = screen.getByText("认识人工智能").parentElement!
    setBoundingRect(viewport, {
      left: 100,
      top: 100,
      width: 900,
      height: 700,
    })
    slideWrapper.getBoundingClientRect = () => {
      const width = 400 * viewer.zoom
      const height = 225 * viewer.zoom
      const panX = Number.parseFloat(
        adapter.style.getPropertyValue("--presentation-pan-x") || "0"
      )
      const panY = Number.parseFloat(
        adapter.style.getPropertyValue("--presentation-pan-y") || "0"
      )
      const left = 550 - width / 2 + panX
      const top = 412.5 - height / 2 + panY
      return {
        x: left,
        y: top,
        top,
        right: left + width,
        bottom: top + height,
        left,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect
    }

    await waitFor(() =>
      expect(adapter).toHaveAttribute("data-pptx-ready", "true")
    )

    fireEvent.pointerDown(element, {
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      pointerType: "mouse",
    })
    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 70,
      clientY: 60,
      pointerId: 1,
      pointerType: "mouse",
    })
    fireEvent.pointerUp(window, {
      buttons: 0,
      clientX: 70,
      clientY: 60,
      pointerId: 1,
      pointerType: "mouse",
    })
    fireEvent.click(element, { detail: 1 })

    expect(adapter.style.getPropertyValue("--presentation-pan-x")).toBe("-30px")
    expect(adapter.style.getPropertyValue("--presentation-pan-y")).toBe("-40px")
    expect(adapter).toHaveAttribute("data-pptx-panning", "false")
    expect(viewer.selectElements).not.toHaveBeenCalled()

    viewer.setZoom.mockClear()
    const twoFingerScrollEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 500,
      clientY: 400,
      deltaY: -100,
    })
    fireEvent(viewport, twoFingerScrollEvent)
    expect(viewer.setZoom).not.toHaveBeenCalled()
    expect(twoFingerScrollEvent.defaultPrevented).toBe(false)

    const prePinchSlideRect = slideWrapper.getBoundingClientRect()
    const pinchRatioX = (500 - prePinchSlideRect.left) / prePinchSlideRect.width
    const browserPinchEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: 500,
      clientY: 400,
      deltaY: -10,
    })
    fireEvent(viewport, browserPinchEvent)
    expect(viewer.setZoom).toHaveBeenLastCalledWith(1.1)
    expect(browserPinchEvent.defaultPrevented).toBe(true)
    await waitFor(() => {
      const anchoredSlideRect = slideWrapper.getBoundingClientRect()
      expect(
        anchoredSlideRect.left + pinchRatioX * anchoredSlideRect.width
      ).toBeCloseTo(500, 1)
    })

    viewer.setZoom.mockClear()
    fireEvent.wheel(
      screen.getByRole("button", { name: "Toggle slides panel" }),
      {
        deltaY: -100,
      }
    )
    expect(viewer.setZoom).not.toHaveBeenCalled()

    const compactTrigger = screen.getByRole("button", {
      name: "显示或隐藏幻灯片缩略图",
    })
    fireEvent.pointerEnter(compactTrigger, { pointerType: "mouse" })
    const compactSheet = await waitFor(() => {
      const sheet = adapter.querySelector<HTMLElement>(
        '[data-pptx-mobile-slides-sheet="true"]'
      )
      expect(sheet).not.toBeNull()
      return sheet!
    })
    fireEvent.click(
      within(compactSheet).getByRole("button", { name: "转到第 2 页" })
    )
    await waitFor(() => expect(screen.getByText("2 / 4")).toBeVisible())
    expect(adapter.style.getPropertyValue("--presentation-pan-x")).toBe("0px")
    expect(adapter.style.getPropertyValue("--presentation-pan-y")).toBe("0px")
    expect(viewer.zoom).toBe(1.1)

    const zoomToMaximum = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: 500,
      clientY: 400,
      deltaY: -100_000,
    })
    fireEvent(viewport, zoomToMaximum)
    expect(viewer.setZoom).toHaveBeenLastCalledWith(5)
  })

  it("zooms a slide around the midpoint of a two-finger touch pinch", () => {
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="touch-pinch.pptx"
        selectionAction={createSelectionAction()}
        onClose={vi.fn()}
      />
    )

    const viewport = document.querySelector<HTMLElement>(
      "[data-pptx-viewport]"
    )!
    const slideWrapper = screen.getByTestId("pptx-slide-wrapper")
    setBoundingRect(viewport, {
      left: 100,
      top: 100,
      width: 900,
      height: 700,
    })
    setBoundingRect(slideWrapper, {
      left: 350,
      top: 300,
      width: 400,
      height: 225,
    })

    const touch = (identifier: number, clientX: number, clientY: number) => ({
      identifier,
      target: viewport,
      clientX,
      clientY,
      pageX: clientX,
      pageY: clientY,
      screenX: clientX,
      screenY: clientY,
    })
    const firstTouch = touch(1, 450, 400)
    const secondTouch = touch(2, 550, 400)
    fireEvent.touchStart(viewport, {
      touches: [firstTouch, secondTouch],
      targetTouches: [firstTouch, secondTouch],
      changedTouches: [firstTouch, secondTouch],
    })

    const expandedSecondTouch = touch(2, 650, 400)
    fireEvent.touchMove(viewport, {
      touches: [firstTouch, expandedSecondTouch],
      targetTouches: [firstTouch, expandedSecondTouch],
      changedTouches: [expandedSecondTouch],
    })

    expect(viewer.setZoom).toHaveBeenLastCalledWith(2)
  })

  it("previews slide elements on hover without duplicating retained annotation frames", async () => {
    const documentState = {
      status: "ready" as const,
      content: new Uint8Array([1]),
    }
    const action = createSelectionAction(vi.fn().mockResolvedValue(undefined))
    const marker: PresentationAnnotationMarker = {
      id: "hover-mark",
      index: 1,
      selection: {
        slideIndex: 0,
        slideNumber: 1,
        elementIds: ["title-1"],
        elements: [],
      },
    }
    const { rerender } = render(
      <PresentationPreview
        document={documentState}
        fileName="hover.pptx"
        selectionAction={action}
      />
    )
    const overlay = await screen.findByTestId("office-annotation-hover-overlay")
    const viewport = document.querySelector<HTMLElement>("[data-pptx-viewport]")
    const target = screen.getByText("认识人工智能").parentElement
    if (!viewport || !target) throw new Error("Missing slide viewport")
    await waitFor(() =>
      expect(viewport).toHaveAttribute("data-office-annotation-scope", "true")
    )
    setBoundingRect(viewport, { left: 100, top: 100, width: 900, height: 700 })
    setBoundingRect(overlay, { left: 100, top: 100, width: 900, height: 700 })
    setBoundingRect(target, { left: 200, top: 160, width: 400, height: 80 })
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target)
    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      buttons: 0,
      clientX: 220,
      clientY: 200,
    })
    await waitFor(() =>
      expect(overlay.querySelector("path")).toHaveAttribute(
        "d",
        "M100,60H500V140H100Z"
      )
    )
    expect(target).toHaveAttribute("aria-selected", "false")
    expect(screen.queryByRole("button", { name: /问 LinkSense/u })).toBeNull()
    rerender(
      <PresentationPreview
        document={documentState}
        fileName="hover.pptx"
        selectionAction={action}
        annotationMarkers={[marker]}
      />
    )
    await waitFor(() =>
      expect(overlay.querySelector("path")?.getAttribute("d") || "").toBe("")
    )
    rerender(
      <PresentationPreview
        document={documentState}
        fileName="hover.pptx"
        annotationMarkers={[marker]}
      />
    )
    expect(screen.queryByTestId("office-annotation-hover-overlay")).toBeNull()
    expect(viewport).not.toHaveAttribute("data-office-annotation-scope")
  })

  it("supports additive selection while leaving template elements inert", async () => {
    mockOfficeSelectionLayout()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="selection.pptx"
        selectionAction={createSelectionAction(onSubmit)}
        onClose={vi.fn()}
      />
    )

    const title = screen.getByText("认识人工智能").parentElement!
    const image = document.querySelector<HTMLElement>(
      "[data-element-id='image-1']"
    )!
    const template = document.querySelector<HTMLElement>(
      "[data-element-id='template-1']"
    )!
    setBoundingRect(screen.getByTestId("pptx-viewer-adapter"), {
      left: 100,
      top: 100,
      width: 900,
      height: 700,
    })
    setBoundingRect(document.querySelector("[data-pptx-viewport]")!, {
      left: 100,
      top: 100,
      width: 900,
      height: 700,
    })

    await userEvent.click(title)
    await waitFor(() => expect(title).toHaveAttribute("aria-selected", "true"))
    expect(image).toHaveAttribute("aria-selected", "false")
    await waitFor(() => {
      expect(
        document.querySelector("[data-pptx-selection-frame='title-1']")
      ).toHaveStyle({
        left: "100px",
        top: "60px",
        width: "400px",
        height: "80px",
      })
    })
    fireEvent.click(image, { shiftKey: true })
    await waitFor(() => expect(image).toHaveAttribute("aria-selected", "true"))
    expect(title).toHaveAttribute("aria-selected", "true")
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /问 LinkSense/u }).style.transform
      ).toBe("translate(686px, 408px)")
    )
    await waitFor(() => {
      expect(
        document.querySelector("[data-pptx-selection-frame='image-1']")
      ).toHaveStyle({
        left: "550px",
        top: "40px",
        width: "180px",
        height: "260px",
      })
    })
    await userEvent.click(
      await screen.findByRole("button", { name: /问 LinkSense/u })
    )
    await userEvent.type(
      await screen.findByRole("textbox", {
        name: "描述对所选元素的要求",
      }),
      "总结这些元素"
    )
    await userEvent.click(screen.getByRole("button", { name: "发送要求" }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        elementIds: ["title-1", "image-1"],
        elements: [
          expect.objectContaining({ elementId: "title-1" }),
          expect.objectContaining({
            elementId: "image-1",
            text: "AI network diagram",
          }),
        ],
      }),
      "总结这些元素"
    )
    expect(template).not.toHaveAttribute("data-pptx-selectable")
    fireEvent.click(template)
    expect(viewer.selectElements).toHaveBeenCalledTimes(2)
  })

  it("draws unclipped external frames for every selectable renderer type", async () => {
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="selection-renderers.pptx"
        selectionAction={createSelectionAction()}
        onClose={vi.fn()}
      />
    )

    setBoundingRect(screen.getByTestId("pptx-viewer-adapter"), {
      left: 100,
      top: 100,
      width: 900,
      height: 700,
    })

    const cases = [
      {
        id: "image-1",
        left: "550px",
        top: "40px",
        width: "180px",
        height: "260px",
      },
      {
        id: "shape-1",
        left: "220px",
        top: "200px",
        width: "120px",
        height: "120px",
      },
      {
        id: "connector-1",
        left: "360px",
        top: "360px",
        width: "260px",
        height: "20px",
      },
      {
        id: "table-1",
        left: "140px",
        top: "420px",
        width: "500px",
        height: "180px",
      },
    ] as const

    for (const item of cases) {
      const element = document.querySelector<HTMLElement>(
        `[data-element-id='${item.id}']`
      )!
      fireEvent.click(element)
      await waitFor(() => {
        expect(
          document.querySelector(`[data-pptx-selection-frame='${item.id}']`)
        ).toHaveStyle({
          left: item.left,
          top: item.top,
          width: item.width,
          height: item.height,
        })
      })
      expect(element).toHaveAttribute("data-pptx-selection-active", "true")
      for (const other of cases.filter(
        (candidate) => candidate.id !== item.id
      )) {
        expect(
          document.querySelector(`[data-element-id='${other.id}']`)
        ).not.toHaveAttribute("data-pptx-selection-active")
      }
      expect(
        document.querySelectorAll("[data-pptx-selection-frame]")
      ).toHaveLength(1)
    }

    fireEvent.click(document.querySelector("[data-pptx-viewport]")!)
    await waitFor(() => {
      expect(
        document.querySelectorAll("[data-pptx-selection-frame]")
      ).toHaveLength(0)
      expect(
        document.querySelectorAll('[data-pptx-selection-active="true"]')
      ).toHaveLength(0)
    })
    for (const item of cases) {
      expect(
        document.querySelector(`[data-element-id='${item.id}']`)
      ).not.toHaveAttribute("data-pptx-selection-active")
    }
  })

  it("draws numbered frames for saved annotation markers without enabling selection", async () => {
    const annotationMarkers: readonly PresentationAnnotationMarker[] = [
      {
        id: "draft-1",
        index: 1,
        selection: {
          slideIndex: 0,
          slideNumber: 1,
          elementIds: ["title-1"],
          elements: [
            {
              elementId: "title-1",
              shapeId: "42",
              type: "text",
              name: "Title",
              text: "认识人工智能",
              bounds: { x: 120, y: 80, width: 520, height: 90 },
            },
          ],
        },
      },
      {
        id: "draft-2",
        index: 2,
        selection: {
          slideIndex: 0,
          slideNumber: 1,
          elementIds: ["image-1"],
          elements: [
            {
              elementId: "image-1",
              type: "image",
              text: "AI network diagram",
              bounds: { x: 720, y: 60, width: 180, height: 260 },
            },
          ],
        },
      },
    ]

    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="saved-annotations.pptx"
        annotationMarkers={annotationMarkers}
        onClose={vi.fn()}
      />
    )

    setBoundingRect(screen.getByTestId("pptx-viewer-adapter"), {
      left: 100,
      top: 100,
      width: 900,
      height: 700,
    })
    setBoundingRect(document.querySelector("[data-pptx-viewport]")!, {
      left: 100,
      top: 100,
      width: 900,
      height: 700,
    })

    fireEvent.resize(window)

    await waitFor(() => {
      expect(
        document.querySelectorAll("[data-pptx-annotation-frame]")
      ).toHaveLength(2)
    })
    expect(
      document.querySelectorAll("[data-pptx-selection-frame]")
    ).toHaveLength(0)
    expect(
      document.querySelector("[data-pptx-annotation-frame='draft-1']")
    ).toHaveTextContent("1")
    expect(
      document.querySelector("[data-pptx-annotation-frame='draft-2']")
    ).toHaveTextContent("2")
  })

  it("navigates to the saved annotation slide when it is requested", async () => {
    const marker: PresentationAnnotationMarker = {
      id: "draft-slide-3",
      index: 1,
      selection: {
        slideIndex: 2,
        slideNumber: 3,
        elementIds: ["title-1"],
        elements: [
          {
            elementId: "title-1",
            type: "text",
            text: "第三页标题",
            bounds: { x: 120, y: 80, width: 520, height: 90 },
          },
        ],
      },
    }
    const { rerender } = render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="locate-annotation.pptx"
        annotationMarkers={[marker]}
        annotationNavigation={{ id: marker.id, sequence: 1 }}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(viewer.goTo).toHaveBeenCalledWith(2))

    rerender(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="locate-annotation.pptx"
        annotationMarkers={[marker]}
        annotationNavigation={{ id: marker.id, sequence: 2 }}
        onClose={vi.fn()}
      />
    )
    await waitFor(() => expect(viewer.goTo).toHaveBeenCalledTimes(2))
  })

  it("clips selection frames to the visible PPT viewport", async () => {
    render(
      <PresentationPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="selection-viewport.pptx"
        selectionAction={createSelectionAction()}
        onClose={vi.fn()}
      />
    )

    setBoundingRect(screen.getByTestId("pptx-viewer-adapter"), {
      left: 100,
      top: 100,
      width: 900,
      height: 700,
    })
    setBoundingRect(document.querySelector("[data-pptx-viewport]")!, {
      left: 200,
      top: 150,
      width: 600,
      height: 400,
    })

    fireEvent.click(
      document.querySelector<HTMLElement>("[data-element-id='image-1']")!
    )

    await waitFor(() => {
      expect(
        document.querySelector("[data-pptx-selection-frame='image-1']")
      ).toHaveStyle({
        left: "550px",
        top: "50px",
        width: "150px",
        height: "250px",
      })
    })
  })
})
