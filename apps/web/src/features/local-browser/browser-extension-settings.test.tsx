import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import i18n, { supportedLanguages } from "@/i18n"
import { apiRequest, downloadApiFile } from "@/api/client"
import { notify } from "@/components/feedback/notification"
import { browserExtensionRequest } from "./bridge"
import { BrowserExtensionSettings } from "./browser-extension-settings"
import { localBrowserMessages } from "./messages"
import { browserUseBrowser } from "./browser-support"

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn(),
  downloadApiFile: vi.fn(),
}))
vi.mock("./bridge", () => ({ browserExtensionRequest: vi.fn() }))
vi.mock("./browser-support", () => ({
  browserUseBrowser: vi.fn(() => "chrome"),
}))
vi.mock("@/components/feedback/notification", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))
beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(browserUseBrowser).mockReturnValue("chrome")
  await i18n.changeLanguage("zh-CN")
  vi.mocked(apiRequest).mockResolvedValue({ connected: false })
  vi.mocked(browserExtensionRequest).mockResolvedValue({ detected: false })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <BrowserExtensionSettings userId="user" />
      </QueryClientProvider>
    </I18nextProvider>
  )
}
it.each([...supportedLanguages, "de-DE"])(
  "guides unsupported browsers to desktop Chrome or Edge in %s without probing or pairing",
  async (language) => {
    vi.mocked(browserUseBrowser).mockReturnValue(null)
    await i18n.changeLanguage(language)
    const messages =
      localBrowserMessages[
        supportedLanguages.find((locale) => locale === language) ?? "zh-CN"
      ]
    show()
    expect(screen.getByText(messages.supportedBrowsers)).toBeVisible()
    expect(screen.getByText(messages.unsupportedDescription)).toBeVisible()
    expect(
      screen.getByRole("link", { name: messages.getChrome })
    ).toHaveAttribute("href", "https://www.google.com/chrome/")
    expect(
      screen.getByRole("link", { name: messages.getChrome })
    ).toHaveAttribute("data-slot", "button")
    expect(
      screen.getByRole("link", { name: messages.getEdge })
    ).toHaveAttribute("href", "https://www.microsoft.com/edge/download")
    expect(
      screen.getByRole("button", { name: messages.connect })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: messages.download })
    ).toBeDisabled()
    expect(browserExtensionRequest).not.toHaveBeenCalled()
    expect(apiRequest).not.toHaveBeenCalled()
  }
)
it("explains optional local capability without requesting a connection on mount", async () => {
  show()
  expect(
    await screen.findByText("未检测到扩展。安装后请刷新页面。")
  ).toBeVisible()
  expect(screen.getByRole("button", { name: "连接此浏览器" })).toBeDisabled()
  expect(screen.getByText(/云端浏览器无需安装/u)).toBeVisible()
  expect(browserExtensionRequest).toHaveBeenCalledExactlyOnceWith("detect")
  expect(apiRequest).not.toHaveBeenCalledWith(
    "/local-browser/pairing",
    expect.anything()
  )
})
it("pairs only after an explicit click and guides the extension confirmation", async () => {
  vi.mocked(browserExtensionRequest).mockResolvedValue({
    detected: true,
    ok: true,
  })
  const code = "x".repeat(43)
  vi.mocked(apiRequest).mockImplementation(async (path) =>
    path === "/local-browser/pairing"
      ? { code, endpoint: "https://example.test/api/v1/local-browser" }
      : { connected: false }
  )
  show()
  const button = screen.getByRole("button", { name: "连接此浏览器" })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  expect(
    await screen.findByText(/请在浏览器工具栏打开扩展并确认连接/u)
  ).toBeVisible()
  expect(browserExtensionRequest).toHaveBeenCalledWith(
    "pair",
    {
      code,
      endpoint: "https://example.test/api/v1/local-browser",
    },
    { owner_id: "user" }
  )
})
it("authors all six translations with matching keys and interpolation", () => {
  const keys = Object.keys(localBrowserMessages["zh-CN"]).sort()
  for (const messages of Object.values(localBrowserMessages)) {
    expect(Object.keys(messages).sort()).toEqual(keys)
    for (const value of Object.values(messages))
      expect(value.trim().length).toBeGreaterThan(0)
    expect(messages.connected.match(/{{\w+}}/g)).toEqual(["{{browser}}"])
    expect(messages.cloudName.match(/{{\w+}}/g)).toEqual(["{{productName}}"])
    expect(messages.localName.match(/{{\w+}}/g)).toEqual(["{{productName}}"])
    expect(messages.previewActivate.match(/{{\w+}}/g)).toEqual(["{{title}}"])
  }
})

it.each([...supportedLanguages, "de-DE"])(
  "renders five actionable steps with emphasized controls in %s and Chinese fallback",
  async (language) => {
    await i18n.changeLanguage(language)
    const messages =
      localBrowserMessages[
        supportedLanguages.find((locale) => locale === language) ?? "zh-CN"
      ]
    show()
    const list = screen.getByRole("list")
    const steps = within(list).getAllByRole("listitem")
    expect(steps).toHaveLength(5)
    expect(within(steps[0]).getByRole("button")).toBeEnabled()
    expect(
      within(steps[1]).getByRole("button", {
        name: i18n.t("localBrowser.openAddress", {
          address: "chrome://extensions",
        }),
      })
    ).toHaveTextContent("chrome://extensions")
    expect(
      within(steps[1]).queryByRole("button", {
        name: i18n.t("localBrowser.openAddress", {
          address: "edge://extensions",
        }),
      })
    ).not.toBeInTheDocument()
    expect(steps[1].querySelectorAll("strong")).toHaveLength(2)
    expect(within(steps[2]).getByRole("button")).toBeEnabled()
    expect(steps[4].querySelector("strong")).not.toBeNull()
    expect(list).not.toHaveTextContent(
      /<\/?(?:step|strong|download|reload|hint|extensions)>/u
    )
    expect(
      screen.getByRole("heading", { name: messages.install })
    ).toBeVisible()
    await screen.findByText(messages.notDetected)
  }
)

it("downloads the extension from the first installation step", async () => {
  const blob = new Blob(["extension"], { type: "application/zip" })
  vi.mocked(downloadApiFile).mockResolvedValue(blob)
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:extension")
  const download = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {})
  show()
  await userEvent.click(screen.getByRole("button", { name: "下载扩展" }))
  await waitFor(() => expect(download).toHaveBeenCalledOnce())
  expect(downloadApiFile).toHaveBeenCalledExactlyOnceWith(
    "/local-browser/extension"
  )
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
  expect(download.mock.instances[0]).toHaveAttribute(
    "download",
    "linksense-browser-extension.zip"
  )
})

it.each(["chrome://extensions", "edge://extensions"])(
  "requests a new tab for %s even when initial detection found no extension, without copying",
  async (address) => {
    vi.mocked(browserUseBrowser).mockReturnValue(
      address.startsWith("edge:") ? "edge" : "chrome"
    )
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
    vi.mocked(browserExtensionRequest)
      .mockResolvedValueOnce({ detected: false })
      .mockResolvedValue({ detected: true, ok: true })
    show()
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("localBrowser.openAddress", { address }),
      })
    )
    await waitFor(() =>
      expect(browserExtensionRequest).toHaveBeenCalledWith(
        "open_extensions",
        undefined,
        { owner_id: "user" }
      )
    )
    expect(copy).not.toHaveBeenCalled()
    expect(notify.success).not.toHaveBeenCalled()
    expect(notify.error).not.toHaveBeenCalled()
  }
)

it.each(["chrome", "edge"] as const)(
  "opens %s extension management through the installed extension with a leading external-link icon",
  async (browser) => {
    vi.mocked(browserUseBrowser).mockReturnValue(browser)
    vi.mocked(browserExtensionRequest).mockResolvedValue({
      detected: true,
      ok: true,
    })
    show()
    const address = `${browser}://extensions`
    const button = await screen.findByRole("button", {
      name: i18n.t("localBrowser.openAddress", { address }),
    })
    expect(button.querySelector("svg")).toHaveClass("lucide-external-link")
    expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg")
    expect(
      screen.queryByText(
        `${browser === "chrome" ? "edge" : "chrome"}://extensions`
      )
    ).not.toBeInTheDocument()
    await userEvent.click(button)
    expect(browserExtensionRequest).toHaveBeenCalledWith(
      "open_extensions",
      undefined,
      { owner_id: "user" }
    )
  }
)

it.each([false, true])(
  "copies the address only after opening fails when initially detected is %s",
  async (detected) => {
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
    vi.mocked(browserExtensionRequest)
      .mockResolvedValueOnce({ detected })
      .mockResolvedValue({ ok: false })
    show()
    await user.click(
      await screen.findByRole("button", {
        name: i18n.t("localBrowser.openAddress", {
          address: "chrome://extensions",
        }),
      })
    )
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith("chrome://extensions")
    )
    expect(browserExtensionRequest).toHaveBeenCalledWith(
      "open_extensions",
      undefined,
      { owner_id: "user" }
    )
    expect(notify.success).toHaveBeenCalledWith(
      i18n.t("localBrowser.extensionAddressCopied", {
        address: "chrome://extensions",
      })
    )
    expect(notify.error).not.toHaveBeenCalled()
  }
)

it("keeps the manager address visible if both opening and clipboard access fail", async () => {
  const user = userEvent.setup()
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("clipboard denied")
  )
  show()
  await user.click(
    screen.getByRole("button", {
      name: i18n.t("localBrowser.openAddress", {
        address: "chrome://extensions",
      }),
    })
  )
  await waitFor(() =>
    expect(notify.error).toHaveBeenCalledExactlyOnceWith(
      i18n.t("localBrowser.addressCopyFailed")
    )
  )
  expect(notify.success).not.toHaveBeenCalled()
  expect(screen.getByText("chrome://extensions")).toBeVisible()
})

it("reports clipboard failure for the separate LinkSense address action in an unsupported browser", async () => {
  const user = userEvent.setup()
  vi.mocked(browserUseBrowser).mockReturnValue(null)
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("clipboard denied")
  )
  show()
  await user.click(
    screen.getByRole("button", {
      name: i18n.t("localBrowser.copyAppAddress"),
    })
  )
  expect(notify.error).toHaveBeenCalledExactlyOnceWith(
    i18n.t("localBrowser.addressCopyFailed")
  )
  expect(notify.success).not.toHaveBeenCalled()
  expect(
    screen.getByRole("button", { name: i18n.t("localBrowser.copyAppAddress") })
  ).toBeVisible()
})

it("reloads the page from the installation instructions", async () => {
  const reload = vi.fn()
  vi.stubGlobal("location", {
    protocol: "http:",
    hostname: "localhost",
    reload,
  })
  show()
  await userEvent.click(screen.getByRole("button", { name: "刷新本页面" }))
  expect(reload).toHaveBeenCalledOnce()
})
