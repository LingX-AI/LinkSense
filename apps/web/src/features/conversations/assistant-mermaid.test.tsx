import userEvent from "@testing-library/user-event"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AssistantMarkdown,
  ConversationThread,
} from "@/features/conversations/conversation-thread"
import { renderMermaidDiagram } from "@/features/conversations/mermaid-renderer"
import { exportMermaidPng } from "@/features/conversations/mermaid-export"
import { downloadBlob } from "@/lib/download-blob"
import i18n from "@/i18n"
import type { Conversation } from "@/api/contracts"
import { toast } from "sonner"
import { AssistantMermaid } from "@/features/conversations/assistant-mermaid"

vi.mock("@/features/conversations/mermaid-renderer", () => ({
  renderMermaidDiagram: vi.fn(),
}))
vi.mock("@/features/conversations/mermaid-export", () => ({
  exportMermaidPng: vi.fn(),
}))
vi.mock("@/lib/download-blob", () => ({ downloadBlob: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
const source = "graph LR\n    A[确认上游API合规性] --> B[启动ICP备案]"
const content = "```mermaid\n" + source + "\n```"
const diagram = {
  url: "data:image/svg+xml,test",
  width: 800,
  height: 200,
  background: "#ffffff",
}

let user: ReturnType<typeof userEvent.setup>

async function openActions() {
  await user.hover(
    screen.getByRole("region", { name: i18n.t("conversation.diagram.title") })
  )
  screen
    .getByRole("button", { name: i18n.t("conversation.diagram.actions") })
    .focus()
  await user.keyboard("{Enter}")
}

beforeEach(async () => {
  user = userEvent.setup()
  vi.clearAllMocks()
  vi.mocked(renderMermaidDiagram).mockReset()
  vi.mocked(exportMermaidPng).mockReset()
  await i18n.changeLanguage("zh-CN")
  vi.mocked(renderMermaidDiagram).mockResolvedValue(diagram)
  vi.mocked(exportMermaidPng).mockResolvedValue(
    new Blob(["png"], { type: "image/png" })
  )
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.classList.remove("dark")
  delete document.documentElement.dataset.theme
})

describe("assistant Mermaid diagrams", () => {
  it("renders a historical fenced diagram as an image and copies its source", async () => {
    render(<AssistantMarkdown content={content} />)
    expect(await screen.findByRole("img", { name: "流程图" })).toHaveAttribute(
      "src",
      diagram.url
    )
    expect(document.querySelector("pre")).toBeNull()
    await openActions()
    await user.click(screen.getByRole("menuitem", { name: "复制代码" }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(source)
    )
    expect(await screen.findByText("代码已复制")).toBeInTheDocument()
  })
  it("waits until streaming finishes before rendering", async () => {
    const view = render(<AssistantMarkdown content={content} streaming />)
    const loading = screen.getByRole("status", { name: "流程图生成中…" })
    expect(loading).toHaveClass(
      "assistant-html-preview-loading-surface",
      "aspect-square",
      "max-w-[20rem]"
    )
    expect(loading.textContent).toBe("")
    expect(screen.queryByText("流程图")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
    expect(renderMermaidDiagram).not.toHaveBeenCalled()
    view.rerender(<AssistantMarkdown content={content} streaming={false} />)
    expect(await screen.findByRole("img", { name: "流程图" })).toBeVisible()
  })
  it("exports the full diagram and opens a readable enlarged view", async () => {
    render(<AssistantMarkdown content={content} />)
    await screen.findByRole("img", { name: "流程图" })
    await openActions()
    await user.click(screen.getByRole("menuitem", { name: "导出图片" }))
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "流程图.png")
    )
    expect(exportMermaidPng).toHaveBeenCalledWith(diagram)
    await openActions()
    await user.click(screen.getByRole("menuitem", { name: "放大查看" }))
    expect(
      await screen.findByRole("dialog", {
        name: i18n.t("conversation.imagePreviewTitle", { name: "流程图" }),
      })
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "放大" })).toBeEnabled()
  })
  it("keeps source copy available on invalid diagrams without exposing parser errors", async () => {
    vi.mocked(renderMermaidDiagram).mockRejectedValue(
      new Error("private parser details")
    )
    render(<AssistantMarkdown content={content} />)
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "暂时无法显示流程图"
    )
    expect(screen.queryByText("private parser details")).toBeNull()
    expect(screen.getByRole("button", { name: "复制代码" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "流程图操作" })).toBeNull()
  })
  it("leaves other code blocks unchanged", () => {
    render(<AssistantMarkdown content={"```text\ngraph LR\n```"} />)
    expect(document.querySelector("pre")).toHaveTextContent("graph LR")
    expect(renderMermaidDiagram).not.toHaveBeenCalled()
  })
})

describe("diagram async state and feedback", () => {
  it("ignores a late result after the source changes", async () => {
    let resolveOld: ((value: typeof diagram) => void) | undefined
    vi.mocked(renderMermaidDiagram).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      })
    )
    const view = render(
      <AssistantMermaid
        source="graph LR; A-->B"
        streaming={false}
        copySource={vi.fn()}
      />
    )
    await waitFor(() => expect(renderMermaidDiagram).toHaveBeenCalledOnce())
    view.rerender(
      <AssistantMermaid
        source="graph LR; B-->C"
        streaming={false}
        copySource={vi.fn()}
      />
    )
    expect(await screen.findByRole("img", { name: "流程图" })).toHaveAttribute(
      "src",
      diagram.url
    )
    resolveOld?.({ ...diagram, url: "data:image/svg+xml,old" })
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "流程图" })).toHaveAttribute(
        "src",
        diagram.url
      )
    )
  })
  it("renders again with the active dark theme", async () => {
    render(<AssistantMarkdown content={content} />)
    await screen.findByRole("img", { name: "流程图" })
    document.documentElement.dataset.theme = "dark"
    document.documentElement.classList.add("dark")
    await waitFor(() =>
      expect(renderMermaidDiagram).toHaveBeenLastCalledWith(source, "dark")
    )
  })
  it("shows English export errors and prevents duplicate downloads while pending", async () => {
    await i18n.changeLanguage("en-US")
    let rejectExport: ((error: Error) => void) | undefined
    vi.mocked(exportMermaidPng).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectExport = reject
      })
    )
    render(<AssistantMarkdown content={content} />)
    await screen.findByRole("img", { name: "Flowchart" })
    await openActions()
    await user.click(screen.getByRole("menuitem", { name: "Export image" }))
    await openActions()
    const button = screen.getByRole("menuitem", { name: "Export image" })
    expect(button).toHaveAttribute("aria-disabled", "true")
    await user.click(button)
    expect(exportMermaidPng).toHaveBeenCalledOnce()
    rejectExport?.(new Error("private export error"))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Image export failed. Please try again."
      )
    )
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(button).not.toHaveAttribute("aria-disabled", "true")
  })
  it("reports copy failures without claiming success", async () => {
    render(
      <AssistantMermaid
        source={source}
        streaming={false}
        copySource={vi.fn().mockResolvedValue(false)}
      />
    )
    await screen.findByRole("img", { name: "流程图" })
    await openActions()
    await user.click(screen.getByRole("menuitem", { name: "复制代码" }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        i18n.t("conversation.copyContentFailed")
      )
    )
    expect(screen.queryByRole("button", { name: "代码已复制" })).toBeNull()
  })
})

describe("diagram loading and preview controls", () => {
  it("keeps rendering loading free of visible text and controls", async () => {
    let finish: ((value: typeof diagram) => void) | undefined
    vi.mocked(renderMermaidDiagram).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    render(<AssistantMarkdown content={content} />)
    const loading = screen.getByRole("status", { name: "正在绘制流程图…" })
    expect(loading).toHaveClass("assistant-html-preview-loading-surface")
    expect(loading.textContent).toBe("")
    expect(screen.queryByRole("button")).toBeNull()
    finish?.(diagram)
    await screen.findByRole("img", { name: "流程图" })
    expect(screen.queryByRole("status", { name: "正在绘制流程图…" })).toBeNull()
    expect(screen.queryByText("流程图")).toBeNull()
    expect(screen.getAllByRole("button")).toHaveLength(1)
    await openActions()
    expect(screen.getAllByRole("menuitem")).toHaveLength(3)
  })
  it("keeps the picture loading game mounted while incoming source grows", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 320, 320)
    )
    const view = render(<AssistantMarkdown content={content} streaming />)
    const loading = screen.getByRole("status")
    fireEvent.keyDown(loading, { key: "Enter" })
    const game = screen.getByRole("application", { name: "贪吃蛇" })
    view.rerender(
      <AssistantMarkdown
        content={content.replace("B[启动ICP备案]", "B[启动ICP备案]\n B --> C")}
        streaming
      />
    )
    expect(screen.getByRole("application", { name: "贪吃蛇" })).toBe(game)
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("expanded diagram controls", () => {
  it("allows wheel and button zoom beyond 300% up to 2000%, then resets", async () => {
    render(<AssistantMarkdown content={content} />)
    await screen.findByRole("img")
    await openActions()
    await user.click(screen.getByRole("menuitem", { name: "放大查看" }))
    const dialog = await screen.findByRole("dialog")
    const image = within(dialog).getByRole("img")
    const stage = image.closest(".image-preview-stage")!
    const zoomIn = within(dialog).getByRole("button", {
      name: i18n.t("conversation.diagram.zoomIn"),
    })
    for (let index = 0; index < 8; index++) fireEvent.click(zoomIn)
    expect(image).toHaveAttribute("data-zoom", "300")
    expect(zoomIn).toBeEnabled()
    fireEvent.click(zoomIn)
    expect(image).toHaveAttribute("data-zoom", "325")
    for (let index = 0; index < 20; index++) {
      fireEvent.wheel(stage, { deltaY: -100 })
    }
    expect(image).toHaveAttribute("data-zoom", "2000")
    expect(image.style.getPropertyValue("--image-preview-scale")).toBe("20")
    expect(zoomIn).toBeDisabled()
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: i18n.t("conversation.diagram.zoomOut"),
      })
    )
    expect(image).toHaveAttribute("data-zoom", "1975")
    expect(zoomIn).toBeEnabled()
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: i18n.t("conversation.diagram.resetZoom"),
      })
    )
    expect(image).toHaveAttribute("data-zoom", "100")
  })
  it.each(["zh-CN", "en-US"])(
    "combines wheel zoom, reset, copy and export in one bottom control group (%s)",
    async (language) => {
      await i18n.changeLanguage(language)
      render(<AssistantMarkdown content={content} />)
      await screen.findByRole("img")
      await openActions()
      await user.click(
        screen.getByRole("menuitem", {
          name: i18n.t("conversation.diagram.expand"),
        })
      )
      const dialog = await screen.findByRole("dialog")
      expect(dialog).toHaveClass("image-preview-dialog")
      expect(
        document.querySelector(".image-preview-overlay")
      ).toBeInTheDocument()
      expect(within(dialog).getByRole("heading").parentElement).toHaveClass(
        "sr-only"
      )
      expect(
        within(dialog).getByRole("button", { name: i18n.t("common.close") })
      ).toHaveClass("image-preview-control")
      const image = within(dialog).getByRole("img")
      const stage = image.closest<HTMLElement>(".image-preview-stage")!
      const toolbar = within(dialog).getByRole("group", {
        name: i18n.t("conversation.diagram.actions"),
      })
      expect(toolbar).toHaveClass("image-preview-zoom-controls")
      expect(toolbar).not.toHaveClass("shadow-lg", "border", "bg-background/95")
      expect(within(toolbar).getAllByRole("button")).toHaveLength(5)
      for (const button of within(toolbar).getAllByRole("button")) {
        expect(button).toHaveClass("image-preview-zoom-button")
      }
      expect(
        within(toolbar).getByRole("button", {
          name: i18n.t("conversation.diagram.resetZoom"),
        })
      ).toHaveClass("image-preview-zoom-value")
      const wheel = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
      })
      fireEvent(stage, wheel)
      expect(wheel.defaultPrevented).toBe(true)
      expect(image).toHaveAttribute("data-zoom", "122")
      expect(
        within(toolbar).getByRole("button", {
          name: i18n.t("conversation.diagram.resetZoom"),
        })
      ).toHaveTextContent("122%")
      fireEvent(
        stage,
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 100,
        })
      )
      expect(image).toHaveAttribute("data-zoom", "100")
      await user.click(
        within(toolbar).getByRole("button", {
          name: i18n.t("conversation.diagram.zoomIn"),
        })
      )
      expect(image).toHaveAttribute("data-zoom", "125")
      await user.click(
        within(toolbar).getByRole("button", {
          name: i18n.t("conversation.diagram.resetZoom"),
        })
      )
      expect(image).toHaveAttribute("data-zoom", "100")
      await user.click(
        within(toolbar).getByRole("button", {
          name: i18n.t("conversation.diagram.copy"),
        })
      )
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(source)
      expect(
        within(toolbar).getByRole("button", {
          name: i18n.t("conversation.codeCopied"),
        })
      ).toBeVisible()
      await user.click(
        within(toolbar).getByRole("button", {
          name: i18n.t("conversation.diagram.export"),
        })
      )
      await waitFor(() =>
        expect(exportMermaidPng).toHaveBeenCalledWith(diagram)
      )
      await user.keyboard("{Escape}")
      expect(screen.queryByRole("dialog")).toBeNull()
    }
  )
  it("keeps pinch single-handled, supports drag, and resets when reopened", async () => {
    render(<AssistantMarkdown content={content} />)
    await screen.findByRole("img")
    await openActions()
    await user.click(screen.getByRole("menuitem", { name: "放大查看" }))
    const dialog = await screen.findByRole("dialog")
    const image = within(dialog).getByRole("img")
    const stage = image.closest<HTMLElement>(".image-preview-stage")!
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 600, 480)
    )
    Object.defineProperties(image, {
      clientWidth: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 480 },
    })
    fireEvent(
      stage,
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -10,
      })
    )
    expect(image).toHaveAttribute("data-zoom", "110")
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    })
    fireEvent.pointerMove(stage, {
      buttons: 1,
      clientX: 120,
      clientY: 140,
      pointerId: 1,
    })
    fireEvent.pointerUp(stage, {
      button: 0,
      buttons: 0,
      clientX: 120,
      clientY: 140,
      pointerId: 1,
    })
    expect(image).toHaveAttribute("data-pan-x", "20")
    expect(image).toHaveAttribute("data-pan-y", "40")
    await user.click(
      within(dialog).getByRole("button", {
        name: i18n.t("conversation.diagram.resetZoom"),
      })
    )
    expect(image).toHaveAttribute("data-pan-x", "0")
    expect(image).toHaveAttribute("data-pan-y", "0")
    await user.keyboard("{Escape}")
    await openActions()
    await user.click(screen.getByRole("menuitem", { name: "放大查看" }))
    expect(
      within(await screen.findByRole("dialog")).getByRole("img")
    ).toHaveAttribute("data-zoom", "100")
  })
})

describe("inline diagram zoom", () => {
  it("allows keyboard and trackpad zoom beyond 300% up to 2000% without showing controls", async () => {
    render(<AssistantMarkdown content={content} />)
    const image = await screen.findByRole("img")
    const stage = image.closest(".image-preview-stage")!
    for (let index = 0; index < 9; index++)
      fireEvent.keyDown(stage, { key: "+" })
    expect(image).toHaveAttribute("data-zoom", "325")
    fireEvent.wheel(stage, { ctrlKey: true, deltaY: -10 })
    expect(Number(image.getAttribute("data-zoom"))).toBeGreaterThan(325)
    for (let index = 0; index < 50; index++)
      fireEvent.wheel(stage, { ctrlKey: true, deltaY: -100 })
    expect(image).toHaveAttribute("data-zoom", "2000")
    fireEvent.keyDown(stage, { key: "+" })
    expect(image).toHaveAttribute("data-zoom", "2000")
    fireEvent.keyDown(stage, { key: "0" })
    expect(image).toHaveAttribute("data-zoom", "100")
    expect(
      screen.queryByRole("button", { name: i18n.t("conversation.zoomIn") })
    ).toBeNull()
  })
  it("hides the zoom toolbar while preserving keyboard zoom inside the panel", async () => {
    render(<AssistantMarkdown content={content} />)
    const image = await screen.findByRole("img", { name: "流程图" })
    expect(
      screen.queryByRole("button", { name: i18n.t("conversation.zoomIn") })
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: i18n.t("conversation.zoomOut") })
    ).toBeNull()
    expect(screen.queryByText("100%")).toBeNull()
    expect(image).toHaveAttribute("data-zoom", "100")
    fireEvent.keyDown(image.closest(".image-preview-stage")!, { key: "+" })
    expect(image).toHaveAttribute("data-zoom", "125")
    expect(image.style.getPropertyValue("--image-preview-scale")).toBe("1.25")
    fireEvent.keyDown(image.closest(".image-preview-stage")!, { key: "-" })
    expect(image).toHaveAttribute("data-zoom", "100")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(image.closest(".image-preview-stage")).toHaveAttribute(
      "data-pannable",
      "true"
    )
  })
  it("exports the complete diagram after inline zooming", async () => {
    render(<AssistantMarkdown content={content} />)
    const image = await screen.findByRole("img", { name: "流程图" })
    fireEvent.keyDown(image.closest(".image-preview-stage")!, { key: "+" })
    await openActions()
    await user.click(screen.getByRole("menuitem", { name: "导出图片" }))
    await waitFor(() => expect(exportMermaidPng).toHaveBeenCalledWith(diagram))
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "流程图.png")
  })
})

describe("inline diagram gestures", () => {
  it("fits tall diagrams to the panel before zooming and dragging", async () => {
    render(<AssistantMarkdown content={content} />)
    const image = await screen.findByRole("img", { name: "流程图" })
    const stage = image.closest<HTMLElement>(".image-preview-stage")!
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 600, 480)
    )
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 600 },
      naturalHeight: { configurable: true, value: 2400 },
      clientWidth: { configurable: true, value: 120 },
      clientHeight: { configurable: true, value: 480 },
    })
    fireEvent.load(image)
    expect(image.style.getPropertyValue("--image-preview-fit-width")).toBe(
      "120px"
    )
    expect(image.style.getPropertyValue("--image-preview-fit-height")).toBe(
      "480px"
    )
    fireEvent.keyDown(image.closest(".image-preview-stage")!, { key: "+" })
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    })
    fireEvent.pointerMove(stage, {
      buttons: 1,
      clientX: 120,
      clientY: 140,
      pointerId: 1,
    })
    fireEvent.pointerUp(stage, {
      button: 0,
      buttons: 0,
      clientX: 120,
      clientY: 140,
      pointerId: 1,
    })
    expect(image).toHaveAttribute("data-pan-x", "20")
    expect(image).toHaveAttribute("data-pan-y", "40")
    fireEvent.keyDown(stage, { key: "0" })
    expect(image).toHaveAttribute("data-zoom", "100")
    expect(image).toHaveAttribute("data-pan-x", "0")
    expect(image).toHaveAttribute("data-pan-y", "0")
  })
  it("handles trackpad pinch while leaving regular page scrolling alone", async () => {
    render(<AssistantMarkdown content={content} />)
    const image = await screen.findByRole("img", { name: "流程图" })
    const stage = image.closest<HTMLElement>(".image-preview-stage")!
    const scroll = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    })
    fireEvent(stage, scroll)
    expect(image).toHaveAttribute("data-zoom", "100")
    expect(scroll.defaultPrevented).toBe(false)
    fireEvent(
      stage,
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -10,
      })
    )
    expect(image).toHaveAttribute("data-zoom", "110")
  })
})

describe("diagram message layout", () => {
  it("gives a diagram-only assistant message a full-width container", async () => {
    const conversation: Conversation = {
      id: "diagram-layout",
      title: "diagram",
      archived: false,
      project_id: null,
      collaboration_mode: "default",
      user_input_requests: [],
      plan_reviews: [],
      updated_at: "2026-09-16T00:00:00Z",
      has_unread_completion: false,
      has_automation: false,
      messages: [
        {
          id: "diagram-message",
          role: "assistant",
          turn_id: "diagram-turn",
          sequence_no: 1,
          content,
          created_at: "2026-09-16T00:00:00Z",
        },
      ],
      turns: [],
      running_turn: null,
      activities: [],
      artifacts: [],
    }
    render(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )
    const image = await screen.findByRole("img", { name: "流程图" })
    const message = image.closest(".message-content")
    expect(message).toHaveClass("has-[[data-assistant-diagram]]:w-full")
    expect(message?.querySelector("[data-assistant-diagram]")).toContainElement(
      image
    )
  })
  it("marks both the generating and rendering surfaces as full-width diagram content", async () => {
    const view = render(<AssistantMarkdown content={content} streaming />)
    expect(
      screen.getByRole("status").closest("[data-assistant-diagram]")
    ).not.toBeNull()
    vi.mocked(renderMermaidDiagram).mockReturnValue(new Promise(() => {}))
    view.rerender(<AssistantMarkdown content={content} />)
    expect(
      screen.getByRole("status").closest("[data-assistant-diagram]")
    ).not.toBeNull()
  })
})
