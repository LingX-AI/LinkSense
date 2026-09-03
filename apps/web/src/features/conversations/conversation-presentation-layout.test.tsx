import { useState } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import {
  OFFICE_PREVIEW_ENTER_ANIMATION_NAME,
  OFFICE_PREVIEW_ENTER_CLASS,
  OFFICE_PREVIEW_EXIT_ANIMATION_NAME,
  OfficePreviewSuspenseBoundary,
} from "@/components/media/office-preview/office-preview-suspense-boundary"
import { ConversationPresentationLayout } from "@/features/conversations/conversation-presentation-layout"
import {
  DEFAULT_SUBAGENT_DETAIL_VIEWPORT_RATIO,
  getConversationWorkspaceWidthBounds,
  resolveConversationWorkspaceWidth,
  shouldOverlayPresentationPreview,
} from "@/features/conversations/conversation-presentation-width"

let measuredLayoutWidth = 1_200

function rectWithWidth(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: 800,
    left: 0,
    width,
    height: 800,
    toJSON: () => ({}),
  }
}

function ReopenPreviewHarness() {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewClosing, setPreviewClosing] = useState(false)
  const closePreview = () => setPreviewClosing(true)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPreviewClosing(false)
          setPreviewOpen(true)
        }}
      >
        打开文件预览
      </button>
      <ConversationPresentationLayout
        resizeLabel="调整文件预览宽度"
        previewClosing={previewClosing}
        onPreviewExitComplete={() => {
          setPreviewClosing(false)
          setPreviewOpen(false)
        }}
        preview={
          previewOpen ? (
            <OfficePreviewSuspenseBoundary
              fallback={(className) => (
                <OfficePreviewShell
                  className={className}
                  document={{ status: "loading" }}
                  fileName="cached-preview.md"
                  mimeType="text/markdown"
                  onClose={closePreview}
                />
              )}
            >
              {(className) => (
                <OfficePreviewShell
                  className={className}
                  document={{ status: "ready" }}
                  fileName="cached-preview.md"
                  mimeType="text/markdown"
                  onClose={closePreview}
                >
                  <div>缓存后的文件内容</div>
                </OfficePreviewShell>
              )}
            </OfficePreviewSuspenseBoundary>
          ) : undefined
        }
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    </>
  )
}

function ReplacePreviewPaneDuringEntranceHarness() {
  const [documentReady, setDocumentReady] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setDocumentReady(true)}>
        完成第二份 Word 加载
      </button>
      <ConversationPresentationLayout
        resizeLabel="调整文件预览宽度"
        preview={
          <OfficePreviewSuspenseBoundary
            fallback={(className) => (
              <OfficePreviewShell
                className={className}
                document={{ status: "loading" }}
                fileName="second.docx"
                mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              />
            )}
          >
            {(className) => (
              <OfficePreviewShell
                key={documentReady ? "ready" : "loading"}
                className={className}
                document={{ status: documentReady ? "ready" : "loading" }}
                fileName="second.docx"
                mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              >
                {documentReady ? <div>第二份 Word 内容</div> : null}
              </OfficePreviewShell>
            )}
          </OfficePreviewSuspenseBoundary>
        }
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    </>
  )
}

function dispatchPreviewAnimation(preview: Element, animationName: string) {
  const animationEvent = new Event("animationend", { bubbles: true })
  Object.defineProperty(animationEvent, "animationName", {
    value: animationName,
  })
  fireEvent(preview, animationEvent)
}

describe("ConversationPresentationLayout", () => {
  beforeEach(() => {
    measuredLayoutWidth = 1_200
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1_600,
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        return rectWithWidth(
          this.classList.contains("conversation-presentation-layout")
            ? measuredLayoutWidth
            : 0
        )
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("starts every file preview at two fifths of the viewport width", async () => {
    render(
      <ConversationPresentationLayout
        resizeLabel="调整演示文稿预览宽度"
        preview={<aside>演示文稿预览</aside>}
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    )

    const layout = screen.getByText("任务内容").parentElement?.parentElement
    await waitFor(() =>
      expect(layout).toHaveStyle("--conversation-workspace-width: 560px")
    )
    const separator = screen.getByRole("separator", {
      name: "调整演示文稿预览宽度",
    })
    expect(separator).toHaveAttribute("aria-valuenow", "560")
    expect(separator).toHaveAttribute("aria-valuemin", "320")
    expect(separator).toHaveAttribute("aria-valuemax", "720")
    expect(separator).toHaveClass(
      "sidebar-resize-handle",
      "presentation-preview-resize-handle"
    )
  })

  it("reports when a closing file preview finishes its exit animation", async () => {
    const onPreviewExitComplete = vi.fn()
    render(
      <ConversationPresentationLayout
        resizeLabel="调整文件预览宽度"
        preview={<aside className="office-preview-pane">文件预览内容</aside>}
        previewClosing
        onPreviewExitComplete={onPreviewExitComplete}
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    )

    await screen.findByRole("separator", { name: "调整文件预览宽度" })

    const closingPreview = screen.getByText("文件预览内容")
    const layout = closingPreview.parentElement
    expect(layout).toHaveAttribute("data-preview-closing", "true")

    const animationEnd = new Event("animationend", { bubbles: true })
    Object.defineProperty(animationEnd, "animationName", {
      value: OFFICE_PREVIEW_EXIT_ANIMATION_NAME,
    })
    fireEvent(closingPreview, animationEnd)

    expect(onPreviewExitComplete).toHaveBeenCalledOnce()
  })

  it("closes a cached file preview after opening it for the second time", () => {
    render(<ReopenPreviewHarness />)

    const openPreview = screen.getByRole("button", { name: "打开文件预览" })
    const completePreviewCycle = () => {
      fireEvent.click(openPreview)
      const preview = screen
        .getByText("缓存后的文件内容")
        .closest(".office-preview-pane")
      if (!preview) throw new Error("Expected the cached preview pane to open")
      expect(preview).toHaveClass(OFFICE_PREVIEW_ENTER_CLASS)

      dispatchPreviewAnimation(preview, OFFICE_PREVIEW_ENTER_ANIMATION_NAME)
      expect(preview).not.toHaveClass(OFFICE_PREVIEW_ENTER_CLASS)

      const closePreview = preview.querySelector(".office-preview-close-button")
      if (!closePreview) throw new Error("Expected the preview close button")
      fireEvent.click(closePreview)
      expect(preview.parentElement).toHaveAttribute(
        "data-preview-closing",
        "true"
      )

      dispatchPreviewAnimation(preview, OFFICE_PREVIEW_EXIT_ANIMATION_NAME)
      expect(screen.queryByText("缓存后的文件内容")).toBeNull()
    }

    completePreviewCycle()
    completePreviewCycle()
  })

  it("keeps one entrance animation when a reopened Word pane is replaced after loading", () => {
    render(<ReplacePreviewPaneDuringEntranceHarness />)

    const loadingPreview = document.querySelector(".office-preview-pane")
    if (!loadingPreview) throw new Error("Expected the loading Word pane")
    const animationTarget = loadingPreview.parentElement
    if (!animationTarget) throw new Error("Expected the stable preview layout")
    expect(loadingPreview).toHaveClass(OFFICE_PREVIEW_ENTER_CLASS)

    fireEvent.click(
      screen.getByRole("button", { name: "完成第二份 Word 加载" })
    )

    const readyPreview = screen
      .getByText("第二份 Word 内容")
      .closest(".office-preview-pane")
    if (!readyPreview) throw new Error("Expected the loaded Word pane")
    expect(readyPreview).not.toBe(loadingPreview)
    expect(readyPreview.parentElement).toBe(animationTarget)
    expect(readyPreview).toHaveClass(OFFICE_PREVIEW_ENTER_CLASS)

    dispatchPreviewAnimation(
      animationTarget,
      OFFICE_PREVIEW_ENTER_ANIMATION_NAME
    )
    expect(readyPreview).not.toHaveClass(OFFICE_PREVIEW_ENTER_CLASS)
  })

  it("does not finish a closing preview when reopening cancels its exit animation", async () => {
    const onPreviewExitComplete = vi.fn()
    render(
      <ConversationPresentationLayout
        resizeLabel="调整文件预览宽度"
        preview={<aside className="office-preview-pane">文件预览内容</aside>}
        previewClosing
        onPreviewExitComplete={onPreviewExitComplete}
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    )

    await screen.findByRole("separator", { name: "调整文件预览宽度" })
    const closingPreview = screen.getByText("文件预览内容")
    const animationCancel = new Event("animationcancel", { bubbles: true })
    Object.defineProperty(animationCancel, "animationName", {
      value: OFFICE_PREVIEW_EXIT_ANIMATION_NAME,
    })
    fireEvent(closingPreview, animationCancel)

    expect(onPreviewExitComplete).not.toHaveBeenCalled()
  })

  it("ignores unrelated preview animations while waiting for the exit animation", async () => {
    const onPreviewExitComplete = vi.fn()
    render(
      <ConversationPresentationLayout
        resizeLabel="调整文件预览宽度"
        preview={<aside className="office-preview-pane">文件预览内容</aside>}
        previewClosing
        onPreviewExitComplete={onPreviewExitComplete}
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    )

    await screen.findByRole("separator", { name: "调整文件预览宽度" })
    const closingPreview = screen.getByText("文件预览内容")
    const entranceAnimationEnd = new Event("animationend", { bubbles: true })
    Object.defineProperty(entranceAnimationEnd, "animationName", {
      value: OFFICE_PREVIEW_ENTER_ANIMATION_NAME,
    })
    fireEvent(closingPreview, entranceAnimationEnd)

    expect(onPreviewExitComplete).not.toHaveBeenCalled()
  })

  it("starts subagent details at two fifths of the viewport width", async () => {
    render(
      <ConversationPresentationLayout
        resizeLabel="调整子智能体详情宽度"
        defaultPreviewViewportRatio={DEFAULT_SUBAGENT_DETAIL_VIEWPORT_RATIO}
        preview={<aside>子智能体详情</aside>}
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    )

    const layout = screen.getByText("任务内容").parentElement?.parentElement
    await waitFor(() =>
      expect(layout).toHaveStyle("--conversation-workspace-width: 560px")
    )
    expect(
      screen.getByRole("separator", {
        name: "调整子智能体详情宽度",
      })
    ).toHaveAttribute("aria-valuenow", "560")
  })

  it("reuses pointer and keyboard resizing for the conversation boundary", async () => {
    render(
      <ConversationPresentationLayout
        resizeLabel="调整演示文稿预览宽度"
        preview={<aside>演示文稿预览</aside>}
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    )

    const separator = await screen.findByRole("separator", {
      name: "调整演示文稿预览宽度",
    })
    const layout = screen.getByText("任务内容").parentElement?.parentElement

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 560,
      pointerId: 11,
    })
    expect(layout).toHaveAttribute("data-preview-resizing", "true")
    fireEvent.pointerMove(separator, { clientX: 660, pointerId: 11 })
    await waitFor(() =>
      expect(layout).toHaveStyle("--conversation-workspace-width: 660px")
    )
    fireEvent.pointerUp(separator, { clientX: 660, pointerId: 11 })
    expect(layout).not.toHaveAttribute("data-preview-resizing")

    fireEvent.keyDown(separator, { key: "Home" })
    await waitFor(() =>
      expect(layout).toHaveStyle("--conversation-workspace-width: 320px")
    )
    fireEvent.keyDown(separator, { key: "End" })
    await waitFor(() =>
      expect(layout).toHaveStyle("--conversation-workspace-width: 720px")
    )
  })

  it("keeps both panes inside their supported minimum widths", () => {
    expect(getConversationWorkspaceWidthBounds(1_200)).toEqual({
      minimum: 320,
      maximum: 720,
    })
    expect(
      resolveConversationWorkspaceWidth({
        layoutWidth: 900,
        viewportWidth: 1_600,
        customRatio: null,
      })
    ).toBe(320)
    expect(
      resolveConversationWorkspaceWidth({
        layoutWidth: 1_200,
        viewportWidth: 1_600,
        customRatio: 0.95,
      })
    ).toBe(720)
    expect(
      resolveConversationWorkspaceWidth({
        layoutWidth: 1_200,
        viewportWidth: 1_600,
        customRatio: null,
        defaultPreviewViewportRatio: DEFAULT_SUBAGENT_DETAIL_VIEWPORT_RATIO,
      })
    ).toBe(560)
    expect(shouldOverlayPresentationPreview(800)).toBe(true)
    expect(shouldOverlayPresentationPreview(801)).toBe(false)
  })

  it("uses an overlay instead of squeezing both panes in a narrow container", async () => {
    measuredLayoutWidth = 760
    render(
      <ConversationPresentationLayout
        resizeLabel="调整演示文稿预览宽度"
        preview={<aside>演示文稿预览</aside>}
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    )

    const layout = screen.getByText("任务内容").parentElement?.parentElement
    await waitFor(() =>
      expect(layout).toHaveAttribute(
        "data-overlay-presentation-preview",
        "true"
      )
    )
    expect(
      screen.queryByRole("separator", {
        name: "调整演示文稿预览宽度",
      })
    ).not.toBeInTheDocument()
  })

  it("shares the task overview layout state with the thread and composer", () => {
    const { rerender } = render(
      <ConversationPresentationLayout
        resizeLabel="调整演示文稿预览宽度"
        taskOverviewOpen
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    )

    expect(
      screen.getByText("任务内容").closest(".conversation-workspace")
    ).toHaveAttribute("data-task-overview-open", "true")

    rerender(
      <ConversationPresentationLayout
        resizeLabel="调整演示文稿预览宽度"
        taskOverviewOpen={false}
      >
        <main>任务内容</main>
      </ConversationPresentationLayout>
    )

    expect(
      screen.getByText("任务内容").closest(".conversation-workspace")
    ).not.toHaveAttribute("data-task-overview-open")
  })
})
