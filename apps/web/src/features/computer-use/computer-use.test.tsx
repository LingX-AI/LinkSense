import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import i18n, { supportedLanguages } from "@/i18n"
import { apiRequest, downloadApiFile } from "@/api/client"
import { ComputerUseSettings } from "./computer-use-settings"
import { ComputerUsePrompt } from "./computer-use-prompt"
import { computerUsePlatform } from "./platform"

vi.mock("@/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/client")>()
  return { ...original, apiRequest: vi.fn(), downloadApiFile: vi.fn() }
})
const device = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "My Mac",
  platform: "darwin",
}
beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  sessionStorage.clear()
  await i18n.changeLanguage("zh-CN")
  vi.mocked(apiRequest).mockImplementation(async (endpoint) => {
    if (String(endpoint).includes("computer-use-intent")) return true
    return { connected: false, client_available: false }
  })
})
afterEach(cleanup)

function show(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const tree = (content: React.ReactNode) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <input aria-label="Draft" autoFocus />
          {content}
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const result = render(tree(element))
  return {
    ...result,
    client,
    update: (content: React.ReactNode) => result.rerender(tree(content)),
  }
}
const message = {
  id: "message-1",
  role: "user" as const,
  content: "操作这台电脑的备忘录",
}
const prompt = (id = message.id) => (
  <ComputerUsePrompt
    userId="user-1"
    conversationId="task-1"
    messages={[{ ...message, id }]}
  />
)

it.each([true, false, "throws"] as const)(
  "copies pairing codes without the secure Clipboard API and reports result %s",
  async (copied) => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard"
    )
    const commandDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "execCommand"
    )
    const user = userEvent.setup()
    const code = "p".repeat(43)
    const copy = vi.fn(() => {
      const field = document.querySelector<HTMLTextAreaElement>(
        "textarea.clipboard-copy-fallback"
      )
      expect(field?.value).toBe(code)
      expect(field?.selectionEnd).toBe(code.length)
      if (copied === "throws") throw new Error("copy unavailable")
      return copied
    })
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      })
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: copy,
      })
      vi.mocked(apiRequest).mockImplementation(async (endpoint) =>
        String(endpoint).endsWith("/pairing")
          ? {
              code,
              endpoint: "http://workspace.test/api/v1/computer-use",
              expires_at: new Date(Date.now() + 120_000).toISOString(),
            }
          : { connected: false, client_available: false }
      )
      show(<ComputerUseSettings userId="user-1" />)
      await user.click(
        screen.getByRole("button", { name: i18n.t("computerUse.pair") })
      )
      const copyButton = screen.getByRole("button", {
        name: i18n.t("computerUse.copy"),
      })
      await user.click(copyButton)
      await waitFor(() => expect(copy).toHaveBeenCalledWith("copy"))
      expect(
        screen.getByRole("button", {
          name: i18n.t(
            copied === true ? "computerUse.copied" : "computerUse.copy"
          ),
        })
      ).toBeVisible()
      expect(copyButton).toHaveFocus()
      expect(
        document.querySelector("textarea.clipboard-copy-fallback")
      ).toBeNull()
      expect(
        screen.getByLabelText(i18n.t("computerUse.pairingCode"))
      ).toHaveValue(code)
    } finally {
      if (clipboardDescriptor)
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor)
      else Reflect.deleteProperty(navigator, "clipboard")
      if (commandDescriptor)
        Object.defineProperty(document, "execCommand", commandDescriptor)
      else Reflect.deleteProperty(document, "execCommand")
    }
  }
)

it("classifies once without stealing focus and stops prompts after explicit dismissal", async () => {
  const view = show(prompt())
  expect(await screen.findByText("连接电脑以继续桌面操作")).toBeVisible()
  expect(screen.getByLabelText("Draft")).toHaveFocus()
  expect(apiRequest).toHaveBeenCalledWith(
    "/conversations/task-1/computer-use-intent",
    expect.objectContaining({
      body: { message_id: message.id },
      priority: "low",
    })
  )
  await userEvent.click(screen.getByRole("button", { name: "暂不需要" }))
  expect(
    sessionStorage.getItem("linksense.computer-use.prompt-dismissed:user-1")
  ).toBe("explicit")
  view.update(prompt("message-2"))
  expect(screen.queryByText("连接电脑以继续桌面操作")).toBeNull()
  expect(
    vi
      .mocked(apiRequest)
      .mock.calls.filter(([endpoint]) => String(endpoint).includes("intent"))
  ).toHaveLength(1)
})

it("does not classify empty, unsent or optimistic messages", () => {
  for (const messages of [
    [],
    [{ ...message, delivery_status: "sending" as const }],
    [{ ...message, id: "optimistic-message" }],
  ]) {
    const view = show(
      <ComputerUsePrompt
        userId="user-1"
        conversationId="task-1"
        messages={messages}
      />
    )
    expect(apiRequest).not.toHaveBeenCalled()
    view.unmount()
  }
})

it("rechecks device status on a new message after a previously connected client stops", async () => {
  let connected = true
  vi.mocked(apiRequest).mockImplementation(async (endpoint) =>
    String(endpoint).includes("intent")
      ? true
      : { connected, client_available: false }
  )
  const view = show(prompt())
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1))
  expect(screen.queryByText("Computer Use")).toBeNull()
  connected = false
  view.update(prompt("message-2"))
  expect(await screen.findByText("连接电脑以继续桌面操作")).toBeVisible()
})

it("allows revoking an offline paired device and never offers an absent installer as a working download", async () => {
  vi.mocked(apiRequest).mockResolvedValue({
    connected: false,
    device,
    client_available: false,
  })
  show(<ComputerUseSettings userId="user-1" />)
  const button = await screen.findByRole("button", { name: "断开并取消配对" })
  expect(screen.getByRole("button", { name: "下载客户端" })).toBeDisabled()
  await userEvent.click(button)
  expect(apiRequest).toHaveBeenCalledWith(
    "/computer-use",
    expect.objectContaining({ method: "DELETE" })
  )
})

it("does not offer a client on an unsupported platform", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Linux x86_64")
  vi.mocked(apiRequest).mockResolvedValue({
    connected: false,
    client_available: true,
    clients: { darwin: true, win32: true, linux: false },
  })
  show(<ComputerUseSettings userId="user-1" />)
  expect(
    await screen.findByRole("button", { name: "下载客户端" })
  ).toBeDisabled()
  expect(screen.getByText(i18n.t("computerUse.unavailable"))).toBeVisible()
})

it("offers the Windows client on Windows when it is available", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
  )
  expect(navigator.userAgent).toContain("Windows")
  vi.mocked(apiRequest).mockResolvedValue({
    connected: false,
    client_available: true,
    clients: { darwin: true, win32: true, linux: false },
  })
  show(<ComputerUseSettings userId="user-1" />)
  const download = await screen.findByRole("button", { name: "下载客户端" })
  await waitFor(() => expect(download).toBeEnabled())
  expect(screen.queryByText(i18n.t("computerUse.unavailable"))).toBeNull()
})

it.each([
  ["Win32", "win32", "LinkSense-Desktop-windows.exe"],
  ["MacIntel", "darwin", "LinkSense-Desktop-macos.zip"],
])("downloads the matching installer on %s", async (platform, target, file) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform)
  vi.mocked(apiRequest).mockResolvedValue({
    connected: false,
    clients: { darwin: true, win32: true, linux: false },
  })
  const blob = new Blob(["installer"])
  vi.mocked(downloadApiFile).mockResolvedValue(blob)
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:installer")
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {})
  show(<ComputerUseSettings userId="user-1" />)
  const download = screen.getByRole("button", {
    name: i18n.t("computerUse.download"),
  })
  await waitFor(() => expect(download).toBeEnabled())
  await userEvent.click(download)
  await waitFor(() => expect(click).toHaveBeenCalledOnce())
  expect(downloadApiFile).toHaveBeenCalledExactlyOnceWith(
    "/computer-use/client",
    { platform: target }
  )
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
  expect(click.mock.instances[0]).toHaveAttribute("download", file)
})

it("preserves macOS downloads when the API returns only legacy availability", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
  vi.mocked(apiRequest).mockResolvedValue({
    connected: false,
    device,
    client_available: true,
  })
  show(<ComputerUseSettings userId="user-1" />)
  await screen.findByText(device.name)
  expect(
    screen.getByRole("button", { name: i18n.t("computerUse.download") })
  ).toBeEnabled()
})

it("does not infer a Windows installer from legacy macOS availability", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32")
  vi.mocked(apiRequest).mockResolvedValue({
    connected: false,
    device,
    client_available: true,
  })
  show(<ComputerUseSettings userId="user-1" />)
  await screen.findByText(device.name)
  expect(
    screen.getByRole("button", { name: i18n.t("computerUse.download") })
  ).toBeDisabled()
})

it("keeps explicit macOS unavailability ahead of the legacy availability flag", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
  vi.mocked(apiRequest).mockResolvedValue({
    connected: false,
    device,
    client_available: true,
    clients: { darwin: false, win32: true, linux: false },
  })
  show(<ComputerUseSettings userId="user-1" />)
  await screen.findByText(device.name)
  expect(
    screen.getByRole("button", { name: i18n.t("computerUse.download") })
  ).toBeDisabled()
})

it("detects macOS from the browser platform", () => {
  expect(
    computerUsePlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0",
    })
  ).toBe("macos")
  expect(
    computerUsePlatform({
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    })
  ).toBe("windows")
})

it.each(supportedLanguages)(
  "renders the setup flow and pairing contract in %s",
  async (language) => {
    await i18n.changeLanguage(language)
    vi.mocked(apiRequest).mockImplementation(async (endpoint) =>
      String(endpoint).endsWith("/pairing")
        ? {
            code: "p".repeat(43),
            endpoint: "https://example.test/api/v1/computer-use",
            expires_at: new Date(Date.now() + 120_000).toISOString(),
          }
        : { connected: false, client_available: false }
    )
    show(<ComputerUseSettings userId="user-1" />)
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: i18n.t("computerUse.pair") })
      )
    })
    expect(
      await screen.findByLabelText(i18n.t("computerUse.pairingCode"))
    ).toHaveValue("p".repeat(43))
    expect(screen.getByText(i18n.t("computerUse.pairingHint"))).toBeVisible()
  }
)
