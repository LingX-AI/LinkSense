import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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
  vi.useRealTimers()
})
function show(conversationId = conversation) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <LocalBrowserPreview userId={owner} conversationId={conversationId} />
      </QueryClientProvider>
    </I18nextProvider>
  )
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
