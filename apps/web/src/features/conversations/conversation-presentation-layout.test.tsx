import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
