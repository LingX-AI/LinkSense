import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"
import {
  botChannelCreateSchema,
  type BotChannelConnection,
  type BotChannelProvider,
} from "@linksense/shared"
import i18n from "@/i18n"
import { BotChannelCards } from "./bot-channel-cards"

const ID = "10000000-0000-4000-8000-000000000001"
const GUID = "11111111-1111-4111-8111-111111111111"
const clients: QueryClient[] = []
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
function renderCards() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <BotChannelCards />
      </I18nextProvider>
    </QueryClientProvider>
  )
}
function fixture() {
  let items: BotChannelConnection[] = []
  const request = vi.fn<typeof fetch>(async (_url, options) => {
    if (options?.method === "POST") {
      const data = botChannelCreateSchema.parse(
        JSON.parse(String(options.body))
      )
      const row: BotChannelConnection = {
        id: ID,
        provider: data.provider,
        account_hint: data.provider === "wecom" ? data.bot_id : data.client_id,
        allowed_sender_id: data.allowed_sender_id,
        allow_group_messages: data.allow_group_messages,
        runtime_status:
          data.provider === "teams" ? "waiting_message" : "connecting",
        last_connected_at: null,
        last_inbound_at: null,
        last_error_code: null,
        callback_url:
          data.provider === "teams"
            ? `https://example.test/api/v1/bot-channels/teams/${ID}/messages`
            : null,
        created_at: "2026-09-06T00:00:00.000Z",
      }
      items = [row]
      return Response.json({ success: true, data: row }, { status: 201 })
    }
    if (options?.method === "DELETE") {
      items = []
      return new Response(null, { status: 204 })
    }
    return Response.json({ success: true, data: { items } })
  })
  vi.stubGlobal("fetch", request)
  return request
}
describe.each<[BotChannelProvider, string]>([
  ["wecom", "企业微信"],
  ["dingtalk", "钉钉"],
  ["teams", "Microsoft Teams"],
])("%s configuration", (provider, name) => {
  it("creates a validated configuration, shows its state and consumes a successful 204 disconnect", async () => {
    const request = fixture()
    const user = userEvent.setup()
    renderCards()
    const connect = await screen.findByRole("button", { name: `连接${name}` })
    await waitFor(() => expect(connect).toBeEnabled())
    await user.click(connect)
    const dialog = within(await screen.findByRole("dialog"))
    await user.type(
      dialog.getByLabelText(
        provider === "wecom" ? "机器人 ID" : "应用 Client ID"
      ),
      provider === "teams" ? GUID : "app-test"
    )
    await user.type(dialog.getByLabelText("应用密钥"), "test-secret")
    if (provider === "teams")
      await user.type(dialog.getByLabelText("租户 ID"), GUID)
    await user.type(
      dialog.getByLabelText("允许使用的成员 ID"),
      provider === "teams" ? GUID : "member"
    )
    await user.click(dialog.getByRole("checkbox"))
    await user.click(dialog.getByRole("button", { name: "保存配置" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    const post = request.mock.calls.find(
      ([, options]) => options?.method === "POST"
    )
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      provider,
      allowed_sender_id: provider === "teams" ? GUID : "member",
      allow_group_messages: false,
    })
    expect(
      screen.getByText(provider === "teams" ? "等待消息验证" : "连接中")
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "查看配置" }))
    expect(screen.queryByLabelText("应用密钥")).not.toBeInTheDocument()
    if (provider === "teams")
      expect(screen.getByLabelText("消息接收地址")).toHaveValue(
        `https://example.test/api/v1/bot-channels/teams/${ID}/messages`
      )
    await user.click(screen.getByRole("button", { name: "关闭" }))
    await user.click(screen.getByRole("button", { name: `断开${name}` }))
    await user.click(screen.getByRole("button", { name: "确认断开" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(screen.getByRole("button", { name: `连接${name}` })).toBeEnabled()
  })
})
it("shows a request failure and can retry loading the cards", async () => {
  const request = fixture()
  request.mockRejectedValueOnce(new TypeError("offline"))
  const user = userEvent.setup()
  renderCards()
  await user.click(await screen.findByRole("button", { name: "重试" }))
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "连接企业微信" })).toBeEnabled()
  )
})
it("rejects malformed Teams IDs without submitting credentials", async () => {
  const request = fixture()
  const user = userEvent.setup()
  renderCards()
  const connect = await screen.findByRole("button", {
    name: "连接Microsoft Teams",
  })
  await waitFor(() => expect(connect).toBeEnabled())
  await user.click(connect)
  for (const label of [
    "应用 Client ID",
    "应用密钥",
    "租户 ID",
    "允许使用的成员 ID",
  ])
    await user.type(screen.getByLabelText(label), "invalid")
  await user.click(screen.getByRole("button", { name: "保存配置" }))
  expect(screen.getByRole("alert")).toBeInTheDocument()
  expect(
    request.mock.calls.some(([, options]) => options?.method === "POST")
  ).toBe(false)
})
it.each(["zh-CN", "en-US", "fr"])(
  "has localized form text and fallback for %s",
  async (language) => {
    fixture()
    await i18n.changeLanguage(language)
    renderCards()
    const name = language === "en-US" ? "Connect WeCom" : "连接企业微信"
    const connect = await screen.findByRole("button", { name })
    await waitFor(() => expect(connect).toBeEnabled())
    await userEvent.click(connect)
    expect(
      screen.getByRole("button", {
        name: language === "en-US" ? "Save configuration" : "保存配置",
      })
    ).toBeInTheDocument()
  }
)
