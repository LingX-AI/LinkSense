import { supportedLocales, webSearchSettingsSchema } from "@linksense/shared"
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
import i18n from "@/i18n"
import { WebSearchSettingsForm } from "./web-search-settings-form"
import { webSearchMessages } from "./web-search-messages"

const settings = webSearchSettingsSchema.parse({
  revision: 1,
  enabled: true,
  provider: "deepseek",
  base_url: "https://api.deepseek.com/v1/tools/search",
  api_key_configured: true,
  search_engine_id: null,
  default_max_results: 5,
  timeout_ms: 15_000,
})
const clients: QueryClient[] = []
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
const envelope = (data: unknown) => Response.json({ success: true, data })
function fixture(initial = settings) {
  let saved = initial
  const requests: Array<{
    method: string
    url: string
    body: Record<string, unknown>
  }> = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    if (method === "GET") return envelope(saved)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    requests.push({ method, url: String(url), body })
    if (method === "POST")
      return envelope({
        success: true,
        provider: "deepseek",
        query: "LinkSense",
        results: [],
      })
    const { expected_revision, api_key, ...next } = body
    saved = webSearchSettingsSchema.parse({
      ...next,
      revision: Number(expected_revision) + 1,
      api_key_configured:
        api_key === null ? false : Boolean(api_key) || saved.api_key_configured,
    })
    return envelope({ code: "SYSTEM_SETTINGS_UPDATED", settings: saved })
  })
  vi.stubGlobal("fetch", fetch)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <WebSearchSettingsForm />
    </QueryClientProvider>
  )
  return { fetch, requests }
}

describe("web search settings form", () => {
  it("shows a colored brand logo before every provider and the selected provider", async () => {
    fixture()
    const select = await screen.findByRole("combobox", { name: /搜索服务商/ })
    expect(
      select.querySelector("[data-web-search-provider-logo]")
    ).toHaveAttribute("data-web-search-provider-logo", "deepseek")
    await userEvent.click(select)
    const options = await screen.findAllByRole("option")
    const expected = [
      ["DeepSeek", "deepseek"],
      ["Tavily", "tavily"],
      ["Brave Search", "brave"],
      ["Exa", "exa"],
      ["Google Custom Search", "google"],
      ["SerpAPI", "serpapi"],
      ["SearXNG", "searxng"],
    ] as const
    expect(options).toHaveLength(expected.length)
    for (const [name, provider] of expected) {
      const logo = screen
        .getByRole("option", { name })
        .querySelector("img[data-web-search-provider-logo]")
      expect(logo).toHaveAttribute("data-web-search-provider-logo", provider)
      expect(logo).toHaveAttribute("src", `/provider-logos/${provider}.svg`)
      expect(logo).toHaveAttribute("alt", "")
    }
    await userEvent.click(screen.getByRole("option", { name: "Tavily" }))
    expect(
      select.querySelector("[data-web-search-provider-logo]")
    ).toHaveAttribute("data-web-search-provider-logo", "tavily")
  })
  it("shows a saved key as dark dots without a clear action or resubmitting the key", async () => {
    const { requests } = fixture()
    const input = await screen.findByLabelText("API Key")
    expect(input).toHaveValue("")
    expect(input).toHaveAttribute("type", "password")
    expect(input).toHaveAttribute("placeholder", "••••••••••••")
    expect(input).toHaveClass(
      "placeholder:text-foreground",
      "placeholder:opacity-100"
    )
    expect(
      screen.queryByRole("button", { name: "清除已保存的密钥" })
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("默认返回条数"), {
      target: { value: "3" },
    })
    await userEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.body).toMatchObject({
      expected_revision: 1,
      default_max_results: 3,
    })
    expect(requests[0]?.body).not.toHaveProperty("api_key")
  })
  it("leaves an unconfigured key blank and requires a key before saving", async () => {
    fixture({ ...settings, api_key_configured: false })
    const input = await screen.findByLabelText(/API Key/)
    expect(input).toHaveValue("")
    expect(input).toHaveAttribute("placeholder", "")
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled()
  })
  it("requires a replacement credential when changing the service endpoint", async () => {
    fixture()
    const address = await screen.findByLabelText(/API 地址/)
    fireEvent.change(address, {
      target: { value: "https://other.example.test/search" },
    })
    expect(screen.getByLabelText(/API Key/)).toHaveAttribute("placeholder", "")
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/API Key/), {
      target: { value: "new-synthetic-key" },
    })
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
  })
  it("only shows saved-key dots for the provider that owns the key", async () => {
    fixture()
    const user = userEvent.setup()
    const select = await screen.findByRole("combobox", { name: /搜索服务商/ })
    await user.click(select)
    await user.click(await screen.findByRole("option", { name: "Tavily" }))
    expect(screen.getByLabelText(/API Key/)).toHaveAttribute("placeholder", "")
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    await user.click(select)
    await user.click(await screen.findByRole("option", { name: "DeepSeek" }))
    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "placeholder",
      "••••••••••••"
    )
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
  })
  it("replaces a saved key and restores the dot display after saving", async () => {
    const { requests } = fixture()
    const input = await screen.findByLabelText("API Key")
    fireEvent.change(input, { target: { value: "new-synthetic-key" } })
    await userEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(requests[0]?.body).toMatchObject({ api_key: "new-synthetic-key" })
    )
    await waitFor(() =>
      expect(screen.getByLabelText("API Key")).toHaveValue("")
    )
    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "placeholder",
      "••••••••••••"
    )
  })
  it("tests the current draft without persisting it", async () => {
    const { requests } = fixture()
    await screen.findByLabelText("API Key")
    fireEvent.change(screen.getByLabelText("默认返回条数"), {
      target: { value: "4" },
    })
    await userEvent.click(screen.getByRole("button", { name: "测试连接" }))
    await screen.findByText("测试完成，返回结果数：0。")
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      method: "POST",
      body: {
        settings: { default_max_results: 4 },
        request: { query: "LinkSense" },
      },
    })
  })
  it("keeps the saved key when a replacement draft is cleared", async () => {
    const { requests } = fixture()
    const input = await screen.findByLabelText("API Key")
    fireEvent.change(input, { target: { value: "discarded-synthetic-key" } })
    fireEvent.change(input, { target: { value: "" } })
    expect(input).toHaveAttribute("placeholder", "••••••••••••")
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
    await userEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.body).not.toHaveProperty("api_key")
  })
  it("retains the saved key when disabling web search", async () => {
    const { requests } = fixture()
    await screen.findByLabelText("API Key")
    await userEvent.click(screen.getByRole("switch", { name: "启用联网搜索" }))
    await userEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(requests[0]?.body).toMatchObject({ enabled: false })
    )
    expect(requests[0]?.body).not.toHaveProperty("api_key")
  })
  it("shows a load error and offers retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { success: false, error_code: "WEB_SEARCH_UNAVAILABLE" },
          { status: 503 }
        )
      )
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    clients.push(client)
    render(
      <QueryClientProvider client={client}>
        <WebSearchSettingsForm />
      </QueryClientProvider>
    )
    expect(await screen.findByRole("button", { name: /重试/ })).toBeEnabled()
    expect(screen.getByText("搜索服务暂时不可用，请稍后重试。")).toBeVisible()
  })
  it.each(supportedLocales)(
    "renders complete settings and errors in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      fixture()
      expect(
        await screen.findByRole("heading", {
          name: webSearchMessages[locale].title,
        })
      ).toBeVisible()
      expect(
        screen.getByLabelText(webSearchMessages[locale].apiKey)
      ).toHaveAttribute("placeholder", "••••••••••••")
      const keys = Object.keys(webSearchMessages["zh-CN"])
      expect(Object.keys(webSearchMessages[locale])).toEqual(keys)
      for (const key of keys) {
        const value = i18n.getFixedT(locale)(`webSearch.${key}`, { count: 3 })
        expect(value).not.toBe(`webSearch.${key}`)
        expect(value).not.toContain("{{")
      }
      expect(i18n.getFixedT(locale)("errors.webSearch.notConfigured")).not.toBe(
        "errors.webSearch.notConfigured"
      )
    }
  )
  it("uses the Chinese fallback for missing locale resources", () => {
    expect(i18n.getFixedT("unknown")("webSearch.title")).toBe(
      webSearchMessages["zh-CN"].title
    )
  })
})
