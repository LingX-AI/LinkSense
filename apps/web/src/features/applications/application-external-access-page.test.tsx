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
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"

import { setAccessToken } from "@/api/session"
import { ThemeProvider } from "@/app/theme-context"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import { notify } from "@/components/feedback/notification"
import i18n from "@/i18n"
import { ApplicationCatalogPanel } from "@/features/applications/application-catalog-panel"
import { ApplicationExternalAccessPage } from "@/features/applications/application-external-access-page"

vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))

const APPLICATION_ID = "50000000-0000-4000-8000-000000000041"
const PUBLISHER_ID = "10000000-0000-4000-8000-000000000041"
const NOW = "2026-08-13T00:00:00.000Z"
const ALLOWED_ORIGIN = "https://www.aisgz.org"
const SECOND_ALLOWED_ORIGIN = "https://portal.aisgz.org"
const APP_ID = "lsa_plHALqcjRTvSRjPZMZ7ylT62"
const APP_SECRET = "lss_test_application_secret_with_sufficient_entropy"

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function applicationFixture() {
  return {
    id: APPLICATION_ID,
    owner: { id: PUBLISHER_ID, name: "我" },
    name: "AISG学校政策问答助手",
    icon: { type: "preset", preset: "graduation-cap" },
    description: "回答AISG学校政策相关的问题",
    instructions: "仅根据应用配置回答。",
    model: null,
    reasoning_effort: null,
    status: "active",
    is_owner: true,
    can_manage: true,
    access_source: "owner",
    capability_count: 0,
    mcp_server_count: 0,
    knowledge_base_count: 1,
    share_targets: [],
    dependencies_available: true,
    capabilities: [],
    mcp_servers: [],
    knowledge_bases: [],
    created_at: NOW,
    updated_at: NOW,
  }
}

function externalAccessFixture() {
  return {
    application_id: APPLICATION_ID,
    enabled: true,
    auth_mode: "required",
    app_id: APP_ID,
    app_secret: APP_SECRET,
    allowed_origins: [ALLOWED_ORIGIN, SECOND_ALLOWED_ORIGIN],
    starter_questions_by_origin: [
      {
        origin: ALLOWED_ORIGIN,
        questions: ["学费包含哪些项目？", "如何申请奖学金？"],
      },
    ],
    iframe_url:
      "http://localhost:5173/api/v1/embed/frame/lsa_plHALqcjRTvSRjPZMZ7ylT62",
    access_token_ttl_seconds: 7_200,
    renewal_token_ttl_seconds: 28_800,
    absolute_session_ttl_seconds: 604_800,
    created_at: NOW,
    updated_at: NOW,
  }
}

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {JSON.stringify({ pathname: location.pathname, search: location.search })}
    </output>
  )
}

function renderExternalAccessPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <MemoryRouter
        initialEntries={[
          `/capabilities/applications/${APPLICATION_ID}/external-access`,
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/capabilities/applications/:applicationId/external-access"
              element={<ApplicationExternalAccessPage />}
            />
            <Route path="/capabilities" element={<LocationProbe />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
      <NotificationCenter />
    </ThemeProvider>
  )
}

function renderCatalogPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/capabilities"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/capabilities"
              element={
                <ApplicationCatalogPanel
                  scope="owned"
                  search=""
                  onFeedback={vi.fn()}
                />
              }
            />
            <Route
              path="/capabilities/applications/:applicationId/external-access"
              element={<LocationProbe />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe("application external access page", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("application-external-access-test-token")
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("opens external access from the application menu as a page", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (url.pathname === "/api/v1/applications/catalog" && method === "GET") {
        return Promise.resolve(
          envelope({
            items: [
              {
                type: "application",
                application: applicationFixture(),
                development: null,
              },
            ],
            next_cursor: null,
          })
        )
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderCatalogPanel()

    const title = await screen.findByRole("heading", {
      name: "AISG学校政策问答助手",
    })
    const card = title.closest('[data-slot="card"]')
    if (!(card instanceof HTMLElement)) {
      throw new Error("Expected application card")
    }
    await interaction.click(
      within(card).getByRole("button", {
        name: "AISG学校政策问答助手的更多操作",
      })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "外部访问" })
    )

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/capabilities/applications/${APPLICATION_ID}/external-access`
      )
    )
    expect(
      screen.queryByRole("dialog", { name: "应用外部访问" })
    ).not.toBeInTheDocument()
  })

  it("renders the configuration as a page with simplified authentication copy", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (
        url.pathname === `/api/v1/applications/${APPLICATION_ID}` &&
        method === "GET"
      ) {
        return Promise.resolve(envelope(applicationFixture()))
      }
      if (
        url.pathname ===
          `/api/v1/applications/${APPLICATION_ID}/external-access` &&
        method === "GET"
      ) {
        return Promise.resolve(envelope(externalAccessFixture()))
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined)
    const interaction = userEvent.setup()
    const view = renderExternalAccessPage()

    expect(
      await screen.findByRole("heading", { name: "应用外部访问" })
    ).toBeVisible()
    expect(
      screen.queryByRole("dialog", { name: "应用外部访问" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("认证方式")).not.toBeInTheDocument()
    const requireAuthButton = await screen.findByRole("button", {
      name: "需要认证",
    })
    expect(requireAuthButton).toBeVisible()
    expect(screen.queryByText("应用凭据")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "不需要认证" })).toBeVisible()
    expect(
      requireAuthButton.closest('[data-slot="toggle-group"]')
    ).toHaveAttribute("data-spacing", "0")
    expect(screen.queryByText(/访问令牌 2 小时/u)).not.toBeInTheDocument()
    expect(screen.queryByText(/轮换续期令牌 8 小时/u)).not.toBeInTheDocument()
    expect(screen.queryByText(/外部会话绝对时长 7 天/u)).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "把“AISG学校政策问答助手”嵌入到指定网站，让外部用户只使用这个应用。"
      )
    ).toBeVisible()
    expect(
      screen.queryByText(/60 秒、仅可使用一次的 ticket/u)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/来源校验、限流/u)).not.toBeInTheDocument()

    const accessSection = screen.getByRole("region", { name: "访问设置" })
    const originSection = screen.getByRole("region", { name: "来源设置" })
    const credentialSection = screen.getByRole("region", {
      name: "服务端认证",
    })
    const embedSection = await screen.findByRole("region", {
      name: "嵌入配置",
    })
    for (const section of [
      accessSection,
      originSection,
      credentialSection,
      embedSection,
    ]) {
      const card = section.querySelector('[data-slot="card"]')
      expect(card).toBeInTheDocument()
      expect(card).toHaveClass("border-[color:var(--app-border)]")
    }
    expect(
      within(accessSection).getByRole("switch", { name: "启用外部访问" })
    ).toBeVisible()
    expect(
      within(accessSection).getByText(/外部页面将无法继续使用/u)
    ).toBeVisible()
    expect(
      within(accessSection).getByText(/对方系统需要先在服务端完成校验/u)
    ).toBeVisible()
    expect(
      within(originSection).getByRole("textbox", {
        name: "允许嵌入的来源",
      })
    ).toBeVisible()
    expect(
      within(originSection).getByText(/填写允许嵌入此应用的网站地址/u)
    ).toBeVisible()
    expect(screen.getByText("App ID").closest('[data-slot="card"]')).toBe(
      credentialSection.querySelector('[data-slot="card"]')
    )
    expect(view.container.querySelector(".font-mono")).not.toBeInTheDocument()
    const appIdField = screen.getByText("App ID").closest('[data-slot="field"]')
    if (!(appIdField instanceof HTMLElement)) {
      throw new Error("Expected App ID field")
    }
    expect(
      appIdField.querySelector('[data-slot="input-group"]')
    ).not.toBeInTheDocument()
    const appIdValue = within(appIdField).getByText(APP_ID)
    expect(appIdValue).toHaveAttribute("data-slot", "external-readonly-value")
    const appIdCopyButton = within(appIdField).getByRole("button", {
      name: "复制App ID",
    })
    expect(appIdCopyButton).toHaveClass("size-7")
    expect(appIdCopyButton.previousElementSibling).toBe(appIdValue)
    expect(screen.getByText("lss_test************ntropy")).toBeVisible()
    expect(screen.queryByText(APP_SECRET)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "轮换 App Secret" })
    ).not.toBeInTheDocument()
    const appSecretField = screen
      .getByText("App Secret")
      .closest('[data-slot="field"]')
    if (!(appSecretField instanceof HTMLElement)) {
      throw new Error("Expected App Secret field")
    }
    expect(
      appSecretField.querySelector('[data-slot="input-group"]')
    ).not.toBeInTheDocument()
    const appSecretValue = within(appSecretField).getByText(
      "lss_test************ntropy"
    )
    expect(appSecretValue).toHaveAttribute(
      "data-slot",
      "external-readonly-value"
    )
    const appSecretButtons = within(appSecretField).getAllByRole("button")
    expect(appSecretButtons[0]).toHaveAccessibleName("复制App Secret")
    expect(appSecretButtons[0]).toHaveClass("size-7")
    expect(appSecretButtons[0].previousElementSibling).toBe(appSecretValue)
    expect(appSecretButtons[1]).toHaveTextContent("重新生成")
    expect(appSecretButtons[1]).toHaveClass("bg-secondary")
    expect(appSecretButtons[1].querySelector("svg")).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "复制App Secret" })
    )
    expect(writeText).toHaveBeenCalledWith(APP_SECRET)
    const originsTabList = screen.getByRole("tablist", { name: "嵌入来源" })
    const firstOriginTab = within(originsTabList).getByRole("tab", {
      name: "来源 1",
    })
    const secondOriginTab = within(originsTabList).getByRole("tab", {
      name: "来源 2",
    })
    expect(firstOriginTab).toHaveAttribute("aria-selected", "true")
    expect(secondOriginTab).toHaveAttribute("aria-selected", "false")
    expect(screen.getByText("当前来源")).toBeVisible()
    expect(within(embedSection).getByText(ALLOWED_ORIGIN)).toBeVisible()
    expect(
      within(embedSection).queryByText(SECOND_ALLOWED_ORIGIN)
    ).not.toBeInTheDocument()
    const iframeUrlField = within(embedSection)
      .getByText("iframe 地址")
      .closest('[data-slot="field"]')
    if (!(iframeUrlField instanceof HTMLElement)) {
      throw new Error("Expected iframe URL field")
    }
    expect(
      iframeUrlField.querySelector('[data-slot="input-group"]')
    ).not.toBeInTheDocument()
    const iframeValue = iframeUrlField.querySelector(
      '[data-slot="external-readonly-value"]'
    )
    expect(iframeValue).toBeInTheDocument()
    const iframeCopyButton = within(iframeUrlField).getByRole("button", {
      name: "复制iframe 地址",
    })
    expect(iframeCopyButton).toHaveClass("size-7")
    expect(iframeCopyButton.previousElementSibling).toBe(iframeValue)
    const codeBlocks = view.container.querySelectorAll(
      '[data-slot="external-code-block"]'
    )
    expect(codeBlocks).toHaveLength(1)
    expect(codeBlocks[0]).toHaveTextContent(encodeURIComponent(ALLOWED_ORIGIN))
    expect(
      within(codeBlocks[0] as HTMLElement).getByRole("button", {
        name: "复制",
      })
    ).toBeVisible()
    expect(
      view.container.querySelector("[data-code-token='tag']")
    ).toBeInTheDocument()
    expect(
      view.container.querySelector("[data-code-token='string']")
    ).toBeInTheDocument()
    expect(
      view.container.querySelector("[data-code-token='comment']")
    ).toBeInTheDocument()
    await interaction.click(secondOriginTab)
    expect(secondOriginTab).toHaveAttribute("aria-selected", "true")
    expect(within(embedSection).getByText(SECOND_ALLOWED_ORIGIN)).toBeVisible()
    expect(
      within(embedSection).queryByText(ALLOWED_ORIGIN)
    ).not.toBeInTheDocument()
    const switchedCodeBlock = view.container.querySelector(
      '[data-slot="external-code-block"]'
    )
    expect(switchedCodeBlock).toHaveTextContent(
      encodeURIComponent(SECOND_ALLOWED_ORIGIN)
    )
    await interaction.click(screen.getByRole("button", { name: "不需要认证" }))
    expect(
      screen.getByText(/允许网站中的页面打开后即可使用应用/u)
    ).toBeVisible()
    expect(
      screen.queryByRole("region", { name: "服务端认证" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("App ID")).not.toBeInTheDocument()
    expect(screen.queryByText("App Secret")).not.toBeInTheDocument()
    expect(screen.getAllByText(/<iframe/u)).toHaveLength(1)
    expect(
      screen.queryByText(/your-backend\/linksense-ticket/u)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/linksense:ticket/u)).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), window.location.origin)
        return url.pathname.includes("credential-bindings")
      })
    ).toBe(false)

    const backLink = screen.getByRole("link", { name: "返回应用" })
    expect(backLink).toHaveAttribute(
      "href",
      "/capabilities?section=application&scope=personal"
    )
    await interaction.click(backLink)
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        '"pathname":"/capabilities"'
      )
      expect(screen.getByTestId("location")).toHaveTextContent(
        '"search":"?section=application&scope=personal"'
      )
    })
  })

  it("configures up to four independent built-in questions for each origin", async () => {
    let savedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (
        url.pathname === `/api/v1/applications/${APPLICATION_ID}` &&
        method === "GET"
      ) {
        return Promise.resolve(envelope(applicationFixture()))
      }
      if (
        url.pathname ===
          `/api/v1/applications/${APPLICATION_ID}/external-access` &&
        method === "GET"
      ) {
        return Promise.resolve(envelope(externalAccessFixture()))
      }
      if (
        url.pathname ===
          `/api/v1/applications/${APPLICATION_ID}/external-access` &&
        method === "PUT"
      ) {
        savedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Promise.resolve(
          envelope({
            access: { ...externalAccessFixture(), ...savedBody },
            app_secret: null,
          })
        )
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderExternalAccessPage()

    const section = await screen.findByRole("region", { name: "内置问题" })
    const tabs = await within(section).findByRole("tablist", {
      name: "内置问题来源",
    })
    expect(
      within(section).getByDisplayValue("学费包含哪些项目？")
    ).toBeVisible()
    await interaction.click(within(tabs).getByRole("tab", { name: "来源 2" }))

    const questions = [
      "How do I apply?",
      "What documents are required?",
      "When is the deadline?",
      "Can I request financial aid?",
    ]
    for (const [index, question] of questions.entries()) {
      await interaction.click(
        within(section).getByRole("button", { name: "添加问题" })
      )
      await interaction.type(
        within(section).getByRole("textbox", {
          name: `问题 ${index + 1}`,
        }),
        question
      )
    }
    expect(
      within(section).getByRole("button", { name: "添加问题" })
    ).toBeDisabled()

    await interaction.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(savedBody).not.toBeNull())
    expect(savedBody).toMatchObject({
      starter_questions_by_origin: [
        {
          origin: ALLOWED_ORIGIN,
          questions: ["学费包含哪些项目？", "如何申请奖学金？"],
        },
        { origin: SECOND_ALLOWED_ORIGIN, questions },
      ],
    })
    expect(
      screen.queryByRole("dialog", { name: "保存外部访问安全配置？" })
    ).not.toBeInTheDocument()
  })
})
