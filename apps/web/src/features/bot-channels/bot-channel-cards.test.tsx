import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"
import type {
  BotChannelConnection,
  BotChannelAdminConnection,
} from "@linksense/shared"
import i18n from "@/i18n"
import { BotChannelCards } from "./bot-channel-cards"
import { AdminBotChannels } from "./admin-bot-channels"
const ID = "10000000-0000-4000-8000-000000000001"
const clients: QueryClient[] = []
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
function mount(admin = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        {admin ? <AdminBotChannels /> : <BotChannelCards />}
      </I18nextProvider>
    </QueryClientProvider>
  )
}
function connection(
  provider: BotChannelConnection["provider"],
  linked = false
): BotChannelConnection {
  return {
    id: ID,
    provider,
    scope: provider === "dingtalk" ? "personal" : "organization",
    identity_linked: linked,
    allow_group_messages: true,
    runtime_status: "online",
    last_connected_at: null,
    last_inbound_at: null,
    last_error_code: null,
    created_at: "2026-10-29T00:00:00.000Z",
  }
}
function fixture(
  items: (BotChannelConnection | BotChannelAdminConnection)[] = []
) {
  const request = vi.fn<typeof fetch>(async (url, options) => {
    const path = String(url)
    if (path.endsWith("linking-sessions"))
      return Response.json(
        {
          success: true,
          data: {
            command: `LINK ${"AB".repeat(12)}`,
            expires_at: "2026-10-29T00:10:00.000Z",
          },
        },
        { status: 201 }
      )
    if (path.endsWith("registration-sessions"))
      return Response.json(
        {
          success: true,
          data: {
            id: ID,
            status: "waiting_scan",
            qr_code_url: "https://www.dingtalk.com/auth?code=qr",
            expires_at: "2026-10-29T00:10:00.000Z",
            connection_id: null,
          },
        },
        { status: 201 }
      )
    if (path.includes("registration-sessions/"))
      return Response.json({
        success: true,
        data: {
          id: ID,
          status: "waiting_scan",
          qr_code_url: "https://www.dingtalk.com/auth?code=qr",
          expires_at: "2026-10-29T00:10:00.000Z",
          connection_id: null,
        },
      })
    if (options?.method === "DELETE") {
      items.splice(0)
      return new Response(null, { status: 204 })
    }
    if (path.endsWith("organization") && options?.method === "POST")
      return Response.json(
        {
          success: true,
          data: {
            ...connection("wecom"),
            account_hint: "bot",
            callback_url: null,
          },
        },
        { status: 201 }
      )
    return Response.json({ success: true, data: { items } })
  })
  vi.stubGlobal("fetch", request)
  return request
}
describe("personal channel access", () => {
  it("offers DingTalk QR setup and directs organization channels to administrator setup", async () => {
    fixture()
    mount()
    const user = userEvent.setup()
    const wecom = (
      await screen.findByRole("heading", { name: "企业微信" })
    ).closest("article")!
    expect(
      within(wecom).getByRole("button", { name: "关联我的账号" })
    ).toBeDisabled()
    expect(within(wecom).getByText("等待管理员配置")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "扫码连接" }))
    expect(screen.queryByLabelText("应用密钥")).not.toBeInTheDocument()
    expect(
      await screen.findByRole("img", { name: "钉钉连接二维码" })
    ).toBeVisible()
  })
  it("links the signed-in account through a private confirmation message without any member ID input", async () => {
    const request = fixture([connection("wecom")])
    mount()
    const user = userEvent.setup()
    const card = (
      await screen.findByRole("heading", { name: "企业微信" })
    ).closest("article")!
    await user.click(within(card).getByRole("button", { name: "关联我的账号" }))
    await user.click(screen.getByRole("button", { name: "获取确认消息" }))
    expect(await screen.findByLabelText("确认消息")).toHaveValue(
      `LINK ${"AB".repeat(12)}`
    )
    expect(screen.getByLabelText("确认消息")).toHaveAttribute("readonly")
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(`/${ID}/linking-sessions`),
      expect.objectContaining({ method: "POST" })
    )
    expect(screen.queryByLabelText(/成员 ID/u)).not.toBeInTheDocument()
  })
  it("keeps the confirmation message usable when HTTP does not provide clipboard access", async () => {
    fixture([connection("wecom")])
    mount()
    const user = userEvent.setup()
    const card = (
      await screen.findByRole("heading", { name: "企业微信" })
    ).closest("article")!
    await user.click(within(card).getByRole("button", { name: "关联我的账号" }))
    await user.click(screen.getByRole("button", { name: "获取确认消息" }))
    const message = await screen.findByLabelText("确认消息")
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    try {
      await user.click(screen.getByRole("button", { name: "复制确认消息" }))
      expect(await screen.findByRole("alert")).toBeVisible()
      expect(message).toHaveValue(`LINK ${"AB".repeat(12)}`)
      expect(screen.getByRole("dialog")).toBeVisible()
    } finally {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard)
      else Reflect.deleteProperty(navigator, "clipboard")
    }
  })
  it.each([
    { outcome: "successful copying", denied: false },
    { outcome: "denied clipboard access", denied: true },
  ])(
    "reports $outcome without losing the confirmation message",
    async ({ denied }) => {
      fixture([connection("wecom")])
      mount()
      const user = userEvent.setup()
      const card = (
        await screen.findByRole("heading", { name: "企业微信" })
      ).closest("article")!
      await user.click(
        within(card).getByRole("button", { name: "关联我的账号" })
      )
      await user.click(screen.getByRole("button", { name: "获取确认消息" }))
      const message = await screen.findByLabelText("确认消息")
      const writeText = vi.spyOn(navigator.clipboard, "writeText")
      if (denied) writeText.mockRejectedValue(new Error("Clipboard denied"))
      else writeText.mockResolvedValue(undefined)
      try {
        await user.click(screen.getByRole("button", { name: "复制确认消息" }))
        if (denied) expect(await screen.findByRole("alert")).toBeVisible()
        else
          expect(
            await screen.findByRole("button", { name: "已复制" })
          ).toBeVisible()
        expect(writeText).toHaveBeenCalledExactlyOnceWith(
          `LINK ${"AB".repeat(12)}`
        )
        expect(message).toHaveValue(`LINK ${"AB".repeat(12)}`)
      } finally {
        writeText.mockRestore()
      }
    }
  )
  it("allows users to unlink a paused organization channel without deleting its configuration", async () => {
    const row = connection("teams", true)
    row.runtime_status = "disabled"
    const request = fixture([row])
    mount()
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole("button", { name: "解除账号关联" })
    )
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "确认" })
    )
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(`/${ID}/identity`),
      expect.objectContaining({ method: "DELETE" })
    )
  })
  it("shows registration failure and permits retry without exposing credentials", async () => {
    const request = fixture()
    mount()
    const user = userEvent.setup()
    const connect = await screen.findByRole("button", { name: "扫码连接" })
    request.mockImplementationOnce(async () =>
      Response.json(
        { success: false, error_code: "BOT_CHANNEL_CONNECTION_FAILED" },
        { status: 502 }
      )
    )
    await user.click(connect)
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(screen.getByRole("button", { name: "重新生成" })).toBeEnabled()
  })
})
it("keeps organization credentials in the admin form and submits no member allowlist", async () => {
  const request = fixture()
  mount(true)
  const user = userEvent.setup()
  await user.click(await screen.findByRole("button", { name: "连接企业微信" }))
  await user.type(screen.getByLabelText(/机器人 ID/u), "bot")
  await user.type(screen.getByLabelText(/应用密钥/u), "test-secret")
  expect(screen.queryByLabelText(/允许使用的成员/u)).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "保存配置" }))
  const call = request.mock.calls.find(
    ([url, options]) =>
      String(url).endsWith("organization") && options?.method === "POST"
  )
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({
    provider: "wecom",
    bot_id: "bot",
    secret: "test-secret",
    allow_group_messages: true,
  })
})
it("places unconfigured organization actions beside the channel heading without an empty details card", async () => {
  fixture()
  mount(true)
  for (const name of ["企业微信", "Microsoft Teams"]) {
    const heading = await screen.findByRole("heading", { name })
    const header = heading.closest<HTMLElement>(
      '[data-slot="settings-section-header"]'
    )
    expect(header).not.toBeNull()
    expect(
      within(header!).getByRole("button", { name: `连接${name}` })
    ).toBeVisible()
    expect(
      heading
        .closest('[data-slot="settings-card"]')
        ?.querySelector('[data-slot="card"]')
    ).toBeNull()
  }
})
it.each([
  { provider: "wecom", status: "online", action: "暂停", name: "企业微信" },
  {
    provider: "teams",
    status: "online",
    action: "暂停",
    name: "Microsoft Teams",
  },
  {
    provider: "teams",
    status: "disabled",
    action: "启用",
    name: "Microsoft Teams",
  },
] as const)(
  "places $provider $status controls at the bottom right inside the details card",
  async ({ provider, status, action, name }) => {
    fixture([
      {
        ...connection(provider),
        runtime_status: status,
        account_hint: "client",
        callback_url:
          provider === "teams" ? "https://example.test/callback" : null,
      },
    ])
    mount(true)
    const control = await screen.findByRole("button", { name: action })
    const heading = await screen.findByRole("heading", {
      name,
    })
    const header = heading.closest<HTMLElement>(
      '[data-slot="settings-section-header"]'
    )!
    expect(
      within(header).queryByRole("button", { name: action })
    ).not.toBeInTheDocument()
    const card = control.closest<HTMLElement>('[data-slot="card"]')
    expect(card).not.toBeNull()
    expect(
      within(card!).getByRole("button", { name: `断开${name}` })
    ).toBeVisible()
    const actions = control.parentElement!
    expect(actions).toHaveClass("flex-wrap", "justify-end")
    expect(
      card!.querySelector('[data-slot="card-content"]')?.lastElementChild
    ).toBe(actions)
    expect(screen.getByLabelText("应用或机器人账号")).toHaveValue("client")
    if (provider === "teams")
      expect(screen.getByLabelText("消息接收地址")).toHaveValue(
        "https://example.test/callback"
      )
  }
)
it.each(["zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"])(
  "provides channel setup and identity copy in %s without fallback",
  (locale) => {
    for (const key of [
      "adminTitle",
      "organizationHelp",
      "personalHelp",
      "scanConnect",
      "linkTitle",
      "linkHelp",
      "linkExpiry",
      "registrationStatus.connected",
      "status.disabled",
    ]) {
      expect(
        i18n.exists(`botChannels.${key}`, { lng: locale, fallbackLng: false })
      ).toBe(true)
    }
  }
)
