import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { supportedLocales } from "@linksense/shared"
import { setAccessToken } from "@/api/session"
import i18n from "@/i18n"
import { connectionMessages } from "@/features/connections/messages"
import oneDriveLogo from "@/features/connections/assets/onedrive.svg"
import sharePointLogo from "@/features/connections/assets/sharepoint.svg"
import googleDocsLogo from "@/features/connections/assets/google-docs.png"
import gmailLogo from "@/features/connections/assets/gmail.png"
import outlookLogo from "@/features/connections/assets/outlook.svg"
import { ConnectionCatalogPanel } from "./connection-catalog-panel"

const items = [
  {
    provider: "onedrive",
    configured: true,
    status: "connected",
    access_mode: "read_write",
    account_name: "member@example.test",
    connected_at: "2026-09-23T00:00:00Z",
  },
  {
    provider: "sharepoint",
    configured: true,
    status: "disconnected",
    access_mode: null,
    account_name: null,
    connected_at: null,
  },
]
const authorizationTab = {
  opener: window as Window | null,
  closed: false,
  close: vi.fn(),
  location: { replace: vi.fn() },
}
const openTab = vi.fn(() => authorizationTab)
function mount(path = "/capabilities?section=connector&scope=personal") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: {
              retry: false,
              staleTime: 15_000,
              refetchOnWindowFocus: false,
            },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <ConnectionCatalogPanel />
      </MemoryRouter>
    </QueryClientProvider>
  )
}
beforeEach(async () => {
  authorizationTab.opener = window
  authorizationTab.closed = false
  authorizationTab.close.mockClear()
  authorizationTab.location.replace.mockClear()
  openTab.mockClear()
  vi.stubGlobal("open", openTab)
  focusManager.setFocused(true)
  setAccessToken("test-only-session")
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  focusManager.setFocused(undefined)
  vi.unstubAllGlobals()
})
describe("official connector catalog", () => {
  it.each([
    ["google_docs", "Google 文档", googleDocsLogo],
    ["gmail", "Gmail", gmailLogo],
    ["outlook", "Outlook 邮箱", outlookLogo],
  ])(
    "uses the real %s product logo in both the card and details",
    async (provider, name, logo) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            success: true,
            data: { items: [{ ...items[1], provider }] },
          })
        )
      )
      mount()
      const card = await screen.findByRole("article", { name })
      const cardLogo = card.querySelector("img")
      expect(cardLogo).toHaveAttribute("src", logo)
      expect(cardLogo).toHaveAttribute("alt", "")
      expect(cardLogo).toHaveAttribute("aria-hidden", "true")
      expect(cardLogo).toHaveClass("size-10", "object-contain")
      fireEvent.click(
        within(card).getByRole("button", { name: `查看${name}详情` })
      )
      const dialog = await screen.findByRole("dialog", { name })
      expect(dialog.querySelector("img")).toHaveAttribute("src", logo)
    }
  )
  it.each(supportedLocales)(
    "shows read-only grants and opens write authorization in a new tab in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const readonlyItems = items.map((item) =>
        item.provider === "onedrive" ? { ...item, access_mode: "read" } : item
      )
      const fetch = vi.fn(async (_url: unknown, init?: RequestInit) =>
        init?.method === "POST"
          ? Response.json({
              success: true,
              data: {
                authorization_url:
                  "https://login.microsoftonline.com/authorize",
              },
            })
          : Response.json({ success: true, data: { items: readonlyItems } })
      )
      vi.stubGlobal("fetch", fetch)
      mount()
      expect(await screen.findByText("member@example.test")).toBeVisible()
      const card = screen.getByText("OneDrive").closest('[data-slot="card"]')
      expect(card?.querySelectorAll('[data-slot="badge"]')).toHaveLength(1)
      expect(
        screen.getByRole("img", { name: connectionMessages[locale].connected })
      ).toBeVisible()
      expect(
        screen.getByText(connectionMessages[locale].upgradeHelp)
      ).toBeVisible()
      await userEvent.click(
        screen.getByRole("button", {
          name: i18n.t("common.moreActionsNamed", { name: "OneDrive" }),
        })
      )
      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: connectionMessages[locale].upgrade,
        })
      )
      await waitFor(() =>
        expect(authorizationTab.location.replace).toHaveBeenCalledWith(
          "https://login.microsoftonline.com/authorize"
        )
      )
      expect(openTab).toHaveBeenCalledWith("about:blank", "_blank")
    }
  )
  it.each([
    ["onedrive", "重新连接"],
    ["sharepoint", "连接"],
  ])(
    "opens %s authorization in a new isolated tab without navigating the connector tab",
    async (provider, label) => {
      let resolveAuthorization!: (response: Response) => void
      const originalUrl = window.location.href
      const fetch = vi.fn(async (_url: unknown, init?: RequestInit) =>
        init?.method === "POST"
          ? new Promise<Response>((resolve) => {
              resolveAuthorization = resolve
            })
          : Response.json({ success: true, data: { items } })
      )
      vi.stubGlobal("fetch", fetch)
      mount()
      if (provider === "onedrive") {
        await userEvent.click(
          await screen.findByRole("button", {
            name: i18n.t("common.moreActionsNamed", { name: "OneDrive" }),
          })
        )
        fireEvent.click(await screen.findByRole("menuitem", { name: label }))
      } else {
        fireEvent.click(await screen.findByRole("button", { name: label }))
      }
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      // A tab must be reserved during the click, before the authorization API resolves.
      expect(openTab).toHaveBeenCalledWith("about:blank", "_blank")
      expect(authorizationTab.opener).toBeNull()
      expect(authorizationTab.location.replace).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(
          fetch.mock.calls.some(
            ([url]) => url === `/api/v1/connections/${provider}/authorize`
          )
        ).toBe(true)
      )
      const menuTrigger = screen.getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: "OneDrive" }),
      })
      expect(menuTrigger).toBeDisabled()
      expect(menuTrigger).toHaveAttribute(
        "aria-busy",
        String(provider === "onedrive")
      )
      expect(screen.getByRole("button", { name: "连接" })).toBeDisabled()
      const authorizationUrl =
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=test-only"
      resolveAuthorization(
        Response.json({
          success: true,
          data: { authorization_url: authorizationUrl },
        })
      )
      await waitFor(() =>
        expect(authorizationTab.location.replace).toHaveBeenCalledWith(
          authorizationUrl
        )
      )
      expect(window.location.href).toBe(originalUrl)
      expect(authorizationTab.close).not.toHaveBeenCalled()
      await waitFor(() => expect(menuTrigger).toBeEnabled())
    }
  )
  it("explains blocked new tabs without starting authorization or replacing this page", async () => {
    vi.stubGlobal(
      "open",
      vi.fn(() => null)
    )
    const fetch = vi.fn(async () =>
      Response.json({ success: true, data: { items } })
    )
    vi.stubGlobal("fetch", fetch)
    const originalUrl = window.location.href
    mount()
    fireEvent.click(await screen.findByRole("button", { name: "连接" }))
    expect(
      await screen.findByText(i18n.t("connections.tabBlocked"))
    ).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe(originalUrl)
  })
  it("refreshes connection status when returning from the authorization tab even if the cache is fresh", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ success: true, data: { items } })
    )
    vi.stubGlobal("fetch", fetch)
    mount()
    await screen.findByText("member@example.test")
    act(() => focusManager.setFocused(false))
    fetch.mockResolvedValueOnce(
      Response.json({
        success: true,
        data: {
          items: items.map((item) =>
            item.provider === "sharepoint"
              ? {
                  ...item,
                  status: "connected",
                  account_name: "new-account@example.test",
                }
              : item
          ),
        },
      })
    )
    act(() => focusManager.setFocused(true))
    expect(await screen.findByText("new-account@example.test")).toBeVisible()
  })
  it("shows loading until accounts arrive and offers retry after a failed list request", async () => {
    let resolveList!: (response: Response) => void
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveList = resolve
          })
      )
      .mockResolvedValue(Response.json({ success: true, data: { items } }))
    vi.stubGlobal("fetch", fetch)
    mount()
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    resolveList(
      Response.json(
        { success: false, error_code: "CONNECTION_UNAVAILABLE" },
        { status: 503 }
      )
    )
    expect(
      await screen.findByText(i18n.t("connections.errors.unavailable"))
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common.retry") })
    )
    expect(await screen.findByText("member@example.test")).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it("starts SharePoint authorization once and allows retry after a safe error", async () => {
    let resolveAuthorization!: (response: Response) => void
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? new Promise<Response>((resolve) => {
            resolveAuthorization = resolve
          })
        : Response.json({ success: true, data: { items } })
    )
    vi.stubGlobal("fetch", fetch)
    mount()
    const connect = await screen.findByRole("button", { name: "连接" })
    fireEvent.click(connect)
    await waitFor(() => expect(connect).toBeDisabled())
    fireEvent.click(connect)
    const authorizations = fetch.mock.calls.filter(
      ([, init]) => init?.method === "POST"
    )
    expect(authorizations).toHaveLength(1)
    expect(authorizations[0]?.[0]).toBe(
      "/api/v1/connections/sharepoint/authorize"
    )
    resolveAuthorization(
      Response.json(
        {
          success: false,
          error_code: "CONNECTION_AUTH_FAILED",
          message: "private-provider-detail",
        },
        { status: 400 }
      )
    )
    expect(
      await screen.findByText(i18n.t("connections.errors.authFailed"))
    ).toBeVisible()
    expect(
      screen.queryByText("private-provider-detail")
    ).not.toBeInTheDocument()
    expect(connect).toBeEnabled()
    expect(authorizationTab.close).toHaveBeenCalledOnce()
    expect(authorizationTab.location.replace).not.toHaveBeenCalled()
  })
  it("places the action menu immediately to the right of the connected check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, data: { items } }))
    )
    mount()
    expect(await screen.findByText("member@example.test")).toBeVisible()
    expect(screen.getByText("SharePoint")).toBeVisible()
    expect(screen.queryByText("读写访问")).not.toBeInTheDocument()
    expect(screen.queryByText("已连接")).not.toBeInTheDocument()
    const oneDriveTitle = screen.getByText("OneDrive")
    const oneDriveTitleRow = oneDriveTitle.closest(
      '[data-slot="card-header"]'
    )?.firstElementChild
    const connectedCheck = screen.getByRole("img", { name: "已连接" })
    expect(oneDriveTitleRow).toHaveClass("justify-between")
    const menuTrigger = screen.getByRole("button", {
      name: i18n.t("common.moreActionsNamed", { name: "OneDrive" }),
    })
    expect(oneDriveTitleRow?.lastElementChild).toContainElement(connectedCheck)
    expect(connectedCheck.nextElementSibling).toBe(menuTrigger)
    expect(menuTrigger).toHaveClass("relative", "z-10")
    expect(oneDriveTitle.parentElement).not.toContainElement(connectedCheck)
    expect(connectedCheck).toHaveClass(
      "capability-status-badge",
      "capability-status-badge-active",
      "capability-status-badge-icon-only",
      "[&>svg]:size-4!"
    )
    expect(connectedCheck).not.toHaveClass("[&>svg]:size-3!")
    expect(connectedCheck.querySelector("svg.lucide-check")).toBeInTheDocument()
    expect(screen.queryByText("未连接")).not.toBeInTheDocument()
    const disconnectedCard = screen.getByRole("article", { name: "SharePoint" })
    expect(
      within(disconnectedCard).queryByRole("img", { name: "未连接" })
    ).toBeNull()
    expect(within(disconnectedCard).queryByText("未连接")).toBeNull()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    expect(screen.queryByText("自定义连接")).not.toBeInTheDocument()
    expect(
      screen
        .getByText("OneDrive")
        .closest('[data-slot="card-title"]')
        ?.querySelector("img")
    ).toHaveAttribute("src", oneDriveLogo)
    expect(
      screen
        .getByText("SharePoint")
        .closest('[data-slot="card-title"]')
        ?.querySelector("img")
    ).toHaveAttribute("src", sharePointLogo)
    expect(decodeURIComponent(oneDriveLogo)).toContain("#0364b8")
    expect(decodeURIComponent(sharePointLogo)).toContain("#036c70")
  })
  it("opens a connected card's details with its account and matching actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, data: { items } }))
    )
    mount()
    const trigger = await screen.findByRole("button", {
      name: "查看OneDrive详情",
    })
    expect(trigger.tagName).toBe("BUTTON")
    expect(trigger).toHaveClass("after:inset-0")
    expect(trigger.closest('[data-slot="card-header"]')).toHaveClass(
      "@container-normal"
    )
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    const details = await screen.findByRole("dialog", { name: "OneDrive" })
    expect(
      within(details).getByText(connectionMessages["zh-CN"].onedriveDescription)
    ).toBeVisible()
    expect(within(details).getByText("member@example.test")).toBeVisible()
    expect(within(details).getByText("已连接")).toBeVisible()
    expect(
      within(details).getByRole("button", { name: "重新连接" })
    ).toBeEnabled()
    expect(within(details).getByRole("button", { name: "解绑" })).toBeEnabled()
    fireEvent.click(within(details).getByRole("button", { name: "关闭" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await waitFor(() => expect(trigger).toHaveFocus())
  })
  it("shows Connect in disconnected details and authorizes in a new tab", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({
            success: true,
            data: {
              authorization_url: "https://login.microsoftonline.com/authorize",
            },
          })
        : Response.json({ success: true, data: { items } })
    )
    vi.stubGlobal("fetch", fetch)
    mount()
    fireEvent.click(
      await screen.findByRole("button", { name: "查看SharePoint详情" })
    )
    const details = await screen.findByRole("dialog", { name: "SharePoint" })
    expect(within(details).getByText("未连接")).toBeVisible()
    expect(within(details).queryByText("member@example.test")).toBeNull()
    expect(within(details).queryByRole("button", { name: "解绑" })).toBeNull()
    fireEvent.click(within(details).getByRole("button", { name: "连接" }))
    expect(openTab).toHaveBeenCalledWith("about:blank", "_blank")
    await waitFor(() =>
      expect(authorizationTab.location.replace).toHaveBeenCalledWith(
        "https://login.microsoftonline.com/authorize"
      )
    )
  })
  it("shows a blocked authorization tab only in the affected connector's details", async () => {
    vi.stubGlobal(
      "open",
      vi.fn(() => null)
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, data: { items } }))
    )
    mount()
    fireEvent.click(
      await screen.findByRole("button", { name: "查看SharePoint详情" })
    )
    const sharePointDetails = await screen.findByRole("dialog", {
      name: "SharePoint",
    })
    fireEvent.click(
      within(sharePointDetails).getByRole("button", { name: "连接" })
    )
    expect(
      within(sharePointDetails).getByText(i18n.t("connections.tabBlocked"))
    ).toBeVisible()
    fireEvent.click(
      within(sharePointDetails).getByRole("button", { name: "关闭" })
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "查看OneDrive详情" })
    )
    const oneDriveDetails = await screen.findByRole("dialog", {
      name: "OneDrive",
    })
    expect(
      within(oneDriveDetails).queryByText(i18n.t("connections.tabBlocked"))
    ).not.toBeInTheDocument()
  })
  it("asks for confirmation before unlinking from the details dialog", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ success: true, data: { items } })
    )
    vi.stubGlobal("fetch", fetch)
    mount()
    fireEvent.click(
      await screen.findByRole("button", { name: "查看OneDrive详情" })
    )
    const details = await screen.findByRole("dialog", { name: "OneDrive" })
    fireEvent.click(within(details).getByRole("button", { name: "解绑" }))
    const confirmation = await screen.findByRole("dialog", {
      name: "解绑 OneDrive？",
    })
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(
      false
    )
    fireEvent.click(within(confirmation).getByRole("button", { name: "解绑" }))
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([, init]) => init?.method === "DELETE")
      ).toBe(true)
    )
  })
  it("offers the write upgrade in read-only details and disables unconfigured connections", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({
            success: true,
            data: {
              authorization_url: "https://login.microsoftonline.com/authorize",
            },
          })
        : Response.json({
            success: true,
            data: {
              items: items.map((item) =>
                item.provider === "onedrive"
                  ? { ...item, access_mode: "read" }
                  : { ...item, configured: false }
              ),
            },
          })
    )
    vi.stubGlobal("fetch", fetch)
    mount()
    fireEvent.click(
      await screen.findByRole("button", { name: "查看OneDrive详情" })
    )
    const oneDriveDetails = await screen.findByRole("dialog", {
      name: "OneDrive",
    })
    expect(
      within(oneDriveDetails).getByText(connectionMessages["zh-CN"].upgradeHelp)
    ).toBeVisible()
    expect(
      within(oneDriveDetails).getByRole("button", { name: "启用读写" })
    ).toBeEnabled()
    fireEvent.click(
      within(oneDriveDetails).getByRole("button", { name: "关闭" })
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "查看SharePoint详情" })
    )
    const sharePointDetails = await screen.findByRole("dialog", {
      name: "SharePoint",
    })
    expect(within(sharePointDetails).getByText("尚未配置")).toBeVisible()
    expect(
      within(sharePointDetails).getByText(connectionMessages["zh-CN"].setupHelp)
    ).toBeVisible()
    expect(
      within(sharePointDetails).getByRole("button", { name: "连接" })
    ).toBeDisabled()
  })
  it("uses a gray Connect button and puts reconnect and unlink in the header menu with confirmation", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method && init.method !== "GET"
        ? new Response(null, { status: 204 })
        : Response.json({ success: true, data: { items } })
    )
    vi.stubGlobal("fetch", fetch)
    mount()
    await screen.findByText("member@example.test")
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    const connect = screen.getByRole("button", { name: "连接" })
    expect(connect).toHaveClass("bg-secondary", "h-7")
    expect(screen.queryByRole("button", { name: "重新连接" })).toBeNull()
    expect(screen.queryByRole("button", { name: "解绑" })).toBeNull()
    const card = screen.getByRole("article", { name: "OneDrive" })
    expect(card.querySelector('[data-slot="card-footer"]')).toBeNull()
    await userEvent.click(
      within(card).getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: "OneDrive" }),
      })
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    const reconnect = await screen.findByRole("menuitem", { name: "重新连接" })
    const unbind = await screen.findByRole("menuitem", { name: "解绑" })
    expect(unbind).toHaveAttribute("data-variant", "destructive")
    expect(reconnect.querySelector("svg.lucide-link-2")).toBeInTheDocument()
    expect(connect.querySelector("svg.lucide-link-2")).toBeInTheDocument()
    expect(unbind.querySelector("svg.lucide-unplug")).toBeInTheDocument()
    fireEvent.click(unbind)
    expect(await screen.findByRole("dialog")).toBeVisible()
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(
      false
    )
    fireEvent.click(screen.getAllByRole("button", { name: "解绑" }).at(-1)!)
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([, init]) => init?.method === "DELETE")
      ).toBe(true)
    )
  })
  it("disables unconfigured providers and explains failed authorization without reflecting URL input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          data: {
            items: items.map((item) => ({ ...item, configured: false })),
          },
        })
      )
    )
    mount(
      "/capabilities?section=connector&scope=personal&connection_result=failed&error=private-detail"
    )
    await screen.findByText("member@example.test")
    expect(screen.getByRole("button", { name: "连接" })).toBeDisabled()
    expect(screen.getByText(i18n.t("connections.failure"))).toBeVisible()
    expect(screen.queryByText("private-detail")).not.toBeInTheDocument()
  })
  it.each([true, false])(
    "keeps expired connection actions accessible and respects configured=%s",
    async (configured) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            success: true,
            data: {
              items: [
                { ...items[0], status: "reconnect_required", configured },
              ],
            },
          })
        )
      )
      mount()
      await userEvent.click(
        await screen.findByRole("button", {
          name: i18n.t("common.moreActionsNamed", { name: "OneDrive" }),
        })
      )
      const reconnect = await screen.findByRole("menuitem", {
        name: "重新连接",
      })
      if (configured) {
        expect(reconnect).not.toHaveAttribute("aria-disabled", "true")
      } else {
        expect(reconnect).toHaveAttribute("aria-disabled", "true")
      }
      expect(
        screen.getByRole("menuitem", { name: "解绑" })
      ).not.toHaveAttribute("aria-disabled", "true")
      expect(screen.queryByRole("img", { name: "已连接" })).toBeNull()
      expect(screen.queryByRole("dialog")).toBeNull()
    }
  )
  it.each(supportedLocales)(
    "provides complete messages and renders connections in %s",
    async (locale) => {
      expect(Object.keys(connectionMessages[locale]).sort()).toEqual(
        Object.keys(connectionMessages["zh-CN"]).sort()
      )
      expect(Object.keys(connectionMessages[locale].errors).sort()).toEqual(
        Object.keys(connectionMessages["zh-CN"].errors).sort()
      )
      await i18n.changeLanguage(locale)
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ success: true, data: { items } }))
      )
      mount()
      await screen.findByText("member@example.test")
      const trigger = screen.getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: "OneDrive" }),
      })
      trigger.focus()
      await userEvent.keyboard("{Enter}")
      expect(
        await screen.findByRole("menuitem", {
          name: connectionMessages[locale].reconnect,
        })
      ).toBeVisible()
      expect(
        await screen.findByRole("menuitem", {
          name: connectionMessages[locale].disconnect,
        })
      ).toBeVisible()
      await userEvent.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
      expect(trigger).toHaveFocus()
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(
        i18n.t("connections.disconnectTitle", { provider: "OneDrive" })
      ).not.toContain("{{")
    }
  )
})
