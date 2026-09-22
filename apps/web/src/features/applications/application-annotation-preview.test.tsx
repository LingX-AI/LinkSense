import { createRef, useState } from "react"
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
import Selecto from "selecto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applicationDevelopmentSchema } from "@linksense/shared"
import i18n from "@/i18n"
import { ApiError } from "@/api/client"
import {
  htmlPreviewSelectionMessageType,
  type HtmlPreviewSelectionMessage,
} from "@/components/media/html-preview/html-preview-selection"
import { ApplicationAnnotationPreview } from "./application-annotation-preview"
import { installApplicationAnnotationRuntime } from "./application-annotation-runtime"

vi.mock("./application-annotation-runtime", () => ({
  installApplicationAnnotationRuntime: vi.fn((_frame, _source, ready) => {
    ready("index.html")
    return vi.fn()
  }),
}))
vi.mock(
  "@/features/conversations/use-voice-transcription-availability",
  () => ({ useVoiceTranscriptionAvailability: () => "not_configured" })
)
const project = applicationDevelopmentSchema.parse({
  id: "20000000-0000-4000-8000-000000000001",
  conversation_id: "20000000-0000-4000-8000-000000000002",
  name: "调研",
  directory: "apps/research",
  application_id: null,
  preview_application_id: "20000000-0000-4000-8000-000000000003",
  preview_conversation_id: "20000000-0000-4000-8000-000000000004",
  preview_current: true,
  revision: 2,
  source_hash: "a".repeat(64),
  installed_source_hash: null,
  source_error: null,
  manifest: null,
  diagnostics: [],
  updated_at: "2026-09-18T00:00:00Z",
})
const packageId = "20000000-0000-4000-8000-000000000005"
function show(
  onSubmit = vi.fn().mockResolvedValue(undefined),
  prepareFrame?: (frame: HTMLIFrameElement) => void
) {
  const frameRef = createRef<HTMLIFrameElement>()
  const onActiveChange = vi.fn()
  function Host() {
    const [controlsContainer, setControlsContainer] =
      useState<HTMLDivElement | null>(null)
    return (
      <>
        <header>
          <div ref={setControlsContainer} />
          <button aria-label="More actions">...</button>
        </header>
        <main>
          <ApplicationAnnotationPreview
            source="/api/v1/interactive-app-runtime/ticket/index.html"
            title="Preview"
            packageId={packageId}
            frameRef={frameRef}
            options={{ project, onSubmit, onActiveChange, controlsContainer }}
            onLoad={vi.fn()}
          />
        </main>
      </>
    )
  }
  render(<Host />)
  if (frameRef.current) prepareFrame?.(frameRef.current)
  fireEvent.load(screen.getByTitle("Preview"))
  return { frameRef, onSubmit, onActiveChange }
}
function selectionMessage(
  text = "提交",
  top = 30,
  selector = "#submit"
): HtmlPreviewSelectionMessage {
  return {
    type: htmlPreviewSelectionMessageType,
    selection: {
      elements: [
        {
          selector,
          domPath: [0],
          tagName: "button",
          classNames: [],
          attributes: {},
          text,
          bounds: { x: 20, y: top, width: 100, height: 40 },
        },
      ],
    },
    anchor: { right: 120, top, bottom: top + 40 },
  }
}
function select(
  frame: HTMLIFrameElement,
  text = "提交",
  top = 30,
  selector = "#submit"
) {
  const installed = vi
    .mocked(installApplicationAnnotationRuntime)
    .mock.calls.findLast(([candidate]) => candidate === frame)
  if (!installed) throw new Error("Missing annotation runtime")
  act(() => installed[4](selectionMessage(text, top, selector)))
}
async function fillPrompt(request: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: /问 LinkSense/ })
  )
  await userEvent.type(
    screen.getByRole("textbox", { name: "针对所选内容询问 LinkSense" }),
    request
  )
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "添加标注" })
  )
}
async function add(
  frame: HTMLIFrameElement,
  request: string,
  selector = "#submit"
) {
  select(frame, "提交", 30, selector)
  await fillPrompt(request)
}
async function send() {
  await userEvent.click(
    screen.getByRole("button", { name: /查看.*待发送标注/ })
  )
  await userEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "发送",
    })
  )
}
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(async () => {
  cleanup()
  document.documentElement.style.removeProperty("--app-selection")
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await i18n.changeLanguage("zh-CN")
})

describe("application annotation preview", () => {
  it("keeps an open prompt and its request when the selected element moves", async () => {
    const f = show()
    await userEvent.click(screen.getByRole("button", { name: "标注" }))
    select(f.frameRef.current!)
    await userEvent.click(
      await screen.findByRole("button", { name: /问 LinkSense/ })
    )
    await userEvent.type(screen.getByRole("textbox"), "保留正在填写的修改要求")
    select(f.frameRef.current!, "提交", 80)
    expect(screen.getByRole("textbox")).toHaveValue("保留正在填写的修改要求")
  })
  it("selects two locations in the live app, opens Ask LinkSense, numbers annotations and sends them together", async () => {
    document.documentElement.style.setProperty("--app-selection", "#0b73e0")
    const actual = await vi.importActual<
      typeof import("./application-annotation-runtime")
    >("./application-annotation-runtime")
    vi.mocked(installApplicationAnnotationRuntime).mockImplementationOnce(
      actual.installApplicationAnnotationRuntime
    )
    const f = show(undefined, (frame) => {
      const target = frame.contentWindow!
      target.document.open()
      target.document.write(
        '<!doctype html><html><head></head><body><h1 id="heading">主题调研</h1><button id="submit">提交</button></body></html>'
      )
      target.document.close()
      // jsdom omits postMessage.source; model the parent's command transport.
      vi.spyOn(target, "postMessage").mockImplementation((data: unknown) => {
        target.dispatchEvent(
          new MessageEvent("message", {
            source: target.parent,
            origin: window.location.origin,
            data,
          })
        )
      })
    })
    const target = f.frameRef.current!.contentWindow!
    Reflect.set(target, "Selecto", Selecto)
    fireEvent.load(target.document.querySelector("script")!)
    await userEvent.click(screen.getByRole("button", { name: "标注" }))
    expect(target.document.body).toHaveAttribute(
      "data-office-annotation-scope",
      "true"
    )
    const button = target.document.querySelector("button")!
    const heading = target.document.querySelector("h1")!
    const clicked = vi.fn()
    button.addEventListener("click", clicked)
    button.getBoundingClientRect = () => new DOMRect(20, 160, 100, 40)
    heading.getBoundingClientRect = () => new DOMRect(20, 30, 220, 40)
    const selectElement = (element: Element) => {
      const rect = element.getBoundingClientRect()
      const point = { clientX: rect.x + 10, clientY: rect.y + 10, button: 0 }
      fireEvent.mouseDown(element, { ...point, buttons: 1 })
      fireEvent.mouseUp(target, { ...point, buttons: 0 })
      fireEvent.click(element)
    }
    selectElement(button)
    expect(clicked).not.toHaveBeenCalled()
    await fillPrompt("按钮改成蓝色")
    expect(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    ).toBeVisible()
    selectElement(heading)
    await fillPrompt("标题居中")
    expect(
      screen.getByRole("button", { name: "查看 2 条待发送标注" })
    ).toBeVisible()
    const markers = [
      ...document.querySelectorAll(".html-preview-annotation-frame"),
    ]
    expect(markers.map((marker) => marker.textContent)).toEqual(["1", "2"])
    expect(f.onSubmit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "退出标注" }))
    fireEvent.click(button)
    expect(clicked).toHaveBeenCalledOnce()
    expect(f.onActiveChange).toHaveBeenLastCalledWith(true)
    await userEvent.click(screen.getByRole("button", { name: "标注" }))
    await send()
    expect(f.onSubmit).toHaveBeenCalledOnce()
    expect(f.onSubmit.mock.calls[0][0].annotation.annotations).toEqual([
      expect.objectContaining({
        request: "按钮改成蓝色",
        elements: [expect.objectContaining({ selector: "#submit" })],
      }),
      expect.objectContaining({
        request: "标题居中",
        elements: [expect.objectContaining({ selector: "#heading" })],
      }),
    ])
    expect(
      document.querySelectorAll(".html-preview-annotation-frame")
    ).toHaveLength(0)
    expect(f.onActiveChange).toHaveBeenLastCalledWith(false)
  })
  it.each([
    ["zh-CN", "标注", "问 LinkSense", "针对所选内容询问 LinkSense"],
    ["en-US", "Annotate", "Ask LinkSense", "Ask LinkSense about the selection"],
    ["de-DE", "标注", "问 LinkSense", "针对所选内容询问 LinkSense"],
  ])(
    "offers localized annotation controls and the HTML selection prompt in %s",
    async (language, label, ask, promptLabel) => {
      await i18n.changeLanguage(language)
      const f = show()
      const button = screen.getByRole("button", { name: label })
      expect(button).toBeEnabled()
      expect(button).toHaveClass("h-6")
      const header = screen.getByRole("banner")
      expect(header).toContainElement(button)
      expect(header.firstElementChild?.nextElementSibling).toBe(
        screen.getByRole("button", { name: "More actions" })
      )
      expect(screen.getByRole("main")).not.toContainElement(button)
      expect(
        screen.queryByText("选中页面上的内容，让 LinkSense 按你的要求修改。")
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(
          "Select content on the page and ask LinkSense to change it."
        )
      ).not.toBeInTheDocument()
      expect(screen.queryByText(/applicationDevelopment\./)).toBeNull()
      await userEvent.click(button)
      select(f.frameRef.current!)
      const askButton = await screen.findByRole("button", {
        name: new RegExp(ask),
      })
      expect(within(askButton).getByText("⌘I")).toBeVisible()
      await userEvent.click(askButton)
      expect(screen.getByRole("textbox", { name: promptLabel })).toBeVisible()
    }
  )
  it("ignores another iframe and sends multiple selected-element requests with the preview version", async () => {
    const f = show()
    await userEvent.click(screen.getByRole("button", { name: "标注" }))
    expect(f.onActiveChange).toHaveBeenLastCalledWith(true)
    fireEvent(
      window,
      new MessageEvent("message", {
        source: window,
        origin: window.location.origin,
        data: selectionMessage(),
      })
    )
    expect(screen.queryByRole("button", { name: /问 LinkSense/ })).toBeNull()
    await add(f.frameRef.current!, "改成蓝色")
    await add(f.frameRef.current!, "把文字加粗", "#heading")
    expect(f.onSubmit).not.toHaveBeenCalled()
    await send()
    await waitFor(() => expect(f.onSubmit).toHaveBeenCalledOnce())
    expect(f.onSubmit).toHaveBeenCalledWith({
      name: "调研",
      annotation: expect.objectContaining({
        kind: "application_annotation",
        development_id: project.id,
        package_id: packageId,
        source_hash: project.source_hash,
        page_path: "index.html",
        annotations: [
          expect.objectContaining({
            request: "改成蓝色",
            elements: [expect.objectContaining({ selector: "#submit" })],
          }),
          expect.objectContaining({
            request: "把文字加粗",
            elements: [expect.objectContaining({ selector: "#heading" })],
          }),
        ],
      }),
    })
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /查看.*待发送标注/ })
      ).toBeNull()
    )
    expect(f.onActiveChange).toHaveBeenLastCalledWith(false)
  })
  it("locates and removes individual annotations before sending the remaining requests", async () => {
    const f = show()
    await userEvent.click(screen.getByRole("button", { name: "标注" }))
    await add(f.frameRef.current!, "修改按钮")
    await add(f.frameRef.current!, "修改标题", "#heading")
    const post = vi.spyOn(f.frameRef.current!.contentWindow!, "postMessage")
    await userEvent.click(
      screen.getByRole("button", { name: "查看 2 条待发送标注" })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "定位到第 2 条标注" })
    )
    expect(post).toHaveBeenCalledWith(
      {
        type: "linksense:html-preview:annotation-focus",
        selectors: ["#heading"],
      },
      "*"
    )
    await userEvent.click(
      screen.getByRole("button", { name: "查看 2 条待发送标注" })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "删除第 1 条标注" })
    )
    expect(screen.queryByText("修改按钮")).not.toBeInTheDocument()
    expect(screen.getByText("修改标题")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "发送" }))
    expect(f.onSubmit).toHaveBeenCalledOnce()
    expect(f.onSubmit.mock.calls[0][0].annotation.annotations).toEqual([
      expect.objectContaining({
        request: "修改标题",
        elements: [expect.objectContaining({ selector: "#heading" })],
      }),
    ])
  })
  it("preserves drafts on stale-version failure, then permits clearing and resuming live preview", async () => {
    const f = show(
      vi.fn().mockRejectedValue(
        new ApiError({
          errorCode: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED",
          message: "changed",
          status: 409,
        })
      )
    )
    await userEvent.click(screen.getByRole("button", { name: "标注" }))
    await add(f.frameRef.current!, "改为绿色")
    await send()
    expect(
      await screen.findByText("批量标注发送失败，内容已保留，请重试。")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /查看 1 条/ })
    ).toBeInTheDocument()
    expect(f.onActiveChange).toHaveBeenLastCalledWith(true)
    await userEvent.click(screen.getByRole("button", { name: "清空" }))
    await userEvent.click(screen.getByRole("button", { name: "退出标注" }))
    expect(f.onActiveChange).toHaveBeenLastCalledWith(false)
  })
  it("leaves app viewing available when the annotation engine fails", async () => {
    vi.mocked(installApplicationAnnotationRuntime).mockImplementationOnce(
      (_frame, _source, _ready, error) => {
        error()
        return vi.fn()
      }
    )
    show()
    expect(screen.getByRole("button", { name: "标注" })).toBeDisabled()
    expect(screen.getByTitle("Preview")).toBeInTheDocument()
    expect(
      screen.getByText("暂时无法标注此页面，请重新打开应用预览。")
    ).toBeInTheDocument()
  })
})
