import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  connectionProviderSchema,
  supportedLocales,
  type ConnectionProviderSettings,
} from "@linksense/shared"
import { setAccessToken } from "@/api/session"
import { notify } from "@/components/feedback/notification"
import i18n from "@/i18n"
import { AdminConnectorsPage } from "@/pages/admin-connectors-page"
import { adminConnectionMessages } from "./admin-messages"

const initialItems: ConnectionProviderSettings[] =
  connectionProviderSchema.options.map((provider) => ({
    provider,
    revision: 1,
    client_id: `${provider}-app`,
    secret_configured: true,
    redirect_uri: `https://app.example.test/api/v1/connectors/${provider}/callback`,
    required_scopes: [
      "openid",
      provider === "gmail"
        ? "https://www.googleapis.com/auth/gmail.modify"
        : "Files.ReadWrite",
    ],
    connected_account_count: provider === "onedrive" ? 2 : 0,
  }))
type FetchMock = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>
const response = (data: unknown) => Response.json({ success: true, data })
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminConnectorsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return client
}
beforeEach(async () => {
  setAccessToken("test-only-admin-session")
  await i18n.changeLanguage("zh-CN")
  vi.spyOn(notify, "success").mockReturnValue("test-notification")
  vi.spyOn(notify, "error").mockReturnValue("test-notification")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("connector administration", () => {
  it.each(supportedLocales)(
    "shows all five services and opens a separate configuration form in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const fetch = vi.fn<FetchMock>(async () => response(initialItems))
      vi.stubGlobal("fetch", fetch)
      const interaction = userEvent.setup()
      mount()
      expect(
        await screen.findByRole("heading", {
          name: adminConnectionMessages[locale].title,
          level: 1,
        })
      ).toBeVisible()
      for (const provider of connectionProviderSchema.options) {
        const name = i18n.t(`connections.${provider}`)
        const card = await screen.findByRole("article", { name })
        const label = i18n.t("adminConnections.configureProvider", {
          provider: name,
        })
        await interaction.click(
          within(card).getByRole("button", { name: label })
        )
        const dialog = await screen.findByRole("dialog", { name: label })
        expect(
          within(dialog).getByLabelText(i18n.t("adminConnections.clientId"), {
            exact: false,
          })
        ).toHaveValue(`${provider}-app`)
        const secret = within(dialog).getByLabelText(
          i18n.t("adminConnections.clientSecret"),
          { exact: false }
        )
        expect(secret).toHaveValue("")
        expect(secret).toHaveAttribute("type", "password")
        expect(secret).toHaveAttribute("placeholder", "••••••••")
        expect(
          within(dialog).getByLabelText(i18n.t("adminConnections.redirectUri"))
        ).toHaveValue(
          `https://app.example.test/api/v1/connectors/${provider}/callback`
        )
        expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument()
        await interaction.click(
          within(dialog).getByRole("button", { name: i18n.t("common.cancel") })
        )
        await waitFor(() =>
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
        )
      }
      expect(
        fetch.mock.calls.every(
          ([url]) => !String(url).includes("social-authentication")
        )
      ).toBe(true)
    }
  )

  it("keeps a saved secret when left blank, refreshes the catalog and clears typed secrets on closing", async () => {
    const fetch = vi.fn<FetchMock>(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        response(
          init?.method === "PUT"
            ? initialItems.map((item) =>
                item.provider === "onedrive" ? { ...item, revision: 2 } : item
              )
            : initialItems
        )
    )
    vi.stubGlobal("fetch", fetch)
    const interaction = userEvent.setup()
    const client = mount()
    const invalidate = vi.spyOn(client, "invalidateQueries")
    await interaction.click(
      await screen.findByRole("button", { name: "配置 OneDrive" })
    )
    expect(screen.getByLabelText("应用密钥", { exact: false })).toHaveAttribute(
      "placeholder",
      "••••••••"
    )
    await interaction.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    const save = fetch.mock.calls.find(([, init]) => init?.method === "PUT")
    expect(save?.[0]).toContain("/admin/connection-settings/onedrive")
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({
      expected_revision: 1,
      client_id: "onedrive-app",
      acknowledge_reauthorization: false,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["connections"] })
    await interaction.click(
      screen.getByRole("button", { name: "配置 OneDrive" })
    )
    await interaction.type(
      screen.getByLabelText("应用密钥", { exact: false }),
      "unsaved-private"
    )
    await interaction.click(screen.getByRole("button", { name: "取消" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await interaction.click(
      screen.getByRole("button", { name: "配置 OneDrive" })
    )
    expect(screen.getByLabelText("应用密钥", { exact: false })).toHaveValue("")
  })

  it("requires new app credentials and acknowledgement before changing an app used by existing accounts", async () => {
    const fetch = vi.fn<FetchMock>(async () => response(initialItems))
    vi.stubGlobal("fetch", fetch)
    const interaction = userEvent.setup()
    mount()
    await interaction.click(
      await screen.findByRole("button", { name: "配置 OneDrive" })
    )
    const id = screen.getByLabelText("应用 ID", { exact: false })
    await interaction.clear(id)
    await interaction.type(id, "replacement-app")
    expect(
      screen.getByLabelText("应用密钥", { exact: false })
    ).not.toHaveAttribute("placeholder")
    expect(screen.getByText(/已有授权账号数：2/)).toBeVisible()
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    await interaction.click(screen.getByRole("checkbox"))
    await interaction.click(screen.getByRole("button", { name: "保存" }))
    expect(
      await screen.findByText(adminConnectionMessages["zh-CN"].secretRequired)
    ).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(1)
    await interaction.type(
      screen.getByLabelText("应用密钥", { exact: false }),
      "replacement-private"
    )
    await interaction.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      expected_revision: 1,
      client_id: "replacement-app",
      client_secret: "replacement-private",
      acknowledge_reauthorization: true,
    })
  })

  it("validates first-time credentials before sending a request", async () => {
    const fetch = vi.fn<FetchMock>(async () =>
      response(
        initialItems.map((item) => ({
          ...item,
          client_id: "",
          secret_configured: false,
          revision: 0,
        }))
      )
    )
    vi.stubGlobal("fetch", fetch)
    const interaction = userEvent.setup()
    mount()
    await interaction.click(
      await screen.findByRole("button", { name: "配置 Gmail" })
    )
    expect(
      screen.getByLabelText("应用密钥", { exact: false })
    ).not.toHaveAttribute("placeholder")
    await interaction.click(screen.getByRole("button", { name: "保存" }))
    expect(screen.getByText("请填写应用 ID。")).toBeVisible()
    expect(
      screen.getByText(adminConnectionMessages["zh-CN"].secretRequired)
    ).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("allows acknowledgement when the server reports grants created after the dialog opened", async () => {
    const fetch = vi.fn<FetchMock>(async (_url, init) =>
      init?.method === "PUT"
        ? Response.json(
            {
              success: false,
              error_code: "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION",
              params: { count: 1 },
            },
            { status: 409 }
          )
        : response(initialItems)
    )
    vi.stubGlobal("fetch", fetch)
    const interaction = userEvent.setup()
    mount()
    await interaction.click(
      await screen.findByRole("button", { name: "配置 Gmail" })
    )
    const id = screen.getByLabelText("应用 ID", { exact: false })
    await interaction.clear(id)
    await interaction.type(id, "replacement-app")
    await interaction.type(
      screen.getByLabelText("应用密钥", { exact: false }),
      "replacement-private"
    )
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    await interaction.click(screen.getByRole("button", { name: "保存" }))
    const acknowledge = await screen.findByRole("checkbox")
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    await interaction.click(acknowledge)
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
  })

  it("keeps the draft on save failure and blocks duplicate submits while saving", async () => {
    let finish: ((response: Response) => void) | undefined
    const fetch = vi.fn<FetchMock>(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "PUT"
          ? new Promise<Response>((resolve) => {
              finish = resolve
            })
          : response(initialItems)
    )
    vi.stubGlobal("fetch", fetch)
    const interaction = userEvent.setup()
    mount()
    await interaction.click(
      await screen.findByRole("button", { name: "配置 Gmail" })
    )
    await interaction.type(
      screen.getByLabelText("应用密钥", { exact: false }),
      "rotated-private"
    )
    await interaction.click(screen.getByRole("button", { name: "保存" }))
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    expect(screen.getByLabelText("应用密钥", { exact: false })).toBeDisabled()
    const form = screen.getByRole("button", { name: "保存" }).closest("form")
    if (!form) throw new Error("Expected configuration form")
    fireEvent.submit(form)
    expect(fetch).toHaveBeenCalledTimes(2)
    await act(async () =>
      finish?.(
        Response.json(
          {
            success: false,
            error_code: "CONFLICT",
            message: "private-server-diagnostic",
          },
          { status: 409 }
        )
      )
    )
    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      "private-server-diagnostic"
    )
    expect(screen.getByRole("dialog")).toBeVisible()
    expect(screen.getByLabelText("应用密钥", { exact: false })).toHaveValue(
      "rotated-private"
    )
  })

  it("copies the connector callback and reports clipboard failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(initialItems))
    )
    const interaction = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
    mount()
    await interaction.click(
      await screen.findByRole("button", { name: "配置 Gmail" })
    )
    const copy = screen.getByRole("button", { name: "复制回调地址" })
    expect(copy.textContent).toBe("")
    expect(copy).toHaveAttribute("title", "复制回调地址")
    expect(copy.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    await interaction.click(copy)
    expect(write).toHaveBeenCalledWith(
      "https://app.example.test/api/v1/connectors/gmail/callback"
    )
    write.mockRejectedValueOnce(new Error("clipboard unavailable"))
    await interaction.click(
      screen.getByRole("button", { name: "复制回调地址" })
    )
    expect(notify.error).toHaveBeenCalledWith(
      adminConnectionMessages["zh-CN"].copyFailed
    )
  })

  it("shows loading, empty and recoverable failure states", async () => {
    const fetch = vi.fn<FetchMock>(async () =>
      Response.json(
        { success: false, error_code: "FORBIDDEN" },
        { status: 403 }
      )
    )
    vi.stubGlobal("fetch", fetch)
    const interaction = userEvent.setup()
    mount()
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    await screen.findByRole("button", { name: "重试" })
    fetch.mockResolvedValueOnce(response([]))
    await interaction.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByText("暂无可配置的连接器")).toBeVisible()
  })
})

function entries(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value]]
  if (!value || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, child]) =>
    entries(child, prefix ? `${prefix}.${key}` : key)
  )
}
it.each(supportedLocales)(
  "covers every connector administration translation and interpolation in %s with Chinese fallback",
  (locale) => {
    const chinese = entries(adminConnectionMessages["zh-CN"])
    const localized = entries(adminConnectionMessages[locale])
    expect(localized.map(([key]) => key).sort()).toEqual(
      chinese.map(([key]) => key).sort()
    )
    for (const [key, value] of localized) {
      const original =
        chinese.find(([candidate]) => candidate === key)?.[1] ?? ""
      expect(
        [...value.matchAll(/\{\{[^}]+\}\}/gu)].map(([token]) => token).sort()
      ).toEqual(
        [...original.matchAll(/\{\{[^}]+\}\}/gu)].map(([token]) => token).sort()
      )
      if (locale !== "zh-CN") expect(value).not.toBe(original)
    }
    if (locale !== "zh-CN") {
      const fallback = i18n.cloneInstance({ forkResourceStore: true })
      fallback.removeResourceBundle(locale, "translation")
      expect(fallback.t("adminConnections.title", { lng: locale })).toBe(
        "连接器"
      )
    }
  }
)
