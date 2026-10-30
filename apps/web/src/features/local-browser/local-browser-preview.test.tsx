import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ComponentProps, ReactNode } from "react"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import { browserExtensionRequest } from "./bridge"
import { LocalBrowserPreview } from "./local-browser-preview"

vi.mock("./bridge", () => ({ browserExtensionRequest: vi.fn() }))
const owner = "10000000-0000-4000-8000-000000000001"
const conversation = "20000000-0000-4000-8000-000000000001"
const preview = {
  tab_id: 7,
  title: "Reference page",
  url: "https://example.test/",
  image: "AQID",
  captured_at: 1,
}
const extraElements: HTMLElement[] = []
beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  await i18n.changeLanguage("zh-CN")
  vi.mocked(browserExtensionRequest).mockResolvedValue({
    detected: true,
    ok: true,
    preview,
  })
})
afterEach(() => {
  cleanup()
  extraElements.splice(0).forEach((element) => element.remove())
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function show(
  conversationId = conversation,
  options: Omit<
    ComponentProps<typeof LocalBrowserPreview>,
    "userId" | "conversationId"
  > = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <LocalBrowserPreview
      userId={owner}
      conversationId={conversationId}
      {...options}
    />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </I18nextProvider>
      ),
    }
  )
}

function mockLayout(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-local-browser-preview-boundary"))
        return new DOMRect(100, 100, width, height)
      if (this.tagName === "ASIDE") return new DOMRect(100, 100, 288, 220)
      return new DOMRect()
    }
  )
  const overview = document.createElement("div")
  const toolbar = document.createElement("div")
  document.body.append(overview, toolbar)
  extraElements.push(overview, toolbar)
  vi.spyOn(overview, "getBoundingClientRect").mockReturnValue(
    new DOMRect(width > 320 ? 800 : 112, 116, 296, 200)
  )
  return { overview, toolbar }
}
it("shows the authorized thumbnail and activates its exact task and tab on click", async () => {
  show()
  const button = await screen.findByRole("button", {
    name: "切换到标签页：Reference page",
  })
  expect(screen.getByRole("img", { name: "Reference page" })).toHaveAttribute(
    "draggable",
    "false"
  )
  fireEvent.click(button)
  await waitFor(() =>
    expect(browserExtensionRequest).toHaveBeenCalledWith(
      "activate",
      undefined,
      { owner_id: owner, conversation_id: conversation, tab_id: 7 }
    )
  )
})
it("does not display a preview when the extension is missing or the page is not authorized", async () => {
  vi.mocked(browserExtensionRequest).mockResolvedValue({ detected: false })
  show()
  await waitFor(() => expect(browserExtensionRequest).toHaveBeenCalled())
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
})
it("automatically shows the preview when the extension becomes available after the first request times out", async () => {
  vi.useFakeTimers()
  vi.mocked(browserExtensionRequest).mockResolvedValueOnce({ detected: false })
  show()
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  await act(() => vi.advanceTimersByTimeAsync(1600))
  expect(
    screen.getByRole("img", { name: "Reference page" })
  ).toBeInTheDocument()
})
it("hides the thumbnail without releasing or closing the user's browser tab", async () => {
  show()
  fireEvent.click(await screen.findByRole("button", { name: "隐藏浏览器预览" }))
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  expect(
    vi
      .mocked(browserExtensionRequest)
      .mock.calls.every((call) => call[0] === "preview")
  ).toBe(true)
})
it("supports keyboard corner movement and remembers the user's position", async () => {
  show()
  const handle = await screen.findByRole("button", {
    name: "拖动预览到四角，或使用方向键移动",
  })
  fireEvent.keyDown(handle, { key: "ArrowLeft" })
  fireEvent.keyDown(handle, { key: "ArrowUp" })
  expect(screen.getByRole("complementary")).toHaveAttribute(
    "data-corner",
    "top-left"
  )
  expect(
    localStorage.getItem(`linksense.browser-preview-corner:${owner}`)
  ).toBe("top-left")
})
it("reports a revoked tab instead of claiming that the browser was focused", async () => {
  vi.mocked(browserExtensionRequest).mockImplementation(async (type) =>
    type === "activate" ? { ok: false } : { preview }
  )
  show()
  fireEvent.click(
    await screen.findByRole("button", { name: "切换到标签页：Reference page" })
  )
  expect(await screen.findByRole("alert")).toHaveTextContent("无法切换到此页")
})

it("does not rewrite the saved corner when the overview opens or closes", async () => {
  const { overview } = mockLayout(1000, 700)
  const key = `linksense.browser-preview-corner:${owner}`
  localStorage.setItem(key, "top-right")
  const view = show(conversation, { overviewElement: overview })
  const card = await screen.findByRole("complementary")
  expect(card).toHaveAttribute("data-corner", "top-right")
  expect(localStorage.getItem(key)).toBe("top-right")

  view.rerender(
    <LocalBrowserPreview userId={owner} conversationId={conversation} />
  )
  expect(screen.getByRole("complementary")).toBe(card)
  expect(card).toHaveAttribute("data-corner", "top-right")
  expect(localStorage.getItem(key)).toBe("top-right")
})

it("keeps the same authorized tab while compact and expands without activating or closing it", async () => {
  const { overview, toolbar } = mockLayout(320, 260)
  const onExpand = vi.fn()
  const view = show(conversation, {
    overviewElement: overview,
    compactContainer: toolbar,
    onExpand,
  })
  const expand = await screen.findByRole("button", {
    name: "展开浏览器预览：Reference page",
  })
  expect(toolbar).toContainElement(expand)
  expect(expand).toHaveAttribute("aria-expanded", "false")
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  expect(
    document.getElementById(expand.getAttribute("aria-controls")!)
  ).toHaveAttribute("inert")
  fireEvent.click(expand)
  expect(onExpand).toHaveBeenCalledOnce()
  expect(
    vi
      .mocked(browserExtensionRequest)
      .mock.calls.every(([type]) => type === "preview")
  ).toBe(true)

  view.rerender(
    <LocalBrowserPreview
      userId={owner}
      conversationId={conversation}
      compactContainer={toolbar}
      onExpand={onExpand}
    />
  )
  const activate = await screen.findByRole("button", {
    name: "切换到标签页：Reference page",
  })
  expect(browserExtensionRequest).toHaveBeenCalledTimes(1)
  fireEvent.click(activate)
  await waitFor(() =>
    expect(browserExtensionRequest).toHaveBeenCalledWith(
      "activate",
      undefined,
      {
        owner_id: owner,
        conversation_id: conversation,
        tab_id: 7,
      }
    )
  )
})

it("keeps keyboard focus reachable when compacting and expanding the preview", async () => {
  const { overview, toolbar } = mockLayout(320, 260)
  const onExpand = vi.fn()
  const view = show(conversation, { compactContainer: toolbar, onExpand })
  const handle = await screen.findByRole("button", {
    name: "拖动预览到四角，或使用方向键移动",
  })
  handle.focus()
  view.rerender(
    <LocalBrowserPreview
      userId={owner}
      conversationId={conversation}
      overviewElement={overview}
      compactContainer={toolbar}
      onExpand={onExpand}
    />
  )
  const expand = await screen.findByRole("button", {
    name: "展开浏览器预览：Reference page",
  })
  await waitFor(() => expect(expand).toHaveFocus())
  fireEvent.click(expand)
  view.rerender(
    <LocalBrowserPreview
      userId={owner}
      conversationId={conversation}
      compactContainer={toolbar}
      onExpand={onExpand}
    />
  )
  await waitFor(() => expect(handle).toHaveFocus())
})

it("restores focus when a focused compact control disappears after layout becomes available", async () => {
  const { overview, toolbar } = mockLayout(320, 260)
  const onExpand = vi.fn()
  const view = show(conversation, {
    overviewElement: overview,
    compactContainer: toolbar,
    onExpand,
  })
  const expand = await screen.findByRole("button", {
    name: "展开浏览器预览：Reference page",
  })
  expand.focus()
  view.rerender(
    <LocalBrowserPreview
      userId={owner}
      conversationId={conversation}
      compactContainer={toolbar}
      onExpand={onExpand}
    />
  )
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "拖动预览到四角，或使用方向键移动",
      })
    ).toHaveFocus()
  )
})
