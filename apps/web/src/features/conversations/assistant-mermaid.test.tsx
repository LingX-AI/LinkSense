import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AssistantMarkdown } from "@/features/conversations/conversation-thread"
import { renderMermaidDiagram } from "@/features/conversations/mermaid-renderer"
import { exportMermaidPng } from "@/features/conversations/mermaid-export"
import { downloadBlob } from "@/lib/download-blob"
import i18n from "@/i18n"
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

beforeEach(async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "复制流程图代码" }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(source)
    )
    expect(
      await screen.findByRole("button", { name: "代码已复制" })
    ).toBeVisible()
  })
  it("waits until streaming finishes before rendering", async () => {
    const view = render(<AssistantMarkdown content={content} streaming />)
    expect(screen.getByRole("status")).toHaveTextContent("流程图生成中")
    expect(renderMermaidDiagram).not.toHaveBeenCalled()
    view.rerender(<AssistantMarkdown content={content} streaming={false} />)
    expect(await screen.findByRole("img", { name: "流程图" })).toBeVisible()
  })
  it("exports the full diagram and opens a readable enlarged view", async () => {
    render(<AssistantMarkdown content={content} />)
    await screen.findByRole("img", { name: "流程图" })
    fireEvent.click(screen.getByRole("button", { name: "导出图片" }))
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "流程图.png")
    )
    expect(exportMermaidPng).toHaveBeenCalledWith(diagram)
    fireEvent.click(screen.getByRole("button", { name: "放大查看" }))
    expect(await screen.findByRole("dialog", { name: "流程图" })).toBeVisible()
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
    expect(screen.getByRole("button", { name: "复制流程图代码" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "导出图片" })).toBeDisabled()
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
    const button = screen.getByRole("button", { name: "Export image" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(exportMermaidPng).toHaveBeenCalledOnce()
    rejectExport?.(new Error("private export error"))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Image export failed. Please try again."
      )
    )
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(button).toBeEnabled()
  })
  it("reports copy failures without claiming success", async () => {
    render(
      <AssistantMermaid
        source={source}
        streaming={false}
        copySource={vi.fn().mockResolvedValue(false)}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "复制流程图代码" }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        i18n.t("conversation.copyContentFailed")
      )
    )
    expect(screen.queryByRole("button", { name: "代码已复制" })).toBeNull()
  })
})
