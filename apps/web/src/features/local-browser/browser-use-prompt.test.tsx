import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import i18n, { supportedLanguages } from "@/i18n"
import { apiRequest } from "@/api/client"
import { browserExtensionRequest } from "./bridge"
import { browserExtensionConnectionKey } from "./extension-state"
import { BrowserUsePrompt } from "./browser-use-prompt"
import { localBrowserMessages } from "./messages"
import { browserUseBrowser } from "./browser-support"

vi.mock("./bridge", () => ({ browserExtensionRequest: vi.fn() }))
vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))
vi.mock("./browser-support", () => ({
  browserUseBrowser: vi.fn(() => "chrome"),
}))
beforeEach(async () => {
  vi.resetAllMocks()
  vi.mocked(browserUseBrowser).mockReturnValue("chrome")
  sessionStorage.clear()
  await i18n.changeLanguage("zh-CN")
  vi.mocked(apiRequest).mockResolvedValue(true)
  vi.mocked(browserExtensionRequest).mockResolvedValue({ detected: false })
})
afterEach(cleanup)

it("never runs AI intent detection in an unsupported browser even when extension data is cached", () => {
  vi.mocked(browserUseBrowser).mockReturnValue(null)
  show()
  expect(apiRequest).not.toHaveBeenCalled()
  expect(screen.queryByText("Browser Use")).not.toBeInTheDocument()
})

type Messages = Parameters<typeof BrowserUsePrompt>[0]["messages"]
const browserRequest: Messages = [
  { id: "message-1", role: "user", content: "google 搜搜看看 guygubaby" },
]

function Destination() {
  const location = useLocation()
  return (
    <output>
      {JSON.stringify({ hash: location.hash, state: location.state })}
    </output>
  )
}

function show(
  messages: Messages = browserRequest,
  userId = "user-1",
  extension: Awaited<ReturnType<typeof browserExtensionRequest>> | null = {
    detected: false,
  }
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(browserExtensionConnectionKey(userId), extension)
  vi.mocked(browserExtensionRequest).mockResolvedValue(
    extension ?? { detected: false }
  )
  const tree = (messages: Messages) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/conversations/task-1?view=chat"]}>
          <Routes>
            <Route
              path="/conversations/:id"
              element={
                <>
                  <input aria-label="Draft" autoFocus />
                  <BrowserUsePrompt
                    userId={userId}
                    conversationId="task-1"
                    messages={messages}
                  />
                </>
              }
            />
            <Route path="/settings/general" element={<Destination />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const view = render(tree(messages))
  return {
    client,
    ...view,
    updateMessages: (next: Messages) => view.rerender(tree(next)),
  }
}

it("does not classify an empty task or an unsent message", () => {
  const empty = show([])
  expect(apiRequest).not.toHaveBeenCalled()
  empty.unmount()
  show([{ ...browserRequest[0], delivery_status: "sending" }])
  expect(apiRequest).not.toHaveBeenCalled()
})

it("uses a boolean AI decision for an implicit Google search request", async () => {
  show()
  expect(await screen.findByRole("link", { name: "前往安装" })).toBeVisible()
  expect(apiRequest).toHaveBeenCalledExactlyOnceWith(
    "/conversations/task-1/browser-use-intent",
    expect.objectContaining({
      method: "POST",
      body: { message_id: "message-1" },
    })
  )
  expect(browserExtensionRequest).toHaveBeenCalledExactlyOnceWith(
    "detect",
    undefined,
    { owner_id: "user-1" }
  )
})

it("refreshes connection state before AI so a just-connected browser never triggers the model", async () => {
  vi.mocked(browserExtensionRequest).mockResolvedValueOnce({
    detected: true,
    pairing_mode: "connected",
  })
  const { client } = show()
  await waitFor(() =>
    expect(
      client.getQueryData(browserExtensionConnectionKey("user-1"))
    ).toEqual({ detected: true, pairing_mode: "connected" })
  )
  expect(apiRequest).not.toHaveBeenCalled()
})

it.each([null, { detected: true, pairing_mode: "connected" }] as const)(
  "does not call the intent model while the extension state is %j",
  (extension) => {
    show(browserRequest, "user-1", extension)
    expect(apiRequest).not.toHaveBeenCalled()
    expect(screen.queryByText("Browser Use")).not.toBeInTheDocument()
  }
)

it("does not prompt when the model returns false for ordinary conversation", async () => {
  vi.mocked(apiRequest).mockResolvedValue(false)
  const { client } = show([{ id: "greeting", role: "user", content: "你好" }])
  await waitFor(() =>
    expect(
      client.getQueryData([
        "browser-use-intent",
        "user-1",
        "task-1",
        "greeting",
      ])
    ).toBe(false)
  )
  expect(screen.queryByText("Browser Use")).not.toBeInTheDocument()
})

it("offers installation without stealing composer focus and links directly to settings with a return path", async () => {
  show()
  const link = await screen.findByRole("link", { name: "前往安装" })
  expect(link).toHaveAttribute("href", "/settings/general#browser-extension")
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveFocus()
  expect(
    screen.getByText(localBrowserMessages["zh-CN"].setupMissing)
  ).toBeVisible()
  await userEvent.click(link)
  expect(screen.getByRole("status")).toHaveTextContent(
    '"hash":"#browser-extension"'
  )
  expect(screen.getByRole("status")).toHaveTextContent(
    '"settingsReturnTo":"/conversations/task-1?view=chat"'
  )
})

it.each(["pending", "blocked", "reconnecting"] as const)(
  "offers connection for a browser in %s state",
  async (pairing_mode) => {
    show(browserRequest, "user-1", { detected: true, pairing_mode })
    expect(await screen.findByRole("link", { name: "前往连接" })).toBeVisible()
    expect(
      screen.getByText(localBrowserMessages["zh-CN"].setupDisconnected)
    ).toBeVisible()
  }
)

it("hides the guide as soon as the browser connects without another model call", async () => {
  const { client } = show()
  await screen.findByRole("link", { name: "前往安装" })
  act(() =>
    client.setQueryData(browserExtensionConnectionKey("user-1"), {
      detected: true,
      pairing_mode: "connected",
    })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "前往安装" })
    ).not.toBeInTheDocument()
  )
  expect(apiRequest).toHaveBeenCalledTimes(1)
})

it("does not reclassify on assistant streaming, extension polling or refocus; each new user message is classified once", async () => {
  const { client, updateMessages } = show()
  await screen.findByRole("link", { name: "前往安装" })
  for (let index = 0; index < 4; index++) {
    updateMessages([
      ...browserRequest,
      {
        id: "reply",
        role: "assistant",
        content: "Searching".repeat(index + 1),
      },
    ])
    act(() =>
      client.setQueryData(browserExtensionConnectionKey("user-1"), {
        detected: false,
      })
    )
  }
  act(() => window.dispatchEvent(new Event("focus")))
  expect(apiRequest).toHaveBeenCalledTimes(1)
  vi.mocked(apiRequest).mockResolvedValue(false)
  updateMessages([
    ...browserRequest,
    { id: "next-request", role: "user", content: "接下来写一封信" },
  ])
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2))
  expect(
    screen.queryByRole("link", { name: "前往安装" })
  ).not.toBeInTheDocument()
})

it("silently skips failed detection without repeated requests or error UI", async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error("unavailable"))
  const { client } = show()
  await waitFor(() =>
    expect(
      client.getQueryData([
        "browser-use-intent",
        "user-1",
        "task-1",
        "message-1",
      ])
    ).toBe(false)
  )
  act(() => window.dispatchEvent(new Event("focus")))
  expect(apiRequest).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

it("ignores a late positive response after the user changes topic", async () => {
  let finish!: (value: boolean) => void
  vi.mocked(apiRequest)
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValue(false)
  const { updateMessages, client } = show()
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1))
  updateMessages([{ id: "new-topic", role: "user", content: "写一封信" }])
  await waitFor(() =>
    expect(
      client.getQueryData([
        "browser-use-intent",
        "user-1",
        "task-1",
        "new-topic",
      ])
    ).toBe(false)
  )
  await act(async () => finish(true))
  expect(
    screen.queryByRole("link", { name: "前往安装" })
  ).not.toBeInTheDocument()
})

it("remembers dismissal for this account and browser session and stops classification", async () => {
  const page = show()
  await userEvent.click(await screen.findByRole("button", { name: "暂不需要" }))
  expect(screen.queryByText("Browser Use")).not.toBeInTheDocument()
  page.unmount()
  const reopened = show()
  expect(apiRequest).toHaveBeenCalledTimes(1)
  reopened.unmount()
  show(browserRequest, "user-2")
  expect(await screen.findByRole("link", { name: "前往安装" })).toBeVisible()
  expect(apiRequest).toHaveBeenCalledTimes(2)
})

it("keeps a reopenable trigger after clicking the composer and still classifies the next request", async () => {
  const { updateMessages } = show()
  await screen.findByRole("link", { name: "前往安装" })
  await userEvent.click(screen.getByRole("textbox", { name: "Draft" }))
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "前往安装" })
    ).not.toBeInTheDocument()
  )
  const trigger = screen.getByRole("button", { name: "Browser Use" })
  expect(trigger).toHaveAttribute("aria-expanded", "false")
  await userEvent.click(trigger)
  expect(await screen.findByRole("link", { name: "前往安装" })).toBeVisible()
  await userEvent.click(screen.getByRole("textbox", { name: "Draft" }))
  updateMessages([
    ...browserRequest,
    { id: "next-search", role: "user", content: "google 搜搜 guygubaby" },
  ])
  expect(await screen.findByRole("link", { name: "前往安装" })).toBeVisible()
  expect(apiRequest).toHaveBeenCalledTimes(2)
})

it("ignores legacy dismissal flags that also recorded accidental outside clicks", async () => {
  sessionStorage.setItem(
    "linksense.browser-use.prompt-dismissed:user-1",
    "true"
  )
  show()
  expect(await screen.findByRole("link", { name: "前往安装" })).toBeVisible()
  expect(apiRequest).toHaveBeenCalledTimes(1)
})

it("collapses with Escape while the composer retains focus and the trigger remains available", async () => {
  show()
  await screen.findByRole("link", { name: "前往安装" })
  await userEvent.keyboard("{Escape}")
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "前往安装" })
    ).not.toBeInTheDocument()
  )
  expect(screen.getByRole("button", { name: "Browser Use" })).toHaveAttribute(
    "aria-expanded",
    "false"
  )
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveFocus()
})

it.each([...supportedLanguages, "de-DE"])(
  "renders the contextual guide in %s with Chinese fallback",
  async (language) => {
    await i18n.changeLanguage(language)
    const messages =
      localBrowserMessages[
        supportedLanguages.find((locale) => locale === language) ?? "zh-CN"
      ]
    show()
    expect(
      await screen.findByRole("link", { name: messages.setupInstall })
    ).toBeVisible()
    expect(screen.getByText(messages.setupTitle)).toBeVisible()
    expect(screen.getByText(messages.setupMissing)).toBeVisible()
  }
)
