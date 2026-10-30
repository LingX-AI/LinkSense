import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supportedLocales, type BrowserPanelState } from "@linksense/shared"
import { apiRequest, ApiError } from "@/api/client"
import i18n from "@/i18n"
import { BrowserPanel } from "./browser-panel"
import { browserPanelMessages } from "./messages"
import { monitoringMessages } from "@/features/automations/monitoring-messages"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
const id = "20000000-0000-4000-8000-000000000001"
const frame: BrowserPanelState = {
  mode: "agent",
  has_control: false,
  lease_expires_at: null,
  frame: {
    image: "YQ==",
    url: "https://example.test/",
    title: "Test page",
    width: 800,
    height: 600,
  },
}
let claimed = false
beforeEach(async () => {
  claimed = false
  await i18n.changeLanguage("en-US")
  vi.mocked(apiRequest).mockImplementation(async (_path, options) => {
    const body = options.body as { action: string }
    if (body.action === "claim") claimed = true
    if (body.action === "release") claimed = false
    return {
      ...frame,
      mode: claimed ? "human" : "agent",
      has_control: claimed,
      lease_expires_at: claimed
        ? new Date(Date.now() + 30_000).toISOString()
        : null,
    } as never
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function host(options: { readOnly?: boolean; running?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onClose = vi.fn()
  const onContinue = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <BrowserPanel
        conversationId={id}
        readOnly={options.readOnly ?? false}
        running={options.running ?? false}
        onClose={onClose}
        onContinue={onContinue}
      />
    </QueryClientProvider>
  )
  return { ...view, onClose, onContinue }
}
const sent = () =>
  vi.mocked(apiRequest).mock.calls.map(([, options]) => options.body)

describe("browser panel control", () => {
  it("uses the shared preview layout when no browser session is available", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(
      new ApiError({ status: 404, errorCode: "BROWSER_PANEL_UNAVAILABLE" })
    )
    host()
    await screen.findByText(/No browser session is available/)
    expect(screen.getByRole("region", { name: "Browser" })).toHaveClass(
      "office-preview-pane"
    )
  })

  it("shows the task frame and leaves Plan mode read only", async () => {
    host({ readOnly: true })
    expect(await screen.findByRole("img", { name: "Test page" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Take control" })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("img", { name: "Test page" }))
    expect(sent()).toEqual([expect.objectContaining({ action: "frame" })])
  })
  it("claims the existing session and sends Chinese text without interpreting it", async () => {
    const user = userEvent.setup()
    host()
    await user.click(
      await screen.findByRole("button", { name: "Take control" })
    )
    const input = await screen.findByRole("textbox", {
      name: "Text for the focused page field",
    })
    fireEvent.change(input, { target: { value: '中文 "); page.close(); //' } })
    await user.click(screen.getByRole("button", { name: "Enter text" }))
    await waitFor(() => expect(input).toHaveValue(""))
    expect(input).toHaveFocus()
    expect(sent()).toContainEqual(
      expect.objectContaining({
        action: "input",
        input: { type: "text", text: '中文 "); page.close(); //' },
      })
    )
    await user.click(screen.getByRole("button", { name: "Send Enter key" }))
    expect(sent()).toContainEqual(
      expect.objectContaining({
        action: "input",
        input: { type: "key", key: "Enter" },
      })
    )
  })
  it("releases control when the header toggle or navigation unmounts the panel", async () => {
    const user = userEvent.setup()
    const view = host()
    await user.click(
      await screen.findByRole("button", { name: "Take control" })
    )
    await screen.findByRole("button", { name: "Return control" })
    view.unmount()
    await waitFor(() =>
      expect(sent()).toContainEqual(
        expect.objectContaining({ action: "release" })
      )
    )
    const claim = sent().find(
      (body) => (body as { action: string }).action === "claim"
    ) as { token: string }
    expect(sent()).toContainEqual({ action: "release", token: claim.token })
  })
  it("returns control before invoking the ordinary continuation flow", async () => {
    const user = userEvent.setup()
    const view = host()
    await user.click(
      await screen.findByRole("button", { name: "Take control" })
    )
    await user.click(
      await screen.findByRole("button", { name: "Return and continue task" })
    )
    await waitFor(() => expect(view.onContinue).toHaveBeenCalledOnce())
    expect(sent()).toContainEqual(
      expect.objectContaining({ action: "release" })
    )
  })
  it("does not forward composing Enter and lets Escape leave the viewport", async () => {
    const user = userEvent.setup()
    host()
    await user.click(
      await screen.findByRole("button", { name: "Take control" })
    )
    await screen.findByRole("button", { name: "Return control" })
    const viewport = screen.getByRole("application")
    const before = sent().length
    fireEvent.keyDown(viewport, {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    })
    fireEvent.keyDown(viewport, { key: "Escape" })
    expect(sent()).toHaveLength(before)
    expect(screen.getByRole("button", { name: "Refresh view" })).toHaveFocus()
  })
  it("keeps the panel open when releasing control fails", async () => {
    const user = userEvent.setup()
    const view = host()
    await user.click(
      await screen.findByRole("button", { name: "Take control" })
    )
    await screen.findByRole("button", { name: "Return control" })
    vi.mocked(apiRequest).mockRejectedValueOnce(
      new ApiError({ status: 409, errorCode: "BROWSER_CONTROL_BUSY" })
    )
    await user.click(
      screen.getByRole("button", { name: "Close browser panel" })
    )
    await screen.findByText(
      "A browser action is in progress. Try again shortly."
    )
    expect(view.onClose).not.toHaveBeenCalled()
  })
  it.each(supportedLocales)(
    "keeps labels and interpolation complete in %s",
    (locale) => {
      for (const [prefix, messages] of [
        ["browserPanel", browserPanelMessages],
        ["monitoring", monitoringMessages],
      ] as const) {
        expect(Object.keys(messages[locale]).sort()).toEqual(
          Object.keys(messages["zh-CN"]).sort()
        )
        for (const key of Object.keys(messages["zh-CN"])) {
          const path = `${prefix}.${key}`
          expect(i18n.t(path, { lng: locale })).not.toBe(path)
          expect(
            (i18n.t(path, { lng: locale }).match(/\{\{.*?\}\}/gu) ?? []).sort()
          ).toEqual(
            (i18n.t(path, { lng: "zh-CN" }).match(/\{\{.*?\}\}/gu) ?? []).sort()
          )
          if (locale !== "zh-CN") {
            const fallback = i18n.cloneInstance({ forkResourceStore: true })
            fallback.removeResourceBundle(locale, "translation")
            expect(fallback.t(path, { lng: locale })).toBe(
              i18n.t(path, { lng: "zh-CN" })
            )
          }
        }
      }
    }
  )
})
