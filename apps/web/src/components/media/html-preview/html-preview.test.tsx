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

import { HtmlPreview } from "@/components/media/html-preview/html-preview"
import { htmlPreviewReadyMessageType } from "@/components/media/html-preview/html-preview-fit"
import {
  htmlPreviewAnnotationFocusMessageType,
  htmlPreviewAnnotationModeMessageType,
  htmlPreviewSelectionMessageType,
} from "@/components/media/html-preview/html-preview-selection"
import {
  htmlPreviewShellInitializeMessageType,
  htmlPreviewShellReadyMessageType,
} from "@/components/media/html-preview/html-preview-shell"
import type { HtmlSelection } from "@/components/media/html-preview/html-preview.types"
import i18n from "@/i18n"

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function sendInteractionReady(frame: HTMLIFrameElement, deferredFit = false) {
  if (!frame.contentWindow) {
    throw new Error("HTML preview iframe window expected")
  }
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { type: htmlPreviewReadyMessageType, deferredFit },
    })
  )
}

function sendInteractionShellReady(
  frame: HTMLIFrameElement,
  previewId: string
) {
  if (!frame.contentWindow) {
    throw new Error("HTML preview iframe window expected")
  }
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { type: htmlPreviewShellReadyMessageType, previewId },
    })
  )
}

function sendSelection(
  frame: HTMLIFrameElement,
  selection: HtmlSelection | null
) {
  if (!frame.contentWindow) {
    throw new Error("HTML preview iframe window expected")
  }
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        type: htmlPreviewSelectionMessageType,
        selection,
        anchor: selection === null ? null : { right: 220, top: 20, bottom: 80 },
      },
    })
  )
}

const selectionAction = (onSubmit = vi.fn().mockResolvedValue(undefined)) => ({
  label: "问 LinkSense",
  shortcutLabel: "⌘I",
  promptLabel: "针对所选内容询问 LinkSense",
  placeholder: "描述修改",
  submitLabel: "发送",
  errorMessage: "发送失败",
  onSubmit,
})

describe("HTML preview", () => {
  it("loads the complete interactive artifact and local selection runtime through the isolated shell", async () => {
    render(
      <HtmlPreview
        document={{
          status: "ready",
          content: new TextEncoder().encode(
            `<!doctype html>
              <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
              <style>@keyframes reveal { from { opacity: 0 } to { opacity: 1 } }</style>
              <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
              <button class="rounded-xl" style="animation: reveal 2s both" onclick="window.clicked = true">继续</button>
              <script type="module">import("https://cdn.jsdelivr.net/npm/motion@11.11.17/+esm")</script>`
          ),
        }}
        fileName="interactive.html"
        onClose={vi.fn()}
      />
    )

    const interactionFrame = (await screen.findByTestId(
      "html-preview-interaction-frame"
    )) as HTMLIFrameElement
    const previewId = new URL(
      interactionFrame.src,
      window.location.href
    ).searchParams.get("previewId")
    if (!interactionFrame.contentWindow || !previewId) {
      throw new Error("Isolated HTML preview shell expected")
    }
    const postMessage = vi.spyOn(interactionFrame.contentWindow, "postMessage")

    expect(interactionFrame).toHaveAttribute(
      "src",
      expect.stringContaining("/assistant-html-preview-shell.html?")
    )
    expect(interactionFrame).not.toHaveAttribute("srcdoc")

    sendInteractionShellReady(interactionFrame, previewId)

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: htmlPreviewShellInitializeMessageType,
        previewId,
        html: expect.stringContaining('onclick="window.clicked = true"'),
      },
      "*"
    )
    const initializedMessage = postMessage.mock.calls[0]?.[0]
    if (
      typeof initializedMessage !== "object" ||
      initializedMessage === null ||
      !("html" in initializedMessage) ||
      typeof initializedMessage.html !== "string"
    ) {
      throw new Error("Initialized HTML preview document expected")
    }
    expect(initializedMessage.html).toContain("@keyframes reveal")
    expect(initializedMessage.html).toContain("animation: reveal 2s both")
    expect(initializedMessage.html).toContain(
      "https://fonts.googleapis.com/css2?family=Inter"
    )
    expect(initializedMessage.html).toContain(
      "https://cdn.jsdelivr.net/npm/motion@11.11.17/+esm"
    )
    expect(initializedMessage.html).toContain(
      "data-linksense-trusted-preview-runtime"
    )
    expect(initializedMessage.html).toContain("selecto.min")
    expect(initializedMessage.html).not.toContain(
      "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"
    )
    expect(initializedMessage.html).not.toContain("Content-Security-Policy")
  })

  it("enables annotation on the same live iframe without replacing the page", async () => {
    render(
      <HtmlPreview
        document={{
          status: "ready",
          content: new TextEncoder().encode(
            '<!doctype html><button onclick="window.clicked = true">继续</button>'
          ),
        }}
        fileName="interactive.html"
        selectionAction={selectionAction()}
        onClose={vi.fn()}
      />
    )

    const interactionFrame = (await screen.findByTestId(
      "html-preview-interaction-frame"
    )) as HTMLIFrameElement
    const postMessage = vi.spyOn(interactionFrame.contentWindow!, "postMessage")
    const interactionSandbox =
      interactionFrame.getAttribute("sandbox")?.split(/\s+/u) ?? []
    expect(interactionSandbox).toEqual(
      expect.arrayContaining([
        "allow-downloads",
        "allow-forms",
        "allow-modals",
        "allow-orientation-lock",
        "allow-pointer-lock",
        "allow-popups",
        "allow-popups-to-escape-sandbox",
        "allow-presentation",
        "allow-scripts",
        "allow-storage-access-by-user-activation",
        "allow-top-navigation-by-user-activation",
        "allow-top-navigation-to-custom-protocols",
      ])
    )
    expect(interactionSandbox).not.toContain("allow-same-origin")
    expect(interactionSandbox).not.toContain("allow-top-navigation")

    const modeButton = screen.getByRole("button", {
      name: "进入 HTML 标注模式",
    })
    expect(modeButton).toBeDisabled()
    fireEvent.load(interactionFrame)
    sendInteractionReady(interactionFrame)
    await waitFor(() => expect(modeButton).not.toBeDisabled())
    await userEvent.click(modeButton)

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        { type: htmlPreviewAnnotationModeMessageType, enabled: true },
        "*"
      )
    )
    expect(
      screen.getByRole("button", { name: "退出 HTML 标注模式" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("html-preview-interaction-frame")).toBe(
      interactionFrame
    )
    expect(interactionFrame).toHaveAttribute("aria-hidden", "false")
    expect(
      screen.queryByTestId("html-preview-annotation-frame")
    ).not.toBeInTheDocument()
  })

  it("submits a live iframe selection through the shared prompt", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <HtmlPreview
        document={{
          status: "ready",
          content: new TextEncoder().encode(
            '<!doctype html><html><body><h1 id="hero">欢迎</h1></body></html>'
          ),
        }}
        fileName="landing.html"
        selectionAction={selectionAction(onSubmit)}
        onClose={vi.fn()}
      />
    )

    const frame = (await screen.findByTestId(
      "html-preview-interaction-frame"
    )) as HTMLIFrameElement
    fireEvent.load(frame)
    sendInteractionReady(frame)
    await userEvent.click(
      screen.getByRole("button", { name: "进入 HTML 标注模式" })
    )
    sendSelection(frame, {
      elements: [
        {
          selector: "#hero",
          domPath: [0],
          tagName: "h1",
          id: "hero",
          classNames: [],
          text: "欢迎",
          outerHtml: '<h1 id="hero">欢迎</h1>',
          attributes: {},
          bounds: { x: 20, y: 20, width: 200, height: 60 },
        },
      ],
    })

    const askButton = await screen.findByRole("button", {
      name: /问 LinkSense/u,
    })
    await userEvent.click(askButton)
    await userEvent.type(
      screen.getByRole("textbox", { name: "针对所选内容询问 LinkSense" }),
      "改为英文"
    )
    await userEvent.click(screen.getByRole("button", { name: "发送" }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: [
          expect.objectContaining({
            selector: "#hero",
            tagName: "h1",
            text: "欢迎",
          }),
        ],
      }),
      "改为英文"
    )
  })

  it("draws numbered markers for saved element annotations", async () => {
    render(
      <HtmlPreview
        document={{
          status: "ready",
          content: new TextEncoder().encode(
            '<!doctype html><html><body><h1 id="hero">欢迎</h1></body></html>'
          ),
        }}
        fileName="landing.html"
        annotationMarkers={[
          {
            id: "draft-1",
            index: 1,
            selection: {
              elements: [
                {
                  selector: "#hero",
                  domPath: [0],
                  tagName: "h1",
                  id: "hero",
                  classNames: [],
                  text: "欢迎",
                  outerHtml: '<h1 id="hero">欢迎</h1>',
                  attributes: {},
                  bounds: { x: 20, y: 30, width: 200, height: 60 },
                },
              ],
            },
          },
        ]}
        onClose={vi.fn()}
      />
    )

    const overlay = await screen.findByTestId("html-preview-annotation-overlay")
    const frame = overlay.querySelector(
      '[data-html-annotation-frame="draft-1"]'
    )
    expect(frame).toHaveStyle({
      left: "20px",
      top: "30px",
      width: "200px",
      height: "60px",
    })
    expect(frame).toHaveTextContent("1")
    expect(
      screen.queryByRole("button", { name: /问 LinkSense/u })
    ).not.toBeInTheDocument()
  })

  it("asks the isolated HTML preview to reveal a saved annotation", async () => {
    const documentState = {
      status: "ready" as const,
      content: new TextEncoder().encode(
        '<!doctype html><html><body><h1 id="hero">欢迎</h1></body></html>'
      ),
    }
    const marker = {
      id: "draft-focus",
      index: 1,
      selection: {
        elements: [
          {
            selector: "#hero",
            domPath: [0],
            tagName: "h1",
            id: "hero",
            classNames: [] as string[],
            text: "欢迎",
            outerHtml: '<h1 id="hero">欢迎</h1>',
            attributes: {},
            bounds: { x: 600, y: 900, width: 200, height: 60 },
          },
        ],
      },
    }
    render(
      <HtmlPreview
        document={documentState}
        fileName="locate.html"
        annotationMarkers={[marker]}
        annotationNavigation={{ id: marker.id, sequence: 1 }}
        onClose={vi.fn()}
      />
    )

    const interactionFrame = (await screen.findByTestId(
      "html-preview-interaction-frame"
    )) as HTMLIFrameElement
    if (!interactionFrame.contentWindow) {
      throw new Error("HTML preview iframe window expected")
    }
    const postMessage = vi.spyOn(interactionFrame.contentWindow, "postMessage")
    fireEvent.load(interactionFrame)
    sendInteractionReady(interactionFrame)

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: htmlPreviewAnnotationFocusMessageType,
          bounds: { left: 600, top: 900, width: 200, height: 60 },
        },
        "*"
      )
    )
  })

  it("keeps the same interactive page state when entering and exiting annotation", async () => {
    render(
      <HtmlPreview
        document={{
          status: "ready",
          content: new TextEncoder().encode(
            '<!doctype html><html><body data-current-slide="3"><button>继续</button></body></html>'
          ),
        }}
        fileName="slides.html"
        selectionAction={selectionAction()}
        onClose={vi.fn()}
      />
    )

    const interactionFrame = (await screen.findByTestId(
      "html-preview-interaction-frame"
    )) as HTMLIFrameElement & { currentSlide?: string }
    const postMessage = vi.spyOn(interactionFrame.contentWindow!, "postMessage")
    interactionFrame.currentSlide = "3"
    fireEvent.load(interactionFrame)
    sendInteractionReady(interactionFrame)

    await userEvent.click(
      screen.getByRole("button", { name: "进入 HTML 标注模式" })
    )
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        { type: htmlPreviewAnnotationModeMessageType, enabled: true },
        "*"
      )
    )
    expect(screen.getByTestId("html-preview-interaction-frame")).toBe(
      interactionFrame
    )
    expect(interactionFrame.currentSlide).toBe("3")
    expect(interactionFrame).toHaveAttribute("aria-hidden", "false")

    await userEvent.click(
      screen.getByRole("button", { name: "退出 HTML 标注模式" })
    )

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        { type: htmlPreviewAnnotationModeMessageType, enabled: false },
        "*"
      )
    )
    expect(screen.getByTestId("html-preview-interaction-frame")).toBe(
      interactionFrame
    )
    expect(interactionFrame.currentSlide).toBe("3")
    expect(interactionFrame).toHaveAttribute("aria-hidden", "false")
  })

  it("rebuilds a cold-start frame that initialized before layout became stable", async () => {
    render(
      <HtmlPreview
        document={{
          status: "ready",
          content: new TextEncoder().encode("<main>冷启动预览</main>"),
        }}
        fileName="cold-start.html"
        onClose={vi.fn()}
      />
    )

    const firstFrame = await screen.findByTestId(
      "html-preview-interaction-frame"
    )
    expect(firstFrame).toHaveAttribute("data-html-preview-attempt", "0")

    sendInteractionReady(firstFrame as HTMLIFrameElement, true)

    await waitFor(() => {
      const replacementFrame = screen.getByTestId(
        "html-preview-interaction-frame"
      )
      expect(replacementFrame).not.toBe(firstFrame)
      expect(replacementFrame).toHaveAttribute("data-html-preview-attempt", "1")
    })

    const replacementFrame = screen.getByTestId(
      "html-preview-interaction-frame"
    )
    sendInteractionReady(replacementFrame as HTMLIFrameElement)

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    )
  })

  it("rebuilds an unacknowledged iframe once before showing a recoverable error", async () => {
    vi.useFakeTimers()
    render(
      <HtmlPreview
        document={{
          status: "ready",
          content: new TextEncoder().encode("<main>等待加载</main>"),
        }}
        fileName="delayed.html"
        onClose={vi.fn()}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40)
    })
    const firstFrame = screen.getByTestId("html-preview-interaction-frame")
    expect(firstFrame).toHaveAttribute("data-html-preview-attempt", "0")
    expect(screen.getByRole("status")).toHaveTextContent("正在加载文档")

    act(() => {
      vi.advanceTimersByTime(1_500)
    })

    const secondFrame = screen.getByTestId("html-preview-interaction-frame")
    expect(secondFrame).not.toBe(firstFrame)
    expect(secondFrame).toHaveAttribute("data-html-preview-attempt", "1")

    act(() => {
      vi.advanceTimersByTime(1_500)
    })

    expect(screen.getByRole("alert")).toHaveTextContent("无法预览此文档")
    expect(screen.getByRole("button", { name: "重试" })).toBeVisible()
  })

  it("fails closed when the artifact bytes are not valid UTF-8", () => {
    render(
      <HtmlPreview
        document={{ status: "ready", content: new Uint8Array([0xc3, 0x28]) }}
        fileName="broken.html"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole("alert")).toHaveTextContent("无法预览此文档")
    expect(
      screen.queryByTestId("html-preview-interaction-frame")
    ).not.toBeInTheDocument()
  })
})
