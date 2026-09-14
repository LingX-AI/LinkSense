import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BootstrapContext } from "@/app/bootstrap-state"
import { notify } from "@/components/feedback/notification"
import {
  assistantHtmlPreviewCaptureRequestMessageType,
  assistantHtmlPreviewCaptureSnapshotMessageType,
  assistantHtmlPreviewErrorMessageType,
  assistantHtmlPreviewReadyMessageType,
  assistantHtmlPreviewShellInitializeMessageType,
} from "@/features/conversations/assistant-html-preview-document"
import { renderAssistantHtmlPreviewSnapshot } from "@/features/conversations/assistant-html-preview-capture"
import { AssistantHtmlPreview } from "@/features/conversations/assistant-html-preview"
import i18n from "@/i18n"
import { downloadBlob } from "@/lib/download-blob"

vi.mock("@/components/feedback/notification", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/lib/download-blob", () => ({
  downloadBlob: vi.fn(),
}))

vi.mock("@/features/conversations/assistant-html-preview-capture", () => ({
  renderAssistantHtmlPreviewSnapshot: vi.fn(),
}))

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard"
)
const originalClipboardItem = Object.getOwnPropertyDescriptor(
  window,
  "ClipboardItem"
)
const originalFullscreenElement = Object.getOwnPropertyDescriptor(
  document,
  "fullscreenElement"
)
const originalExitFullscreen = Object.getOwnPropertyDescriptor(
  document,
  "exitFullscreen"
)

let fullscreenElement: Element | null = null
const clipboardWrite = vi.fn()

class ClipboardItemMock {
  readonly types: string[]
  readonly items: Record<string, Blob | Promise<Blob>>

  constructor(items: Record<string, Blob | Promise<Blob>>) {
    this.items = items
    this.types = Object.keys(items)
  }

  async getType(type: string) {
    const item = this.items[type]
    if (!item) throw new Error(`Missing clipboard item type: ${type}`)
    return item
  }
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) Object.defineProperty(target, key, descriptor)
  else Reflect.deleteProperty(target, key)
}

function renderReadyPreview(productName?: string) {
  const preview = (
    <AssistantHtmlPreview html="<!doctype html><html><body><button>Continue</button></body></html>" />
  )
  render(
    productName ? (
      <BootstrapContext.Provider
        value={{
          bootstrap: {
          initialized: true,
          initialization_credential_required: false,
            system_name: productName,
            default_language: "zh-CN",
            logo_url: null,
            logo_updated_at: null,
            oidc: undefined,
            teams_sso: undefined,
            password_email: undefined,
          },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }}
      >
        {preview}
      </BootstrapContext.Provider>
    ) : (
      preview
    )
  )
  const card = screen.getByRole("region", {
    name: "交互式 HTML 预览",
  })
  const frame = screen.getByTitle(
    "AI 生成的交互式 HTML 页面"
  ) as HTMLIFrameElement
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          type: assistantHtmlPreviewReadyMessageType,
          previewId: frame.dataset.assistantHtmlPreviewId,
        },
      })
    )
  })
  return { card, frame }
}

async function openActions(user: ReturnType<typeof userEvent.setup>) {
  await user.hover(screen.getByRole("region", { name: "交互式 HTML 预览" }))
  const trigger = screen.getByRole("button", { name: "HTML 预览操作" })
  trigger.focus()
  await user.keyboard("{Enter}")
}

describe("AssistantHtmlPreview actions", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    fullscreenElement = null
    clipboardWrite.mockReset()
    vi.mocked(downloadBlob).mockReset()
    vi.mocked(notify.success).mockReset()
    vi.mocked(notify.error).mockReset()
    vi.mocked(renderAssistantHtmlPreviewSnapshot).mockReset()
    vi.mocked(renderAssistantHtmlPreviewSnapshot).mockResolvedValue(
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
    )
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: ClipboardItemMock,
    })
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: clipboardWrite },
    })
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = null
        document.dispatchEvent(new Event("fullscreenchange"))
      }),
    })
  })

  afterEach(() => {
    cleanup()
    restoreProperty(navigator, "clipboard", originalClipboard)
    restoreProperty(window, "ClipboardItem", originalClipboardItem)
    restoreProperty(document, "fullscreenElement", originalFullscreenElement)
    restoreProperty(document, "exitFullscreen", originalExitFullscreen)
  })

  it.each(["ready", "error"] as const)(
    "unmounts the waiting game when the interactive preview becomes %s",
    (status) => {
      render(
        <AssistantHtmlPreview html="<!doctype html><html><body>Preview</body></html>" />
      )
      fireEvent.click(screen.getByRole("button", { name: "玩着等待" }))
      fireEvent.click(screen.getByRole("button", { name: "开始游戏" }))
      expect(screen.getByRole("application", { name: "贪吃蛇" })).toBeVisible()
      const frame = screen.getByTitle<HTMLIFrameElement>(
        "AI 生成的交互式 HTML 页面"
      )
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            data: {
              type:
                status === "ready"
                  ? assistantHtmlPreviewReadyMessageType
                  : assistantHtmlPreviewErrorMessageType,
              previewId: frame.dataset.assistantHtmlPreviewId,
            },
          })
        )
      })
      expect(screen.queryByRole("application", { name: "贪吃蛇" })).toBeNull()
      if (status === "ready") expect(frame).not.toHaveClass("invisible")
      else expect(screen.getByRole("alert")).toBeVisible()
    }
  )

  it("shows three preview actions after the iframe becomes ready", async () => {
    const user = userEvent.setup()
    const { card } = renderReadyPreview()
    const actions = card.querySelector<HTMLElement>(
      ".assistant-html-preview-actions"
    )
    const surface = card.querySelector<HTMLElement>(
      "[data-assistant-html-preview-surface='true']"
    )

    expect(actions).toHaveClass("absolute", "top-2", "left-full", "pl-2")
    expect(actions).not.toHaveClass("ml-2")
    expect(surface).not.toContainElement(actions)
    expect(surface).not.toHaveClass("border", "border-muted-foreground/15")
    expect(screen.getByRole("button", { name: "HTML 预览操作" })).toHaveClass(
      "size-7",
      "border-muted-foreground/20",
      "shadow-none"
    )
    await openActions(user)

    expect(
      screen.getByRole("menuitem", { name: "下载 HTML 文件" })
    ).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "复制为图像" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "全屏预览" })).toBeVisible()
  })

  it("initializes the preview on frame load when the first shell-ready message was missed", () => {
    render(
      <AssistantHtmlPreview html="<!doctype html><html><body>Preview</body></html>" />
    )
    const frame = screen.getByTitle(
      "AI 生成的交互式 HTML 页面"
    ) as HTMLIFrameElement
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage")

    fireEvent.load(frame)

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: assistantHtmlPreviewShellInitializeMessageType,
        previewId: frame.dataset.assistantHtmlPreviewId,
        html: expect.stringContaining("<body>Preview</body>"),
      }),
      "*"
    )
  })

  it("uses a compact neutral alert when the preview runtime fails", () => {
    render(
      <AssistantHtmlPreview html="<!doctype html><html><body>Preview</body></html>" />
    )
    const frame = screen.getByTitle(
      "AI 生成的交互式 HTML 页面"
    ) as HTMLIFrameElement

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: assistantHtmlPreviewErrorMessageType,
            previewId: frame.dataset.assistantHtmlPreviewId,
          },
        })
      )
    })

    const alert = screen.getByRole("alert")
    expect(alert).toHaveClass(
      "flex",
      "max-w-sm",
      "items-center",
      "text-center",
      "shadow-none"
    )
    expect(alert).not.toHaveClass("text-destructive")
    expect(screen.getByText("暂时无法显示交互式预览")).toBeVisible()
    expect(screen.getByText("交互组件加载失败，请重试。")).toBeVisible()
    const retryButton = screen.getByRole("button", { name: "重试" })
    expect(retryButton).toBeVisible()
    expect(retryButton).toHaveClass("bg-secondary", "shadow-none")
    expect(retryButton.parentElement).toHaveClass("mt-2")
  })

  it("downloads the original HTML document", async () => {
    const user = userEvent.setup()
    renderReadyPreview("MOSS 工作台")
    await openActions(user)

    await user.click(screen.getByRole("menuitem", { name: "下载 HTML 文件" }))

    expect(downloadBlob).toHaveBeenCalledOnce()
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0]!
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe("text/html;charset=utf-8")
    expect(filename).toBe("MOSS-工作台-interactive-preview.html")
  })

  it("captures the iframe with html2canvas and writes a PNG to the clipboard", async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: clipboardWrite },
    })
    const { frame } = renderReadyPreview()
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage")
    clipboardWrite.mockImplementation(
      async (items: readonly ClipboardItemMock[]) => {
        const image = await items[0]?.getType("image/png")
        expect(image).toBeInstanceOf(Blob)
        expect(image?.type).toBe("image/png")
      }
    )
    await openActions(user)

    const click = user.click(
      screen.getByRole("menuitem", { name: "复制为图像" })
    )
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: assistantHtmlPreviewCaptureRequestMessageType,
          previewId: frame.dataset.assistantHtmlPreviewId,
        }),
        "*"
      )
    )
    expect(clipboardWrite).toHaveBeenCalledOnce()
    const captureMessage = postMessage.mock.calls.find(
      ([message]) =>
        message.type === assistantHtmlPreviewCaptureRequestMessageType
    )?.[0]
    expect(captureMessage).toBeDefined()
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: assistantHtmlPreviewCaptureSnapshotMessageType,
            previewId: frame.dataset.assistantHtmlPreviewId,
            requestId: captureMessage.requestId,
            html: "<!doctype html><html><body>Preview</body></html>",
            viewportWidth: 1_200,
            width: 1_200,
            height: 800,
          },
        })
      )
    })
    await click

    expect(clipboardWrite).toHaveBeenCalledOnce()
    expect(renderAssistantHtmlPreviewSnapshot).toHaveBeenCalledWith({
      html: "<!doctype html><html><body>Preview</body></html>",
      viewportWidth: 1_200,
      width: 1_200,
      height: 800,
    })
    expect(notify.success).toHaveBeenCalledWith("已复制为图像")
  })

  it("reports a copy failure when rendering the isolated snapshot fails", async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: clipboardWrite },
    })
    const { frame } = renderReadyPreview()
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage")
    vi.mocked(renderAssistantHtmlPreviewSnapshot).mockRejectedValue(
      new Error("render failed")
    )
    clipboardWrite.mockImplementation(
      async (items: readonly ClipboardItemMock[]) => {
        await items[0]?.getType("image/png")
      }
    )
    await openActions(user)

    const click = user.click(
      screen.getByRole("menuitem", { name: "复制为图像" })
    )
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: assistantHtmlPreviewCaptureRequestMessageType,
        }),
        "*"
      )
    )
    const captureMessage = postMessage.mock.calls.find(
      ([message]) =>
        message.type === assistantHtmlPreviewCaptureRequestMessageType
    )?.[0]
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: assistantHtmlPreviewCaptureSnapshotMessageType,
            previewId: frame.dataset.assistantHtmlPreviewId,
            requestId: captureMessage.requestId,
            html: "<!doctype html><html><body>Preview</body></html>",
            viewportWidth: 1_200,
            width: 1_200,
            height: 800,
          },
        })
      )
    })
    await click

    await waitFor(() =>
      expect(renderAssistantHtmlPreviewSnapshot).toHaveBeenCalledOnce()
    )
    expect(clipboardWrite).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("无法复制图像，请重试。")
    )
    expect(notify.success).not.toHaveBeenCalled()
  })

  it("fills the screen and offers a close control without replacing the iframe", async () => {
    const user = userEvent.setup()
    const { card, frame } = renderReadyPreview()
    const requestFullscreen = vi.fn(async () => {
      fullscreenElement = card
      document.dispatchEvent(new Event("fullscreenchange"))
    })
    Object.defineProperty(card, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    })
    await openActions(user)

    await user.click(screen.getByRole("menuitem", { name: "全屏预览" }))

    expect(requestFullscreen).toHaveBeenCalledOnce()
    expect(card).toHaveClass("h-screen", "w-screen")
    expect(
      card.querySelector("[data-assistant-html-preview-surface='true']")
    ).toHaveClass("rounded-none", "border-0")
    expect(screen.getByRole("button", { name: "退出全屏预览" })).toBeVisible()
    expect(screen.getByTitle("AI 生成的交互式 HTML 页面")).toBe(frame)

    await user.click(screen.getByRole("button", { name: "退出全屏预览" }))

    expect(document.exitFullscreen).toHaveBeenCalledOnce()
    expect(card).not.toHaveClass("h-screen")
    expect(screen.queryByRole("button", { name: "退出全屏预览" })).toBeNull()
  })
})
