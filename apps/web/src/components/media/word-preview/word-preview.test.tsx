import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WordPreview } from "@/components/media/word-preview/word-preview"
import type { WordSelectionAction } from "@/components/media/word-preview/word-preview.types"
import { calculateWordPreviewFitZoom } from "@/components/media/word-preview/word-preview-zoom"
import { mockOfficeSelectionLayout } from "@/test/office-selection-layout"
import i18n from "@/i18n"

type MockSelection = {
  from: number
  to: number
  empty: boolean
}

type MockTransaction = {
  selection: MockSelection
}

type MockEditorState = {
  selection: MockSelection
  doc: {
    resolve: (position: number) => {
      pos: number
      depth: number
      parent: { isTextblock: boolean }
      start: (depth: number) => number
      end: (depth: number) => number
    }
  }
  tr: {
    setSelection: (selection: MockSelection) => MockTransaction
  }
}

type MockEditorView = {
  state: MockEditorState
  dispatch: (transaction: MockTransaction) => void
}

const wordSelectionBridge = vi.hoisted(() => ({
  clickToPositionDom: vi.fn((_container: HTMLElement, clientX: number) =>
    clientX < 160 ? 42 : 50
  ),
  getSelectionRectsFromDom: vi.fn(() => [
    {
      x: 24,
      y: 32,
      width: 180,
      height: 22,
      pageIndex: 0,
    },
  ]),
  extractSelectionState: vi.fn((state: MockEditorState) => ({
    hasSelection: !state.selection.empty,
    isMultiParagraph: false,
    startParagraphIndex: 3,
    endParagraphIndex: 3,
  })),
  textSelectionBetween: vi.fn(
    (anchor: { pos: number }, head: { pos: number }): MockSelection => ({
      from: Math.min(anchor.pos, head.pos),
      to: Math.max(anchor.pos, head.pos),
      empty: anchor.pos === head.pos,
    })
  ),
}))

const scrollAnimation = vi.hoisted(() => ({
  reducedMotion: false,
  animate: vi.fn(
    (
      from: number,
      to: number,
      options?: Readonly<{ onUpdate?: (value: number) => void }>
    ) => {
      options?.onUpdate?.(from + (to - from) / 2)
      options?.onUpdate?.(to)
      return { stop: vi.fn() }
    }
  ),
}))

const editor = vi.hoisted(() => ({
  setZoom: vi.fn(),
  scrollToPage: vi.fn(),
  scrollToParaId: vi.fn(() => false),
  scrollToPosition: vi.fn(),
  viewportWidth: 0,
  viewportScrollWidth: 0,
  viewportLeft: 0,
  pageWidth: 0,
  pageRenderedWidth: 0,
  pageLeft: 0,
  getCurrentPage: vi.fn(() => 2),
  getTotalPages: vi.fn(() => 6),
  getSelectionInfo: vi.fn(() => ({
    paraId: "5E7A11C2",
    selectedText: "生成式人工智能",
    paragraphText: "生成式人工智能正在改变课堂。",
    before: "了解",
    after: "的基本概念",
  })),
  lastView: null as MockEditorView | null,
  lastProps: null as null | {
    readOnly?: boolean
    mode?: string
    loadingIndicator?: ReactNode
    showToolbar?: boolean
    showFileOpen?: boolean
    documentNameEditable?: boolean
  },
}))

vi.mock("@eigenpal/docx-editor-core/layout-bridge/clickToPositionDom", () => ({
  clickToPositionDom: wordSelectionBridge.clickToPositionDom,
  getSelectionRectsFromDom: wordSelectionBridge.getSelectionRectsFromDom,
}))

vi.mock("@eigenpal/docx-editor-core/prosemirror", () => ({
  extractSelectionState: wordSelectionBridge.extractSelectionState,
  TextSelection: { between: wordSelectionBridge.textSelectionBetween },
}))

vi.mock("framer-motion", () => ({
  animate: scrollAnimation.animate,
  useReducedMotion: () => scrollAnimation.reducedMotion,
}))

vi.mock("@eigenpal/docx-editor-react", async () => {
  const React = await import("react")
  const { schema } = await vi.importActual<
    typeof import("@eigenpal/docx-editor-core/prosemirror")
  >("@eigenpal/docx-editor-core/prosemirror")
  const editorDocument = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("x".repeat(35))),
    schema.node("table", null, [
      schema.node("tableRow", null, [
        schema.node("tableCell", null, [
          schema.node("paragraph", null, schema.text("生成式人工智能正在变")),
        ]),
      ]),
    ]),
  ])

  type MockProps = {
    readOnly?: boolean
    mode?: string
    loadingIndicator?: React.ReactNode
    showToolbar?: boolean
    showFileOpen?: boolean
    documentNameEditable?: boolean
    onSelectionChange?: (state: {
      hasSelection: boolean
      isMultiParagraph: boolean
      startParagraphIndex: number
      endParagraphIndex: number
    }) => void
    onFontsLoaded?: () => void
    onEditorViewReady?: (view: MockEditorView) => void
    onError?: (error: Error) => void
  }

  const DocxEditor = React.forwardRef(function MockDocxEditor(
    props: MockProps,
    ref: React.ForwardedRef<unknown>
  ) {
    const { onEditorViewReady, onFontsLoaded } = props
    editor.lastProps = props
    const editorViewRef = React.useRef<MockEditorView | null>(null)
    if (!editorViewRef.current) {
      const createState = (selection: MockSelection): MockEditorState => ({
        selection,
        doc: editorDocument,
        tr: {
          setSelection: (nextSelection) => ({ selection: nextSelection }),
        },
      })
      const view: MockEditorView = {
        state: createState({ from: 42, to: 42, empty: true }),
        dispatch: (transaction) => {
          view.state = createState(transaction.selection)
        },
      }
      editorViewRef.current = view
      editor.lastView = view
    }
    const editorView = editorViewRef.current
    React.useImperativeHandle(ref, () => ({
      setZoom: editor.setZoom,
      scrollToPage: editor.scrollToPage,
      scrollToParaId: editor.scrollToParaId,
      scrollToPosition: editor.scrollToPosition,
      getCurrentPage: editor.getCurrentPage,
      getTotalPages: editor.getTotalPages,
      getSelectionInfo: editor.getSelectionInfo,
    }))
    React.useEffect(() => onFontsLoaded?.(), [onFontsLoaded])
    React.useEffect(
      () => onEditorViewReady?.(editorView),
      [editorView, onEditorViewReady]
    )

    const selectText = () => {
      editorView.dispatch({
        selection: { from: 42, to: 50, empty: false },
      })
      props.onSelectionChange?.({
        hasSelection: true,
        isMultiParagraph: false,
        startParagraphIndex: 3,
        endParagraphIndex: 3,
      })
    }

    return React.createElement(
      "div",
      {
        "data-testid": "docx-editor",
      },
      React.createElement(
        "div",
        {
          className: "docx-editor__scroll-container",
          ref: (element: HTMLDivElement | null) => {
            if (!element) return
            Object.defineProperty(element, "clientWidth", {
              configurable: true,
              get: () => editor.viewportWidth,
            })
            Object.defineProperty(element, "scrollWidth", {
              configurable: true,
              get: () => editor.viewportScrollWidth,
            })
            element.getBoundingClientRect = () => ({
              x: editor.viewportLeft,
              y: 0,
              top: 0,
              right: editor.viewportLeft + editor.viewportWidth,
              bottom: 800,
              left: editor.viewportLeft,
              width: editor.viewportWidth,
              height: 800,
              toJSON: () => ({}),
            })
          },
        },
        React.createElement(
          "div",
          { className: "paged-editor__pages" },
          React.createElement(
            "div",
            {
              className: "layout-page",
              ref: (element: HTMLDivElement | null) => {
                if (!element) return
                Object.defineProperty(element, "offsetWidth", {
                  configurable: true,
                  get: () => editor.pageWidth,
                })
                element.getBoundingClientRect = () => {
                  const viewport = element.closest<HTMLElement>(
                    ".docx-editor__scroll-container"
                  )
                  const left = editor.pageLeft - (viewport?.scrollLeft ?? 0)
                  return {
                    x: left,
                    y: 24,
                    top: 24,
                    right: left + editor.pageRenderedWidth,
                    bottom: 1_024,
                    left,
                    width: editor.pageRenderedWidth,
                    height: 1_000,
                    toJSON: () => ({}),
                  }
                }
              },
            },
            React.createElement(
              "div",
              { className: "layout-page-header" },
              React.createElement(
                "span",
                { "data-testid": "docx-header-text" },
                "页眉文字"
              )
            ),
            React.createElement(
              "div",
              { className: "layout-page-content" },
              React.createElement(
                "div",
                { className: "layout-table-cell" },
                React.createElement(
                  "div",
                  {
                    className: "layout-paragraph",
                    "data-pm-start": "41",
                    "data-pm-end": "51",
                  },
                  React.createElement(
                    "span",
                    { "data-testid": "docx-editor-text" },
                    "生成式人工智能正在改变课堂。"
                  )
                )
              )
            )
          )
        )
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: selectText,
        },
        "Select Word text"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => props.onError?.(new Error("broken docx")),
        },
        "Fail Word viewer"
      )
    )
  })

  return { DocxEditor }
})

function createSelectionAction(
  onSubmit: WordSelectionAction["onSubmit"]
): WordSelectionAction {
  return {
    label: "问 LinkSense",
    shortcutLabel: "⌘I",
    promptLabel: "描述对所选文字的要求",
    placeholder: "描述要修改的内容",
    submitLabel: "发送要求",
    errorMessage: "发送失败，请重试",
    onSubmit,
  }
}

describe("word preview", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    scrollAnimation.reducedMotion = false
    editor.viewportWidth = 680
    editor.viewportScrollWidth = 680
    editor.viewportLeft = 0
    editor.pageWidth = 800
    editor.pageRenderedWidth = 640
    editor.pageLeft = 20
    wordSelectionBridge.getSelectionRectsFromDom.mockReturnValue([
      {
        x: 24,
        y: 32,
        width: 180,
        height: 22,
        pageIndex: 0,
      },
    ])
    window.getSelection()?.removeAllRanges()
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function selectNativeText(testId = "docx-editor-text") {
    const textNode = screen.getByTestId(testId).firstChild
    if (!textNode) throw new Error("Missing mock Word text node")
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 4)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  function createTransitionEvent(type: string, propertyName: string) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, "propertyName", { value: propertyName })
    return event
  }

  it("calculates a fit-width zoom without enlarging documents beyond 100%", () => {
    expect(calculateWordPreviewFitZoom(680, 800)).toBe(0.8)
    expect(calculateWordPreviewFitZoom(1_000, 800)).toBe(1)
    expect(calculateWordPreviewFitZoom(0, 800)).toBeNull()
  })

  it("fits the whole page on open and resets manual zoom back to the current width", async () => {
    editor.viewportWidth = 680
    editor.pageWidth = 800

    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="fit-width.docx"
        onClose={vi.fn()}
      />
    )

    const surface = document.querySelector<HTMLElement>(
      ".word-preview-editor-surface"
    )
    expect(surface).toHaveAttribute("data-fit-width", "true")
    expect(surface).toHaveAttribute("data-layout-ready", "false")
    expect(surface).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByText("正在加载文档")).toHaveClass("shimmer")
    await waitFor(() => expect(editor.setZoom).toHaveBeenCalledWith(0.8))
    await waitFor(() =>
      expect(surface).toHaveAttribute("data-layout-ready", "true")
    )
    expect(surface).not.toHaveAttribute("aria-hidden")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: "重置 Word 文档缩放" })[0]
    ).toHaveTextContent("80%")

    await userEvent.click(
      screen.getByRole("button", { name: "放大 Word 文档" })
    )
    expect(editor.setZoom).toHaveBeenLastCalledWith(0.9)
    expect(surface).toHaveAttribute("data-fit-width", "false")

    editor.viewportWidth = 520
    const resetButtons = screen.getAllByRole("button", {
      name: "重置 Word 文档缩放",
    })
    await userEvent.click(resetButtons[0]!)

    expect(editor.setZoom).toHaveBeenLastCalledWith(0.6)
    expect(surface).toHaveAttribute("data-fit-width", "true")
  })

  it("horizontally centers the page after applying the default fit zoom", async () => {
    editor.viewportWidth = 680
    editor.viewportScrollWidth = 840
    editor.pageWidth = 800
    editor.pageRenderedWidth = 640
    editor.pageLeft = 100

    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="centered.docx"
        onClose={vi.fn()}
      />
    )

    const viewport = document.querySelector<HTMLElement>(
      ".docx-editor__scroll-container"
    )
    expect(viewport).not.toBeNull()
    await waitFor(() => expect(editor.setZoom).toHaveBeenCalledWith(0.8))
    await waitFor(() => expect(viewport?.scrollLeft).toBe(80))
  })

  it("shows the selection action after dragging text in a table cell without native selection or a selection callback", async () => {
    mockOfficeSelectionLayout()
    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="lesson.docx"
        selectionAction={createSelectionAction(vi.fn())}
        onClose={vi.fn()}
      />
    )

    const wordText = screen.getByTestId("docx-editor-text")
    const surface = wordText.closest(".word-preview-editor-surface")
    if (!surface) throw new Error("Missing Word surface")
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(
      new DOMRect(300, 100, 800, 1200)
    )
    fireEvent.pointerDown(wordText, {
      button: 0,
      clientX: 80,
      clientY: 90,
    })
    fireEvent.pointerMove(wordText, {
      buttons: 1,
      clientX: 240,
      clientY: 150,
    })

    expect(
      screen.queryByRole("button", { name: /问 LinkSense/u })
    ).not.toBeInTheDocument()

    fireEvent.pointerUp(wordText, {
      button: 0,
      clientX: 240,
      clientY: 150,
    })

    const action = await screen.findByRole("button", {
      name: /问 LinkSense/u,
    })
    await waitFor(() =>
      expect(action.style.transform).toBe("translate(360px, 162px)")
    )
    expect(wordSelectionBridge.textSelectionBetween).toHaveBeenCalledWith(
      expect.objectContaining({ pos: 42 }),
      expect.objectContaining({ pos: 50 })
    )
  })

  it("keeps the selection frame visible while native text remains selected and after EigenPal repaints", async () => {
    mockOfficeSelectionLayout()
    wordSelectionBridge.getSelectionRectsFromDom.mockReturnValue([
      { x: 24, y: 32, width: 80, height: 22, pageIndex: 0 },
      { x: 104, y: 32, width: 100, height: 22, pageIndex: 0 },
      { x: 24, y: 60, width: 120, height: 22, pageIndex: 0 },
      { x: 30, y: 900, width: 150, height: 22, pageIndex: 1 },
    ])
    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="lesson.docx"
        selectionAction={createSelectionAction(vi.fn())}
        onClose={vi.fn()}
      />
    )

    const wordText = screen.getByTestId("docx-editor-text")
    fireEvent.pointerDown(wordText, {
      button: 0,
      clientX: 80,
      clientY: 90,
    })
    fireEvent.pointerMove(wordText, {
      buttons: 1,
      clientX: 240,
      clientY: 150,
    })
    selectNativeText()
    fireEvent.pointerUp(wordText, {
      button: 0,
      clientX: 240,
      clientY: 150,
    })

    expect(
      await screen.findByRole("button", { name: /问 LinkSense/u })
    ).toBeVisible()

    const overlay = await screen.findByTestId("word-selection-overlay")
    const firstPageFrame = overlay.querySelector('[data-page-index="0"]')
    const secondPageFrame = overlay.querySelector('[data-page-index="1"]')
    expect(overlay.querySelectorAll("rect")).toHaveLength(2)
    expect(firstPageFrame).toHaveAttribute("x", "24")
    expect(firstPageFrame).toHaveAttribute("y", "32")
    expect(firstPageFrame).toHaveAttribute("width", "180")
    expect(firstPageFrame).toHaveAttribute("height", "50")
    expect(secondPageFrame).toHaveAttribute("x", "30")
    expect(secondPageFrame).toHaveAttribute("y", "900")
    expect(secondPageFrame).toHaveAttribute("width", "150")
    expect(secondPageFrame).toHaveAttribute("height", "22")
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /问 LinkSense/u }).style.transform
      ).toBe("translate(60px, 930px)")
    )

    window.getSelection()?.removeAllRanges()
    const pages = document.querySelector<HTMLElement>(".paged-editor__pages")
    if (!pages) throw new Error("Missing mock Word pages")
    fireEvent(pages, new Event("painter:painted"))

    expect(await screen.findByTestId("word-selection-overlay")).toBeVisible()
    expect(wordSelectionBridge.getSelectionRectsFromDom).toHaveBeenCalledWith(
      pages,
      42,
      50,
      expect.anything()
    )
    expect(screen.getByRole("button", { name: /问 LinkSense/u })).toBeVisible()
    wordSelectionBridge.getSelectionRectsFromDom.mockReturnValue([
      { x: 24, y: 200, width: 180, height: 80, pageIndex: 1 },
    ])
    fireEvent.scroll(pages)
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /问 LinkSense/u }).style.transform
      ).toBe("translate(60px, 288px)")
    )

    const editorScaleWrapper = pages.parentElement
    if (!editorScaleWrapper) throw new Error("Missing mock Word scale wrapper")
    fireEvent(
      editorScaleWrapper,
      createTransitionEvent("transitionrun", "transform")
    )
    expect(
      screen.queryByTestId("word-selection-overlay")
    ).not.toBeInTheDocument()
    fireEvent(
      editorScaleWrapper,
      createTransitionEvent("transitionend", "transform")
    )
    expect(await screen.findByTestId("word-selection-overlay")).toBeVisible()
  })

  it("previews the hovered Word paragraph before click and removes hover when selected", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="hover.docx"
        selectionAction={createSelectionAction(onSubmit)}
      />
    )
    const overlay = await screen.findByTestId("office-annotation-hover-overlay")
    const viewport = document.querySelector<HTMLElement>(
      ".docx-editor__scroll-container"
    )
    if (!viewport) throw new Error("Missing Word viewport")
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 100, 600, 700)
    )
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 100, 600, 700)
    )
    const target = screen.getByTestId("docx-editor-text")
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target)
    wordSelectionBridge.getSelectionRectsFromDom.mockReturnValue([
      { x: 140, y: 180, width: 200, height: 50, pageIndex: 0 },
    ])
    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      buttons: 0,
      clientX: 150,
      clientY: 190,
    })
    await waitFor(() =>
      expect(overlay.querySelector("path")).toHaveAttribute(
        "d",
        "M40,80H240V130H40Z"
      )
    )
    expect(screen.queryByRole("button", { name: /问 LinkSense/u })).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
    wordSelectionBridge.getSelectionRectsFromDom.mockReturnValue([
      { x: 120, y: 160, width: 300, height: 75, pageIndex: 0 },
    ])
    fireEvent.scroll(viewport)
    await waitFor(() =>
      expect(overlay.querySelector("path")).toHaveAttribute(
        "d",
        "M20,60H320V135H20Z"
      )
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Select Word text" })
    )
    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      buttons: 0,
      clientX: 150,
      clientY: 190,
    })
    await waitFor(() =>
      expect(overlay.querySelector("path")?.getAttribute("d") || "").toBe("")
    )
  })

  it("draws numbered markers for saved annotation selections", async () => {
    wordSelectionBridge.getSelectionRectsFromDom.mockReturnValue([
      { x: 24, y: 32, width: 180, height: 22, pageIndex: 0 },
      { x: 24, y: 54, width: 120, height: 22, pageIndex: 0 },
      { x: 40, y: 900, width: 220, height: 22, pageIndex: 1 },
    ])
    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="lesson.docx"
        annotationMarkers={[
          {
            id: "draft-1",
            index: 1,
            selection: {
              type: "text",
              selectedText: "生成式人工智能",
              paragraphText: "生成式人工智能正在改变课堂。",
              before: "了解",
              after: "的基本概念",
              startParagraphIndex: 3,
              endParagraphIndex: 3,
              isMultiParagraph: false,
              positionFrom: 42,
              positionTo: 50,
            },
          },
        ]}
        onClose={vi.fn()}
      />
    )

    const overlay = await screen.findByTestId("word-annotation-overlay")
    const frame = overlay.querySelector(
      '[data-word-annotation-frame="draft-1"]'
    )
    const marker = overlay.querySelector<HTMLElement>(
      '[data-word-annotation-marker="draft-1"]'
    )
    expect(frame).toHaveStyle({
      left: "24px",
      top: "32px",
      width: "180px",
      height: "44px",
    })
    expect(
      overlay.querySelectorAll('[data-word-annotation-frame="draft-1"]')
    ).toHaveLength(2)
    expect(
      overlay.querySelectorAll('[data-word-annotation-marker="draft-1"]')
    ).toHaveLength(2)
    expect(marker).toHaveTextContent("1")
    expect(
      marker?.querySelector(".office-annotation-number-bubble-shape")
    ).not.toBeNull()
    expect(screen.queryByRole("button", { name: /问 LinkSense/u })).toBeNull()

    const pages = document.querySelector<HTMLElement>(".paged-editor__pages")
    if (!pages) throw new Error("Missing mock Word pages")
    const overlayBounds = new DOMRect(360, 80, 700, 900)
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(overlayBounds)
    wordSelectionBridge.getSelectionRectsFromDom.mockReturnValue([
      { x: 14, y: 12, width: 180, height: 44, pageIndex: 0 },
    ])
    fireEvent.scroll(pages)
    await waitFor(() =>
      expect(frame).toHaveStyle({ left: "14px", top: "12px" })
    )
    expect(
      wordSelectionBridge.getSelectionRectsFromDom
    ).toHaveBeenLastCalledWith(pages, 42, 50, overlayBounds)
    expect(frame).toContainElement(marker)

    const scaleWrapper = pages.parentElement
    if (!scaleWrapper) throw new Error("Missing mock Word scale wrapper")
    fireEvent(scaleWrapper, createTransitionEvent("transitionrun", "transform"))
    expect(screen.queryByTestId("word-annotation-overlay")).toBeNull()
    wordSelectionBridge.getSelectionRectsFromDom.mockReturnValue([
      { x: 21, y: 18, width: 270, height: 66, pageIndex: 0 },
    ])
    fireEvent(scaleWrapper, createTransitionEvent("transitionend", "transform"))
    const zoomedOverlay = await screen.findByTestId("word-annotation-overlay")
    const zoomedFrame = zoomedOverlay.querySelector(
      '[data-word-annotation-frame="draft-1"]'
    )
    expect(zoomedFrame).toHaveStyle({
      left: "21px",
      top: "18px",
      width: "270px",
      height: "66px",
    })
    expect(zoomedFrame).toHaveTextContent("1")

    wordSelectionBridge.getSelectionRectsFromDom.mockReturnValue([
      { x: 21, y: 35, width: 270, height: 88, pageIndex: 0 },
    ])
    pages.style.paddingTop = "17px"
    await waitFor(() =>
      expect(zoomedFrame).toHaveStyle({ top: "35px", height: "88px" })
    )
  })

  it("scrolls the saved Word annotation into view when it is requested", async () => {
    const documentState = {
      status: "ready" as const,
      content: new Uint8Array([1, 2, 3]),
    }
    const marker = {
      id: "draft-locate",
      index: 1,
      selection: {
        type: "text" as const,
        selectedText: "生成式人工智能",
        paragraphText: "生成式人工智能正在改变课堂。",
        before: "了解",
        after: "的基本概念",
        startParagraphIndex: 3,
        endParagraphIndex: 3,
        isMultiParagraph: false,
        positionFrom: 42,
        positionTo: 50,
      },
    }
    const { rerender } = render(
      <WordPreview
        document={documentState}
        fileName="locate.docx"
        annotationMarkers={[marker]}
        onClose={vi.fn()}
      />
    )

    await screen.findByTestId("word-annotation-overlay")
    const viewport = document.querySelector<HTMLElement>(
      ".docx-editor__scroll-container"
    )
    if (!viewport) throw new Error("Missing mock Word viewport")
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      get: () => 40,
    })
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      get: () => 2_000,
    })
    viewport.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      right: 680,
      bottom: 40,
      left: 0,
      width: 680,
      height: 40,
      toJSON: () => ({}),
    })
    rerender(
      <WordPreview
        document={documentState}
        fileName="locate.docx"
        annotationMarkers={[marker]}
        annotationNavigation={{ id: marker.id, sequence: 1 }}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(viewport.scrollTop).toBe(23))
    expect(scrollAnimation.animate).toHaveBeenCalledWith(
      0,
      23,
      expect.objectContaining({
        duration: 0.26,
        ease: "easeOut",
        onUpdate: expect.any(Function),
      })
    )
    expect(editor.scrollToPosition).not.toHaveBeenCalled()
    expect(editor.scrollToPage).not.toHaveBeenCalled()
  })

  it("finishes a mouse selection when the pointer is released outside the editor", async () => {
    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="lesson.docx"
        selectionAction={createSelectionAction(vi.fn())}
        onClose={vi.fn()}
      />
    )

    const wordText = screen.getByTestId("docx-editor-text")
    fireEvent.pointerDown(wordText, {
      button: 0,
      clientX: 80,
      clientY: 90,
    })
    fireEvent.pointerMove(wordText, {
      buttons: 1,
      clientX: 240,
      clientY: 150,
    })
    selectNativeText()
    fireEvent.pointerUp(window, {
      button: 0,
      clientX: 900,
      clientY: 700,
    })

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /问 LinkSense/u })
      ).not.toHaveClass("invisible")
    )
  })

  it("does not map header text into the body document selection", async () => {
    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="lesson.docx"
        selectionAction={createSelectionAction(vi.fn())}
        onClose={vi.fn()}
      />
    )

    const headerText = screen.getByTestId("docx-header-text")
    fireEvent.pointerDown(headerText, {
      button: 0,
      clientX: 80,
      clientY: 40,
    })
    fireEvent.pointerMove(headerText, {
      buttons: 1,
      clientX: 240,
      clientY: 40,
    })
    selectNativeText("docx-header-text")
    fireEvent.pointerUp(headerText, {
      button: 0,
      clientX: 240,
      clientY: 40,
    })

    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    expect(wordSelectionBridge.clickToPositionDom).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("button", { name: /问 LinkSense/u })
    ).not.toBeInTheDocument()
  })

  it("selects the clicked paragraph when annotation mode is active", async () => {
    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="lesson.docx"
        selectionAction={createSelectionAction(vi.fn())}
        onClose={vi.fn()}
      />
    )

    const wordText = screen.getByTestId("docx-editor-text")
    fireEvent.pointerDown(wordText, {
      button: 0,
      clientX: 80,
      clientY: 90,
    })
    fireEvent.pointerUp(wordText, {
      button: 0,
      clientX: 80,
      clientY: 90,
    })

    expect(
      await screen.findByRole("button", { name: /问 LinkSense/u })
    ).toBeVisible()
    expect(wordSelectionBridge.textSelectionBetween).toHaveBeenCalledWith(
      expect.objectContaining({ pos: 41 }),
      expect.objectContaining({ pos: 51 })
    )
  })

  it("hides EigenPal loading UI, stays read-only, and submits stable selection context", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="lesson.docx"
        selectionAction={createSelectionAction(onSubmit)}
        onClose={vi.fn()}
      />
    )

    expect(editor.lastProps).toMatchObject({
      readOnly: true,
      mode: "viewing",
      loadingIndicator: expect.anything(),
      showToolbar: false,
      showFileOpen: false,
      documentNameEditable: false,
    })
    const { container: loadingIndicatorContainer } = render(
      <>{editor.lastProps?.loadingIndicator}</>
    )
    const loadingStatus =
      loadingIndicatorContainer.querySelector('[role="status"]')
    expect(loadingStatus).toHaveAttribute("aria-busy", "true")
    expect(loadingStatus).toHaveTextContent("正在加载文档")
    expect(
      loadingIndicatorContainer.querySelector(".shimmer")
    ).toHaveTextContent("正在加载文档")
    expect(loadingIndicatorContainer.querySelector("svg")).toBeNull()
    expect(loadingIndicatorContainer.querySelector(".animate-spin")).toBeNull()

    await waitFor(() =>
      expect(
        document.querySelector(".word-preview-editor-surface")
      ).toHaveAttribute("data-layout-ready", "true")
    )
    fireEvent.click(screen.getByRole("button", { name: "Select Word text" }))
    await userEvent.click(
      await screen.findByRole("button", { name: /问 LinkSense/u })
    )
    const prompt = screen.getByRole("textbox", {
      name: "描述对所选文字的要求",
    })
    await userEvent.type(prompt, "改成英文{Enter}")

    expect(onSubmit).toHaveBeenCalledWith(
      {
        type: "text",
        paraId: "5E7A11C2",
        selectedText: "生成式人工智能",
        paragraphText: "生成式人工智能正在改变课堂。",
        before: "了解",
        after: "的基本概念",
        startParagraphIndex: 3,
        endParagraphIndex: 3,
        isMultiParagraph: false,
        pageNumber: 2,
        positionFrom: 42,
        positionTo: 50,
      },
      "改成英文"
    )
    await waitFor(() => expect(prompt).not.toBeInTheDocument())
  })

  it("uses the shared controls and surfaces parser failures through the shell", async () => {
    render(
      <WordPreview
        document={{ status: "ready", content: new Uint8Array([9]) }}
        fileName="broken.docx"
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(
        document.querySelector(".word-preview-editor-surface")
      ).toHaveAttribute("data-layout-ready", "true")
    )
    await userEvent.click(
      screen.getByRole("button", { name: "放大 Word 文档" })
    )
    expect(editor.setZoom).toHaveBeenLastCalledWith(0.9)
    expect(await screen.findByText("第 2 / 6 页")).toBeVisible()

    await userEvent.click(
      screen.getByRole("button", { name: "Fail Word viewer" })
    )
    expect(screen.getByRole("alert")).toBeVisible()
    expect(screen.getByRole("button", { name: "重试" })).toBeVisible()
  })
})
