import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ReadOnlyFilePreview,
  ReadOnlyFilePreviewContent,
} from "@/components/media/read-only-file-preview/read-only-file-preview"
import i18n from "@/i18n"

const pdf = vi.hoisted(() => ({
  options: null as { isEvalSupported?: boolean } | null,
  optionHistory: [] as Array<{ isEvalSupported?: boolean } | undefined>,
  fileHistory: [] as Blob[],
  pageNumberHistory: [] as number[],
  throwPageRender: false,
}))

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
)
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
)

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) Object.defineProperty(URL, name, descriptor)
  else Reflect.deleteProperty(URL, name)
}

vi.mock("react-pdf", () => ({
  Document: ({
    children,
    file,
    loading,
    options,
    onLoadError,
    onLoadSuccess,
    onSourceError,
  }: {
    children: ReactNode
    file?: Blob
    loading?: ReactNode
    options?: { isEvalSupported?: boolean }
    onLoadError?: () => void
    onLoadSuccess?: (document: { numPages: number }) => void
    onSourceError?: () => void
  }) => {
    pdf.options = options ?? null
    pdf.optionHistory.push(options)
    if (file) pdf.fileHistory.push(file)
    return (
      <>
        {loading}
        <button type="button" onClick={() => onLoadSuccess?.({ numPages: 2 })}>
          finish PDF load
        </button>
        <button type="button" onClick={onLoadError}>
          fail PDF load
        </button>
        <button type="button" onClick={onSourceError}>
          fail PDF source
        </button>
        {children}
      </>
    )
  },
  Page: ({
    pageNumber,
    onLoadError,
    onRenderError,
  }: {
    pageNumber: number
    onLoadError?: () => void
    onRenderError?: () => void
  }) => {
    pdf.pageNumberHistory.push(pageNumber)
    if (pdf.throwPageRender) throw new Error("PDF page render failed")
    return (
      <>
        <div>PDF page</div>
        <button type="button" onClick={onLoadError}>
          fail PDF page load
        </button>
        <button type="button" onClick={onRenderError}>
          fail PDF render
        </button>
      </>
    )
  },
  pdfjs: { GlobalWorkerOptions: {} },
}))

describe("read-only file preview", () => {
  beforeEach(async () => {
    pdf.options = null
    pdf.optionHistory = []
    pdf.fileHistory = []
    pdf.pageNumberHistory = []
    pdf.throwPageRender = false
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    restoreUrlMethod("createObjectURL", originalCreateObjectUrl)
    restoreUrlMethod("revokeObjectURL", originalRevokeObjectUrl)
  })

  it("renders Markdown without an Ask LinkSense action", () => {
    render(
      <ReadOnlyFilePreview
        kind="markdown"
        document={{
          status: "ready",
          content: new TextEncoder().encode("# 说明\n\n只读预览内容"),
        }}
        fileName="README.md"
        mimeType="text/markdown"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByTestId("markdown-file-preview")).toHaveTextContent(
      "只读预览内容"
    )
    expect(screen.queryByText("问 LinkSense")).toBeNull()
  })

  it("shows only the wrapping control in a standalone source preview toolbar", async () => {
    const user = userEvent.setup()
    render(
      <ReadOnlyFilePreview
        kind="code"
        document={{
          status: "ready",
          content: new TextEncoder().encode("const greeting = 'hello'"),
        }}
        fileName="example.ts"
        mimeType="text/typescript"
        onClose={vi.fn()}
      />
    )

    const codePreview = screen.getByTestId("code-file-preview")
    const wrapButton = screen.getByRole("button", {
      name: "关闭自动换行",
    })

    expect(codePreview).toContainElement(wrapButton)
    expect(screen.queryByText("只读")).toBeNull()
    await user.click(wrapButton)
    expect(wrapButton).toHaveAccessibleName("开启自动换行")
  })

  it("renders a bounded CSV grid with a read-only header", () => {
    render(
      <ReadOnlyFilePreview
        kind="csv"
        document={{
          status: "ready",
          content: new TextEncoder().encode("姓名,成绩\n林晓,98"),
        }}
        fileName="scores.csv"
        mimeType="text/csv"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByTestId("csv-file-preview")).toHaveTextContent("姓名")
    expect(screen.getByTestId("csv-file-preview")).toHaveTextContent("林晓")
    expect(screen.getByText("2 行 · 2 列")).toBeVisible()
  })

  it("uses the shared zoomable viewer for source-based images", async () => {
    const user = userEvent.setup()
    render(
      <ReadOnlyFilePreview
        kind="image"
        document={{
          status: "ready",
          source: {
            url: "https://files.example/cover.png",
            expiresAt: "2999-01-01T00:00:00.000Z",
          },
        }}
        fileName="cover.png"
        mimeType="image/png"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole("img", { name: "cover.png" })).toHaveAttribute(
      "src",
      "https://files.example/cover.png"
    )
    expect(
      screen.getByTestId("image-file-preview").firstElementChild
    ).toHaveClass("read-only-file-preview-image-viewer")
    expect(screen.getByRole("button", { name: "缩小图片" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "放大图片" }))
    expect(screen.getByText("125%")).toBeVisible()
  })

  it("keeps retry available when the shared image viewer cannot load", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <ReadOnlyFilePreview
        kind="image"
        document={{
          status: "ready",
          source: {
            url: "https://files.example/cover.png",
            expiresAt: "2999-01-01T00:00:00.000Z",
          },
        }}
        fileName="cover.png"
        mimeType="image/png"
        onClose={vi.fn()}
        onRetry={onRetry}
      />
    )

    fireEvent.error(screen.getByRole("img", { name: "cover.png" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法加载此图片。"
    )
    await user.click(screen.getByRole("button", { name: "重试" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("uses and releases a blob URL for byte-backed archive media", () => {
    const createObjectURL = vi.fn(() => "blob:archive-audio")
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })

    const view = render(
      <ReadOnlyFilePreviewContent
        kind="audio"
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="voice.mp3"
        mimeType="audio/mpeg"
      />
    )

    const source = screen
      .getByTestId("audio-file-preview")
      .querySelector("source")
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(source).toHaveAttribute("src", "blob:archive-audio")
    expect(source).toHaveAttribute("type", "audio/mpeg")

    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:archive-audio")
  })

  it("allows a failed media source to retry its short-lived URL request", async () => {
    const onRetry = vi.fn()
    render(
      <ReadOnlyFilePreview
        kind="audio"
        document={{
          status: "ready",
          source: {
            url: "https://files.example/voice.mp3",
            expiresAt: "2999-01-01T00:00:00.000Z",
          },
        }}
        fileName="voice.mp3"
        mimeType="audio/mpeg"
        onClose={vi.fn()}
        onRetry={onRetry}
      />
    )

    const audio = screen
      .getByTestId("audio-file-preview")
      .querySelector("audio")
    expect(audio).not.toBeNull()
    fireEvent.error(audio as HTMLAudioElement)

    expect(screen.getByRole("alert")).toHaveTextContent("无法加载此媒体文件。")
    await userEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("disables PDF eval before rendering an untrusted document", () => {
    render(
      <ReadOnlyFilePreview
        kind="pdf"
        document={{
          status: "ready",
          content: new Uint8Array([37, 80, 68, 70]),
        }}
        fileName="report.pdf"
        mimeType="application/pdf"
        onClose={vi.fn()}
      />
    )

    expect(pdf.options).toEqual({ isEvalSupported: false })
  })

  it("keeps PDF.js configuration stable and preserves cached bytes after load", async () => {
    const content = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])
    render(
      <ReadOnlyFilePreview
        kind="pdf"
        document={{ status: "ready", content }}
        fileName="report.pdf"
        mimeType="application/pdf"
        onClose={vi.fn()}
      />
    )

    expect(pdf.fileHistory.at(0)).toBeInstanceOf(Blob)
    await userEvent.click(screen.getByRole("button", { name: "finish PDF load" }))

    expect(pdf.optionHistory.length).toBeGreaterThanOrEqual(2)
    expect(
      pdf.optionHistory.every(
        (options) => options === pdf.optionHistory.at(0)
      )
    ).toBe(true)
    expect(
      pdf.fileHistory.every((file) => file === pdf.fileHistory.at(0))
    ).toBe(true)
    expect([...new Set(pdf.pageNumberHistory)]).toEqual([1, 2])
    expect(screen.getAllByText("PDF page")).toHaveLength(2)
    expect(
      screen.queryByRole("button", { name: "上一页 PDF" })
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: "下一页 PDF" })
    ).toBeNull()
    expect(content).toEqual(
      new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])
    )
  })

  it("uses the shared centered shimmer state while PDF pages are rendering", () => {
    render(
      <ReadOnlyFilePreview
        kind="pdf"
        document={{
          status: "ready",
          content: new Uint8Array([37, 80, 68, 70]),
        }}
        fileName="report.pdf"
        mimeType="application/pdf"
        onClose={vi.fn()}
      />
    )

    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("正在渲染 PDF")
    expect(status).toHaveClass("office-preview-state")
    expect(screen.getByText("正在渲染 PDF")).toHaveClass("shimmer")
    expect(status.querySelector("svg")).not.toBeInTheDocument()
  })

  it.each([
    ["document loading", "fail PDF load"],
    ["document source loading", "fail PDF source"],
    ["page loading", "fail PDF page load"],
    ["page rendering", "fail PDF render"],
  ])("contains %s failures inside the preview", async (_source, buttonName) => {
    render(
      <ReadOnlyFilePreview
        kind="pdf"
        document={{
          status: "ready",
          content: new Uint8Array([37, 80, 68, 70]),
        }}
        fileName="report.pdf"
        mimeType="application/pdf"
        onClose={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: buttonName }))

    expect(screen.getByRole("alert")).toHaveTextContent("无法渲染此 PDF。")
  })

  it("contains synchronous PDF rendering errors without unmounting the page", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const document = {
        status: "ready" as const,
        content: new Uint8Array([37, 80, 68, 70]),
      }
      const view = render(
        <ReadOnlyFilePreview
          kind="pdf"
          document={document}
          fileName="report.pdf"
          mimeType="application/pdf"
          onClose={vi.fn()}
        />
      )

      pdf.throwPageRender = true
      view.rerender(
        <ReadOnlyFilePreview
          kind="pdf"
          document={document}
          fileName="report.pdf"
          mimeType="application/pdf"
          onClose={vi.fn()}
        />
      )

      expect(screen.getByRole("alert")).toHaveTextContent("无法渲染此 PDF。")
      expect(screen.getByTitle("report.pdf")).toBeVisible()
    } finally {
      consoleError.mockRestore()
    }
  })
})
