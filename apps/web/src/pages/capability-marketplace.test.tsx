import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom"
import { APPLICATION_ICON_MAX_BYTES } from "@linksense/shared"

import { setAccessToken } from "@/api/session"
import { userSchema } from "@/api/contracts"
import { AuthContext } from "@/app/auth-state"
import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import i18n from "@/i18n"
import { ApplicationOpeningPage } from "@/features/applications/application-opening-page"
import {
  AdminCapabilityManagementPage,
  CapabilityManagementPage,
} from "@/pages/capability-pages"

const PUBLISHER_ID = "10000000-0000-4000-8000-000000000001"
const REVIEWER_ID = "10000000-0000-4000-8000-000000000002"
const CAPABILITY_ID = "20000000-0000-4000-8000-000000000001"
const LISTING_ID = "30000000-0000-4000-8000-000000000001"
const RELEASE_ID = "40000000-0000-4000-8000-000000000001"
const NOW = "2026-07-25T08:00:00.000Z"
const APPLICATION_CREATION_TEST_TIMEOUT = process.env.CI ? 30_000 : 10_000

function testUser(
  registrationSource: "self_registration" | "organization_invitation"
) {
  return userSchema.parse({
    id: PUBLISHER_ID,
    name: "发布者",
    email: "publisher@example.test",
    role: "user",
    status: "active",
    registration_source: registrationSource,
  })
}

function TestAuthProvider({
  children,
  registrationSource = "organization_invitation",
}: {
  children: ReactNode
  registrationSource?: "self_registration" | "organization_invitation"
}) {
  return (
    <AuthContext.Provider
      value={{
        status: "authenticated",
        user: testUser(registrationSource),
        acceptSession: async () => undefined,
        refreshUser: async () => undefined,
        signOut: async () => undefined,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

const riskSummary = {
  contains_mcp_server: false,
  contains_scripts: false,
  contains_external_connections: false,
  requires_environment_variables: false,
  requires_credentials: false,
  contains_dependency_download_commands: false,
  declared_environment_keys: [],
  dependency_commands: [],
}

const retiredScanRiskSummary = {
  ...riskSummary,
  supply_chain_review: { verdict: "blocked", scanner_version: "obsolete" },
}

const listing = {
  id: LISTING_ID,
  publisher_id: PUBLISHER_ID,
  publisher_name: "发布者",
  type: "skill" as const,
  slug: "presentation-builder",
  status: "published" as const,
  current_release_id: RELEASE_ID,
  suspended_by: null,
  suspended_at: null,
  suspension_reason: null,
  created_at: NOW,
  updated_at: NOW,
}

const release = {
  id: RELEASE_ID,
  listing_id: LISTING_ID,
  source_capability_id: CAPABILITY_ID,
  release_number: 1,
  status: "approved" as const,
  name: "演示文稿生成器",
  description: "生成结构清晰的演示文稿",
  release_notes: "首次发布",
  logo_url: null,
  content_sha256: "a".repeat(64),
  manifest: {
    name: "presentation-builder",
    description: "Presentation workflow",
  },
  risk_summary: riskSummary,
  submitted_by: PUBLISHER_ID,
  reviewer_id: REVIEWER_ID,
  review_comment: null,
  submitted_at: NOW,
  reviewed_at: NOW,
  published_at: NOW,
  created_at: NOW,
  updated_at: NOW,
}

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const applicationRelease = {
  id: RELEASE_ID,
  application_id: CAPABILITY_ID,
  version_id: LISTING_ID,
  version_number: "1.0.0",
  name: "研究简报应用",
  kind: "standard",
  description: "生成研究简报",
  usage_instructions: "填写研究主题",
  publisher_name: "发布者",
  usage_modes: ["install", "service"],
  release_notes: "首次发布",
  status: "pending",
  listing_status: "draft",
  review_comment: null,
  suspension_reason: null,
  submitted_at: NOW,
  reviewed_at: null,
  installed_application_id: null,
}
const publishableApplication = {
  id: CAPABILITY_ID,
  owner: { id: PUBLISHER_ID, name: "发布者" },
  icon: { type: "preset", preset: "book-open" },
  name: applicationRelease.name,
  description: applicationRelease.description,
  instructions: "研究主题",
  model: null,
  reasoning_effort: null,
  status: "active",
  is_owner: true,
  can_manage: true,
  access_source: "owner",
  capability_count: 0,
  mcp_server_count: 0,
  knowledge_base_count: 0,
  dependencies_available: true,
  capabilities: [],
  mcp_servers: [],
  knowledge_bases: [],
  created_at: NOW,
  updated_at: NOW,
}

class ControllableUploadRequest {
  static latest: ControllableUploadRequest | null = null

  responseType: XMLHttpRequestResponseType = ""
  response: unknown = null
  status = 0
  withCredentials = false
  readonly headers = new Map<string, string>()
  body: Document | XMLHttpRequestBodyInit | null = null

  private readonly listeners = new Map<string, Array<(event: Event) => void>>()
  private readonly uploadProgressListeners: Array<
    (event: ProgressEvent) => void
  > = []

  readonly upload = {
    addEventListener: (
      type: string,
      listener: (event: ProgressEvent) => void
    ) => {
      if (type === "progress") this.uploadProgressListeners.push(listener)
    },
  }

  constructor() {
    ControllableUploadRequest.latest = this
  }

  open() {}

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value)
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body
  }

  abort() {
    this.emit("abort")
  }

  emitUploadProgress(loaded: number, total: number) {
    const event = {
      lengthComputable: true,
      loaded,
      total,
    } as ProgressEvent
    for (const listener of this.uploadProgressListeners) listener(event)
  }

  resolve(response: unknown, status = 200) {
    this.response = response
    this.status = status
    this.emit("load")
  }

  private emit(type: string) {
    const event = new Event(type)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function SettingsDestinationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output hidden data-testid="settings-location">
        {JSON.stringify({
          pathname: location.pathname,
          search: location.search,
          state: location.state,
        })}
      </output>
      <button type="button" onClick={() => navigate(-1)}>
        测试返回
      </button>
    </>
  )
}

function CapabilityLocationProbe() {
  const location = useLocation()
  return (
    <output hidden data-testid="capability-location">
      {`${location.pathname}${location.search}`}
    </output>
  )
}

function renderUserPageWithRouter(
  initialEntry: string,
  registrationSource:
    "self_registration" | "organization_invitation" = "organization_invitation"
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(
    [
      {
        path: "/capabilities",
        element: (
          <>
            <CapabilityManagementPage />
            <CapabilityLocationProbe />
          </>
        ),
      },
      {
        path: "/applications/open/:openingId",
        element: <ApplicationOpeningPage />,
      },
      {
        path: "/conversations/:conversationId",
        element: <CapabilityLocationProbe />,
      },
    ],
    { initialEntries: [initialEntry] }
  )
  return {
    router,
    ...render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TestAuthProvider registrationSource={registrationSource}>
            <RouterProvider router={router} />
          </TestAuthProvider>
        </QueryClientProvider>
        <NotificationCenter />
      </ThemeProvider>
    ),
  }
}

function renderUserPage(
  registrationSource:
    "self_registration" | "organization_invitation" = "organization_invitation"
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/capabilities?section=plugin"]}>
        <QueryClientProvider client={queryClient}>
          <TestAuthProvider registrationSource={registrationSource}>
            <CapabilityManagementPage />
          </TestAuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
      <NotificationCenter />
    </ThemeProvider>
  )
}

function renderUserPageWithSettingsDestination() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/capabilities?section=plugin"]}>
        <QueryClientProvider client={queryClient}>
          <TestAuthProvider>
            <Routes>
              <Route
                path="/capabilities"
                element={<CapabilityManagementPage />}
              />
              <Route
                path="/settings/mcp"
                element={<SettingsDestinationProbe />}
              />
            </Routes>
          </TestAuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
      <NotificationCenter />
    </ThemeProvider>
  )
}

function renderAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/admin/capabilities"]}>
        <QueryClientProvider client={queryClient}>
          <AdminCapabilityManagementPage />
        </QueryClientProvider>
      </MemoryRouter>
      <NotificationCenter />
    </ThemeProvider>
  )
}

describe("capability marketplace pages", () => {
  it.each([
    ["plugin", "personal", "search"],
    ["skill", "public", "search"],
    ["skill", "clawhub", "search"],
    ["mcp", "personal", "search"],
    ["application", "personal", "app_search"],
  ])(
    "keeps Chinese composition local in the %s/%s catalog",
    async (section, scope, parameter) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(envelope({ items: [], next_cursor: null })))
      )
      const { router } = renderUserPageWithRouter(
        `/capabilities?section=${section}&scope=${scope}`
      )
      const input = await screen.findByRole(
        section === "application" ? "textbox" : "searchbox"
      )
      const previousSearch = router.state.location.search
      fireEvent.compositionStart(input)
      fireEvent.input(input, { target: { value: "zhi" }, isComposing: true })
      expect(input).toHaveValue("zhi")
      await act(async () => {})
      expect(router.state.location.search).toBe(previousSearch)
      fireEvent.input(input, { target: { value: "知识" }, isComposing: true })
      fireEvent.compositionEnd(input, { data: "知识" })
      await waitFor(() =>
        expect(
          new URLSearchParams(router.state.location.search).get(parameter)
        ).toBe("知识")
      )
      expect(input).toHaveValue("知识")
      await userEvent.type(input, " report")
      expect(input).toHaveValue("知识 report")
      await userEvent.click(screen.getByRole("button", { name: "清除" }))
      expect(input).toHaveFocus()
      await waitFor(() =>
        expect(
          new URLSearchParams(router.state.location.search).has(parameter)
        ).toBe(false)
      )
    }
  )

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("marketplace-test-token")
    ControllableUploadRequest.latest = null
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each(["zh-CN", "en-US"])(
    "shows a unified publications page and returns to the previous category in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        const items =
          path === "/api/v1/application-center/mine"
            ? [applicationRelease]
            : path === "/api/v1/marketplace/mine"
              ? [
                  {
                    listing,
                    latest_release: release,
                    current_release: release,
                    install_count: 3,
                  },
                ]
              : []
        return Promise.resolve(envelope({ items, next_cursor: null }))
      })
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      renderUserPageWithRouter("/capabilities?section=skill")
      await interaction.click(
        screen.getByRole("button", {
          name: i18n.t("marketplace.tabs.publishing"),
        })
      )
      expect(
        screen.getByRole("heading", {
          name: i18n.t("marketplace.tabs.publishing"),
          level: 1,
        })
      ).toBeVisible()
      expect(
        screen.getByText(i18n.t("marketplace.publicationsDescription"))
      ).toBeVisible()
      expect(
        screen.queryByRole("button", {
          name: i18n.t("marketplace.tabs.publishing"),
        })
      ).not.toBeInTheDocument()
      const application = await screen.findByRole("article", {
        name: applicationRelease.name,
      })
      expect(
        within(application).getByText(
          i18n.t("marketplace.catalogTabs.application")
        )
      ).toBeVisible()
      expect(
        within(application).getByText(i18n.t("marketplace.status.pending"))
      ).toBeVisible()
      expect(within(application).getByText("v1.0.0")).toBeVisible()
      expect(
        within(application).getByText(
          i18n.t("applications.distribution.modes.service")
        )
      ).toBeVisible()
      expect(screen.getByRole("article", { name: release.name })).toBeVisible()
      const backButton = screen.getByRole("button", {
        name: i18n.t("marketplace.backToCenter"),
      })
      expect(backButton).not.toHaveClass("ml-auto")
      expect(backButton.parentElement?.firstElementChild).toBe(backButton)
      expect(backButton.querySelector("svg.lucide-arrow-left")).not.toBeNull()
      expect(
        screen.getByRole("banner").closest(".management-page")
      ).not.toContainElement(backButton)
      await interaction.click(backButton)
      expect(
        screen.getByRole("tab", {
          name: i18n.t("marketplace.catalogTabs.skill"),
        })
      ).toHaveAttribute("aria-selected", "true")
      expect(
        screen.getByRole("heading", {
          name: i18n.t("marketplace.catalogTabs.skill"),
          level: 1,
        })
      ).toBeVisible()
    }
  )

  it("submits an application from My publications even without any publishable plugins or skills", async () => {
    let submitted = false
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (
        path === `/api/v1/application-center/${CAPABILITY_ID}/submissions` &&
        init?.method === "POST"
      ) {
        submitted = true
        return Promise.resolve(envelope(applicationRelease))
      }
      if (
        path === `/api/v1/applications/${CAPABILITY_ID}/distribution/settings`
      )
        return Promise.resolve(
          envelope({
            version_number: "1.0.0",
            highest_version_number: "1.0.0",
            usage_instructions: "填写研究主题",
          })
        )
      const items =
        path === "/api/v1/applications"
          ? [publishableApplication]
          : path === "/api/v1/application-center/mine" && submitted
            ? [applicationRelease]
            : []
      return Promise.resolve(envelope({ items, next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPage()
    await interaction.click(screen.getByRole("button", { name: "我的发布" }))
    await interaction.click(
      await screen.findByRole("button", { name: "申请上架" })
    )
    expect(
      await screen.findByRole("menuitem", { name: "插件" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("menuitem", { name: "技能" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    await interaction.click(screen.getByRole("menuitem", { name: "应用" }))
    await interaction.click(
      await screen.findByRole("button", { name: applicationRelease.name })
    )
    const dialog = await screen.findByRole("dialog", { name: "申请上架" })
    await interaction.click(
      await within(dialog).findByRole("checkbox", { name: "应用服务" })
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: "提交上架审批" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(
      await screen.findByRole("article", { name: applicationRelease.name })
    ).toBeVisible()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/application-center/${CAPABILITY_ID}/submissions`
      ),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"version_number":"1.0.0"'),
      })
    )
    await interaction.click(screen.getByRole("button", { name: "管理上架" }))
    expect(
      await screen.findByRole("dialog", { name: "申请上架" })
    ).toBeVisible()
    expect(
      within(screen.getByRole("dialog")).getByText(applicationRelease.name)
    ).toBeVisible()
  })

  it("shows an application-publications error with a working retry", async () => {
    let fail = true
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes("/application-center/mine") && fail)
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: false,
                error_code: "INTERNAL_ERROR",
                message: "Could not load publications",
              }),
              { status: 500 }
            )
          )
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      })
    )
    const interaction = userEvent.setup()
    renderUserPage()
    await interaction.click(screen.getByRole("button", { name: "我的发布" }))
    const retry = await screen.findByRole("button", {
      name: i18n.t("common.retry"),
    })
    fail = false
    await interaction.click(retry)
    expect(
      await screen.findByText(
        i18n.t("marketplace.publicationsEmpty").replace(/[。.]+$/u, "")
      )
    ).toBeVisible()
  })

  it.each(["zh-CN", "en-US"])(
    "places category navigation above the centered page and synchronizes its header in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(envelope({ items: [], next_cursor: null })))
      )
      const interaction = userEvent.setup()
      const { router } = renderUserPageWithRouter(
        "/capabilities?section=application"
      )
      const tabs = screen.getByRole("tablist", {
        name: i18n.t("marketplace.catalogTabsLabel"),
      })
      const header = screen.getByRole("banner")
      const page = header.closest(".management-page")
      expect(page).not.toContainElement(tabs)
      expect(
        tabs.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(tabs.closest('[data-slot="tabs"]')).toContainElement(header)
      const publicationsButton = screen.getByRole("button", {
        name: i18n.t("marketplace.tabs.publishing"),
      })
      expect(page).not.toContainElement(publicationsButton)
      expect(tabs.parentElement).toContainElement(publicationsButton)
      expect(publicationsButton).toHaveClass("ml-auto", "shrink-0")

      for (const section of [
        "application",
        "plugin",
        "skill",
        "mcp",
      ] as const) {
        const name = i18n.t(`marketplace.catalogTabs.${section}`)
        const tab = within(tabs).getByRole("tab", { name })
        await interaction.click(tab)
        expect(tab).toHaveAttribute("aria-selected", "true")
        expect(
          within(header).getByRole("heading", { name, level: 1 })
        ).toBeVisible()
        expect(
          within(header).getByText(
            i18n.t(`marketplace.catalogDescriptions.${section}`)
          )
        ).toBeVisible()
        expect(screen.getByRole("tabpanel", { name })).toBeVisible()
      }
      await act(() => router.navigate(-1))
      expect(
        within(header).getByRole("heading", {
          name: i18n.t("marketplace.catalogTabs.skill"),
          level: 1,
        })
      ).toBeVisible()
    }
  )

  it.each(["/capabilities", "/capabilities?section=unknown"])(
    "matches the default category header to the selected tab for %s",
    async (initialEntry) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(envelope({ items: [], next_cursor: null })))
      )
      renderUserPageWithRouter(initialEntry)
      expect(
        await screen.findByRole("heading", { name: "应用", level: 1 })
      ).toBeVisible()
      expect(screen.getByRole("tab", { name: "应用" })).toHaveAttribute(
        "aria-selected",
        "true"
      )
      expect(screen.getByRole("tab", { name: "我的应用" })).toHaveAttribute(
        "aria-selected",
        "true"
      )
    }
  )

  it("restores catalog controls from the URL and keeps history navigable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin)
        if (url.pathname === "/api/v1/mcp-servers") {
          return Promise.resolve(envelope({ items: [] }))
        }
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      })
    )
    const interaction = userEvent.setup()
    const { router } = renderUserPageWithRouter(
      "/capabilities?section=skill&scope=public&search=deck"
    )

    expect(
      await screen.findByRole("searchbox", { name: "搜索技能" })
    ).toHaveValue("deck")
    expect(
      within(screen.getByLabelText("内容范围")).getByRole("button", {
        name: "公开",
      })
    ).toHaveAttribute("aria-pressed", "true")

    await interaction.click(screen.getByRole("tab", { name: "MCP" }))
    expect(screen.getByTestId("capability-location")).toHaveTextContent(
      "/capabilities?section=mcp&scope=personal"
    )

    await act(() => router.navigate(-1))
    expect(
      await screen.findByRole("searchbox", { name: "搜索技能" })
    ).toHaveValue("deck")
    expect(screen.getByTestId("capability-location")).toHaveTextContent(
      "/capabilities?section=skill&scope=public&search=deck"
    )
  })

  it("keeps the Skill repository while hiding organization marketplace controls for self-registered users", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname === "/api/v1/mcp-servers") {
        return Promise.resolve(envelope({ items: [] }))
      }
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPageWithRouter(
      "/capabilities?section=skill&scope=public",
      "self_registration"
    )

    expect(
      await screen.findByText("浏览技能仓库，安装和管理适用于不同任务的技能。")
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "我的发布" })
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByLabelText("内容范围")).queryByRole("button", {
        name: "公开",
      })
    ).not.toBeInTheDocument()
    const skillRepository = within(screen.getByLabelText("内容范围")).getByRole(
      "button",
      { name: "技能仓库" }
    )
    expect(skillRepository).toBeVisible()
    await waitFor(() =>
      expect(screen.getByTestId("capability-location")).toHaveTextContent(
        "/capabilities?section=skill&scope=personal"
      )
    )

    await interaction.click(skillRepository)
    expect(screen.getByTestId("capability-location")).toHaveTextContent(
      "/capabilities?section=skill&scope=clawhub"
    )
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const pathname = new URL(String(input), window.location.origin).pathname
        return (
          pathname === "/api/v1/marketplace" ||
          pathname === "/api/v1/marketplace/mine"
        )
      })
    ).toBe(false)
  })

  it("shows built-in skills as installed but excludes them from the personal skill catalog", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (
        url.pathname === "/api/v1/capabilities" &&
        url.searchParams.get("view") === "managed" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({
            items: [
              {
                id: "builtin:capability:linksense-browser",
                name: "linksense-browser",
                slug: "linksense-browser",
                type: "skill",
                description: null,
                status: "active",
                source_type: "builtin",
                builtin_key: "linksense-browser",
                is_builtin: true,
                marketplace_listing_id: null,
                marketplace_release_id: null,
                logo_url: null,
                has_logo: false,
                manifest: null,
                risk_summary: null,
                preference_status: "enabled",
                can_manage: false,
                can_govern: false,
                can_select: false,
                can_delete: false,
                is_owner: false,
                created_at: null,
                updated_at: null,
              },
            ],
            next_cursor: null,
          })
        )
      }
      if (
        (url.pathname === "/api/v1/marketplace" ||
          url.pathname === "/api/v1/marketplace/mine") &&
        method === "GET"
      ) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPage()

    const catalogTabs = await screen.findByRole("tablist", {
      name: "插件中心内容分类",
    })
    expect(catalogTabs).toHaveAttribute("data-variant", "default")
    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "技能" })
    )
    const searchbox = screen.getByRole("searchbox", { name: "搜索技能" })
    expect(searchbox).toBeVisible()
    const inputGroup = searchbox.closest('[data-slot="input-group"]')
    expect(inputGroup).toHaveClass("h-8", "rounded-lg", "bg-field")
    const searchRow = inputGroup?.parentElement
    const addButton = screen.getByRole("button", { name: "添加技能" })
    expect(searchRow).toHaveClass("capability-center-search-row")
    expect(addButton.parentElement).toBe(searchRow)
    expect(searchRow?.firstElementChild).toBe(inputGroup)
    expect(searchRow?.lastElementChild).toBe(addButton)
    expect(screen.getByRole("heading", { name: "已安装" })).toBeVisible()
    const installedList = screen.getByRole("list", { name: "已安装的技能" })
    const installedCard = within(installedList).getByRole("article", {
      name: "LinkSense 浏览器",
    })
    expect(installedCard).toBeVisible()
    expect(within(installedCard).getByText("LinkSense 浏览器")).toBeVisible()
    expect(installedCard.querySelector(".capability-library-type")).toBeNull()
    expect(within(installedCard).getByText("内置")).toHaveClass(
      "capability-built-in-badge"
    )
    const enabledStatus = within(installedCard).getByLabelText("启用")
    expect(enabledStatus).toHaveClass(
      "capability-status-badge",
      "capability-status-badge-active",
      "capability-status-badge-icon-only"
    )
    expect(enabledStatus.querySelector("svg")).not.toBeNull()
    expect(within(installedCard).queryByText("启用")).not.toBeInTheDocument()
    expect(
      within(installedCard).queryByText(/平台自动装配/u)
    ).not.toBeInTheDocument()
    await interaction.click(
      within(installedCard).getByRole("button", {
        name: "查看LinkSense 浏览器详情",
      })
    )
    const builtInDetail = await screen.findByRole("dialog", {
      name: "LinkSense 浏览器",
    })
    expect(within(builtInDetail).getAllByText("内置")).toHaveLength(2)
    expect(within(builtInDetail).getByText(/平台自动装配/u)).toBeVisible()
    expect(
      within(builtInDetail).queryByRole("button", { name: "卸载" })
    ).not.toBeInTheDocument()
    await interaction.click(
      within(builtInDetail).getByRole("button", { name: "关闭" })
    )
    const installedSection = screen.getByRole("region", { name: "已安装" })
    const installedToggle = within(installedSection).getByRole("button", {
      name: "收起已安装的技能",
    })
    expect(installedToggle.previousElementSibling).toBe(
      within(installedSection).getByRole("heading", { name: "已安装" })
    )
    expect(installedToggle).toHaveAttribute("aria-expanded", "true")
    expect(installedToggle).toHaveClass(
      "bg-transparent",
      "hover:bg-transparent",
      "aria-expanded:bg-transparent"
    )

    await interaction.click(installedToggle)

    expect(installedToggle).toHaveAttribute("aria-expanded", "false")
    expect(installedToggle).toHaveAccessibleName("展开已安装的技能")
    expect(
      within(installedSection).queryByRole("list", { name: "已安装的技能" })
    ).not.toBeInTheDocument()
    expect(
      within(installedSection).queryByRole("button", {
        name: /管理已安装/u,
      })
    ).not.toBeInTheDocument()

    await interaction.click(installedToggle)

    expect(installedToggle).toHaveAttribute("aria-expanded", "true")
    expect(
      within(installedSection).getByRole("list", { name: "已安装的技能" })
    ).toBeVisible()
    const scopeToggle = screen.getByLabelText("内容范围")
    expect(scopeToggle).toHaveAttribute("data-variant", "default")
    expect(scopeToggle).toHaveAttribute("data-spacing", "2")
    expect(
      within(scopeToggle)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["个人", "公开", "技能仓库"])
    expect(
      within(scopeToggle).getByRole("button", { name: "个人" })
    ).toHaveAttribute("aria-pressed", "true")
    const personalCatalog = await screen.findByRole("region", {
      name: "个人技能",
    })
    expect(addButton).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "我的插件/Skill 与内置项" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/内置插件与 Skill 由平台自动装配且保持只读/u)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("tablist", { name: "插件中心页面" })
    ).not.toBeInTheDocument()
    const header = screen.getByRole("banner")
    expect(screen.getByRole("button", { name: "我的发布" })).toBeVisible()
    expect(
      within(header).queryByRole("button", { name: "我的插件/Skill" })
    ).not.toBeInTheDocument()
    expect(
      within(personalCatalog).queryByRole("article", {
        name: "LinkSense 浏览器",
      })
    ).not.toBeInTheDocument()
    expect(
      within(personalCatalog).getByText("没有符合条件的个人技能")
    ).toBeVisible()

    await interaction.click(
      within(scopeToggle).getByRole("button", { name: "公开" })
    )
    expect(catalogTabs).toBeVisible()

    await interaction.click(
      within(screen.getByRole("region", { name: "已安装" })).getByRole(
        "button",
        { name: "收起已安装的技能" }
      )
    )
    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "插件" })
    )
    expect(
      within(screen.getByRole("region", { name: "已安装" })).getByRole(
        "button",
        { name: "收起已安装的插件" }
      )
    ).toHaveAttribute("aria-expanded", "true")

    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "技能" })
    )
    expect(
      within(screen.getByRole("region", { name: "已安装" })).getByRole(
        "button",
        { name: "展开已安装的技能" }
      )
    ).toHaveAttribute("aria-expanded", "false")
  })

  it("shows built-in plugins as installed but excludes them from the personal plugin catalog", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (
        url.pathname === "/api/v1/capabilities" &&
        url.searchParams.get("view") === "managed" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({
            items: [
              {
                id: "builtin:capability:linksense-file-service",
                name: "linksense-file-service",
                slug: "linksense-file-service",
                type: "plugin",
                description: null,
                status: "active",
                source_type: "builtin",
                builtin_key: "linksense-file-service",
                is_builtin: true,
                marketplace_listing_id: null,
                marketplace_release_id: null,
                logo_url: null,
                has_logo: false,
                manifest: null,
                risk_summary: null,
                preference_status: "enabled",
                can_manage: false,
                can_govern: false,
                can_select: false,
                can_delete: false,
                is_owner: false,
                created_at: null,
                updated_at: null,
              },
            ],
            next_cursor: null,
          })
        )
      }
      if (url.pathname === "/api/v1/marketplace/mine" && method === "GET") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderUserPage()

    const installedList = await screen.findByRole("list", {
      name: "已安装的插件",
    })
    expect(
      within(installedList).getByRole("article", {
        name: "LinkSense 文件服务",
      })
    ).toBeVisible()
    const personalCatalog = await screen.findByRole("region", {
      name: "个人插件",
    })
    expect(
      within(personalCatalog).queryByRole("article", {
        name: "LinkSense 文件服务",
      })
    ).not.toBeInTheDocument()
    expect(
      within(personalCatalog).getByText("没有符合条件的个人插件")
    ).toBeVisible()
  })

  it("opens release details and supports installing and uninstalling a marketplace skill", async () => {
    let installed = false
    let resolveInstall: ((response: Response) => void) | undefined
    let resolveUninstall: ((response: Response) => void) | undefined
    const installResponse = new Promise<Response>((resolve) => {
      resolveInstall = resolve
    })
    const uninstallResponse = new Promise<Response>((resolve) => {
      resolveUninstall = resolve
    })
    const installedCapability = {
      id: CAPABILITY_ID,
      name: release.name,
      slug: listing.slug,
      type: "skill" as const,
      description: release.description,
      status: "active" as const,
      source_type: "marketplace" as const,
      marketplace_listing_id: LISTING_ID,
      marketplace_release_id: RELEASE_ID,
      logo_url: null,
      has_logo: false,
      manifest: release.manifest,
      risk_summary: release.risk_summary,
      preference_status: "enabled" as const,
      can_manage: true,
      can_govern: false,
      can_delete: true,
      is_owner: true,
      created_at: NOW,
      updated_at: NOW,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (
        url.pathname === "/api/v1/capabilities" &&
        url.searchParams.get("view") === "managed" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({
            items: installed ? [installedCapability] : [],
            next_cursor: null,
          })
        )
      }
      if (url.pathname === "/api/v1/marketplace" && method === "GET") {
        return Promise.resolve(
          envelope({
            items: [
              {
                listing,
                release,
                installed_capability_id: installed ? CAPABILITY_ID : null,
                installed_release_id: installed ? RELEASE_ID : null,
                update_available: false,
                install_count: installed ? 2 : 1,
              },
            ],
            next_cursor: null,
          })
        )
      }
      if (
        url.pathname === `/api/v1/marketplace/${LISTING_ID}/install` &&
        method === "POST"
      ) {
        installed = true
        return installResponse
      }
      if (
        url.pathname === `/api/v1/capabilities/${CAPABILITY_ID}` &&
        method === "DELETE"
      ) {
        installed = false
        return uninstallResponse
      }
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPage()

    await interaction.click(
      await screen.findByRole("tab", {
        name: "技能",
      })
    )
    await interaction.click(
      within(screen.getByLabelText("内容范围")).getByRole("button", {
        name: "公开",
      })
    )
    const cardTitle = await screen.findByText(release.name)
    expect(cardTitle).toBeVisible()
    expect(screen.getByText("发布者：发布者")).toBeVisible()

    const item = cardTitle.closest("article")
    if (!(item instanceof HTMLElement)) {
      throw new Error("Expected the marketplace release to render in an item")
    }
    expect(item).toHaveClass(
      "capability-library-row",
      "capability-library-row-detailed"
    )
    expect(item.parentElement).toHaveClass("capability-library-grid")
    expect(within(item).getByText(release.description)).toHaveClass(
      "capability-library-description"
    )
    expect(item.querySelector(".capability-library-type")).toBeNull()
    expect(within(item).getByText("第 1 个发布")).toBeVisible()
    expect(within(item).getByText("已安装 1 次")).toBeVisible()
    expect(item.querySelector('[data-slot="card"]')).toBeNull()
    expect(item.querySelector('[data-slot="separator"]')).toBeNull()

    await interaction.click(
      within(item).getByRole("button", {
        name: `查看${release.name}详情`,
      })
    )
    const detail = await screen.findByRole("dialog", { name: release.name })
    expect(within(detail).getByText(release.release_notes)).toBeVisible()
    expect(within(detail).getByText(release.content_sha256)).toBeVisible()
    await interaction.click(
      within(detail).getByRole("button", { name: "关闭" })
    )

    expect(
      within(item).queryByRole("button", { name: "安装" })
    ).not.toBeInTheDocument()

    const actionTrigger = within(item).getByRole("button", { name: "操作" })
    expect(actionTrigger.querySelector("svg")).not.toBeNull()
    await interaction.click(actionTrigger)
    const actionMenu = await screen.findByRole("menu")
    expect(actionMenu).toHaveClass("w-max", "min-w-32")
    expect(
      actionMenu.querySelector('[data-slot="dropdown-menu-group"]')
    ).not.toBeNull()
    const viewItem = screen.getByRole("menuitem", { name: "查看" })
    expect(viewItem).toHaveClass("whitespace-nowrap")
    expect(viewItem.querySelector("svg")).not.toBeNull()
    const installItem = screen.getByRole("menuitem", { name: "安装" })
    expect(installItem.querySelector("svg")).not.toBeNull()
    await interaction.click(installItem)

    const installingTrigger = within(item).getByRole("button", {
      name: "安装中",
    })
    expect(installingTrigger).toHaveAttribute("aria-busy", "true")
    expect(
      installingTrigger.querySelector('[data-slot="spinner"]')
    ).not.toBeNull()
    const installLoading = await screen.findByText("正在安装技能…")
    expect(installLoading.closest("[data-sonner-toast]")).not.toBeNull()

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = new URL(String(input), window.location.origin)
          return (
            url.pathname === `/api/v1/marketplace/${LISTING_ID}/install` &&
            init?.method === "POST"
          )
        })
      ).toBe(true)
    })
    resolveInstall?.(envelope(installedCapability))
    const installNotification =
      await screen.findByText("已从插件中心安装到你的个人技能")
    expect(installNotification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(installNotification.closest('[data-slot="alert"]')).toBeNull()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      within(item).queryByRole("button", { name: "安装" })
    ).not.toBeInTheDocument()
    expect(
      within(item).queryByRole("button", { name: "卸载" })
    ).not.toBeInTheDocument()

    const installedList = await screen.findByRole("list", {
      name: "已安装的技能",
    })
    const installedItem = within(installedList).getByRole("article", {
      name: release.name,
    })
    await interaction.click(
      within(installedItem).getByRole("button", {
        name: `查看${release.name}详情`,
      })
    )
    const installedDetail = await screen.findByRole("dialog", {
      name: release.name,
    })
    const manifestHeading = within(installedDetail).getByRole("heading", {
      name: "Manifest 快照",
    })
    expect(within(installedDetail).getByText("Skill")).toHaveClass(
      "rounded-2xl",
      "border",
      "border-divider"
    )
    expect(manifestHeading.parentElement?.querySelector("pre")).toHaveClass(
      "border-divider"
    )
    const detailUninstallButton = within(installedDetail).getByRole("button", {
      name: "卸载",
    })
    expect(detailUninstallButton.querySelector("svg")).not.toBeNull()
    await interaction.click(
      within(installedDetail).getByRole("button", { name: "关闭" })
    )

    await interaction.click(
      within(installedItem).getByRole("button", { name: "操作" })
    )
    expect(await screen.findByRole("menuitem", { name: "卸载" })).toBeVisible()
    await interaction.keyboard("{Escape}")

    await interaction.click(
      within(installedItem).getByRole("button", {
        name: `查看${release.name}详情`,
      })
    )
    const reopenedInstalledDetail = await screen.findByRole("dialog", {
      name: release.name,
    })
    await interaction.click(
      within(reopenedInstalledDetail).getByRole("button", { name: "卸载" })
    )
    expect(
      screen.queryByRole("dialog", { name: release.name })
    ).not.toBeInTheDocument()
    const uninstallDialog = await screen.findByRole("dialog", {
      name: "卸载此插件中心技能？",
    })
    await interaction.click(
      within(uninstallDialog).getByRole("button", { name: "卸载" })
    )

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "卸载此插件中心技能？" })
      ).not.toBeInTheDocument()
    })
    const uninstallLoading = await screen.findByText("正在卸载技能…")
    expect(uninstallLoading.closest("[data-sonner-toast]")).not.toBeNull()

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = new URL(String(input), window.location.origin)
          return (
            url.pathname === `/api/v1/capabilities/${CAPABILITY_ID}` &&
            init?.method === "DELETE"
          )
        })
      ).toBe(true)
    })
    resolveUninstall?.(envelope({ deleted: true }))
    expect(await screen.findByText("插件中心技能已卸载")).toBeVisible()
    const reinstalledActionTrigger = await within(item).findByRole("button", {
      name: "操作",
    })
    await interaction.click(reinstalledActionTrigger)
    expect(await screen.findByRole("menuitem", { name: "安装" })).toBeVisible()
  })

  it("uninstalls a deletable personal skill from its renamed action", async () => {
    let deleted = false
    let resolveDelete: ((response: Response) => void) | undefined
    const deleteResponse = new Promise<Response>((resolve) => {
      resolveDelete = resolve
    })
    const capability = {
      id: CAPABILITY_ID,
      name: "frontend-slides",
      slug: "frontend-slides",
      type: "skill" as const,
      description: "Create animation-rich presentations",
      status: "active" as const,
      source_type: "local" as const,
      marketplace_listing_id: null,
      marketplace_release_id: null,
      logo_url: null,
      has_logo: false,
      manifest: {},
      risk_summary: riskSummary,
      preference_status: "enabled" as const,
      can_manage: true,
      can_govern: true,
      can_delete: true,
      is_owner: true,
      created_at: NOW,
      updated_at: NOW,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (
        url.pathname === "/api/v1/capabilities" &&
        url.searchParams.get("view") === "managed" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({ items: deleted ? [] : [capability], next_cursor: null })
        )
      }
      if (url.pathname === "/api/v1/marketplace/mine" && method === "GET") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (url.pathname === "/api/v1/marketplace" && method === "GET") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        url.pathname === `/api/v1/capabilities/${CAPABILITY_ID}` &&
        method === "DELETE"
      ) {
        deleted = true
        return deleteResponse
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPage()

    await interaction.click(await screen.findByRole("tab", { name: "技能" }))
    await interaction.click(
      within(screen.getByLabelText("内容范围")).getByRole("button", {
        name: "个人",
      })
    )
    const item = within(
      await screen.findByRole("region", { name: "个人技能" })
    ).getByRole("article", { name: "Frontend Slides" })

    await interaction.click(
      within(item).getByRole("button", {
        name: "查看Frontend Slides详情",
      })
    )
    const detail = await screen.findByRole("dialog", {
      name: "Frontend Slides",
    })
    expect(within(detail).getByRole("button", { name: "卸载" })).toBeVisible()
    await interaction.click(
      within(detail).getByRole("button", { name: "关闭" })
    )

    await interaction.click(within(item).getByRole("button", { name: "操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "卸载" })
    )
    const deleteDialog = await screen.findByRole("dialog", {
      name: "卸载此技能？",
    })
    await interaction.click(
      within(deleteDialog).getByRole("button", { name: "卸载" })
    )

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "卸载此技能？" })
      ).not.toBeInTheDocument()
    })
    const deleteLoading = await screen.findByText("正在卸载技能…")
    expect(deleteLoading.closest("[data-sonner-toast]")).not.toBeNull()

    resolveDelete?.(envelope({ deleted: true }))
    expect(await screen.findByText("技能已卸载")).toBeVisible()
    expect(await screen.findByText("没有符合条件的个人技能")).toBeVisible()
  })

  it("treats the current user's published source skill as installed without offering uninstall", async () => {
    const sourceCapability = {
      id: release.source_capability_id,
      name: release.name,
      slug: listing.slug,
      type: "skill" as const,
      description: release.description,
      status: "active" as const,
      source_type: "local" as const,
      marketplace_listing_id: null,
      marketplace_release_id: null,
      logo_url: null,
      has_logo: false,
      manifest: release.manifest,
      risk_summary: release.risk_summary,
      preference_status: "enabled" as const,
      can_manage: true,
      can_govern: false,
      can_delete: true,
      is_owner: true,
      created_at: NOW,
      updated_at: NOW,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (
        url.pathname === "/api/v1/capabilities" &&
        url.searchParams.get("view") === "managed" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({ items: [sourceCapability], next_cursor: null })
        )
      }
      if (url.pathname === "/api/v1/marketplace" && method === "GET") {
        return Promise.resolve(
          envelope({
            items: [
              {
                listing,
                release,
                installed_capability_id: null,
                installed_release_id: null,
                update_available: false,
                install_count: 0,
              },
            ],
            next_cursor: null,
          })
        )
      }
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPage()

    await interaction.click(await screen.findByRole("tab", { name: "技能" }))
    await interaction.click(
      within(screen.getByLabelText("内容范围")).getByRole("button", {
        name: "公开",
      })
    )
    const publicCatalog = await screen.findByRole("region", {
      name: "公开技能",
    })
    const publicItem = within(publicCatalog).getByRole("article", {
      name: release.name,
    })

    expect(within(publicItem).getByText("已安装")).toBeVisible()
    expect(
      within(publicItem).queryByRole("button", { name: "安装" })
    ).not.toBeInTheDocument()
    expect(
      within(publicItem).queryByRole("button", { name: "卸载" })
    ).not.toBeInTheDocument()

    await interaction.click(
      within(publicItem).getByRole("button", { name: "操作" })
    )
    expect(
      screen.queryByRole("menuitem", { name: "卸载" })
    ).not.toBeInTheDocument()
  })

  it("places a published item status in the top-right of its publication card", async () => {
    const publication = {
      listing,
      current_release: release,
      latest_release: release,
      install_count: 7,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (url.pathname === "/api/v1/marketplace/mine" && method === "GET") {
        return Promise.resolve(
          envelope({ items: [publication], next_cursor: null })
        )
      }
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPage()

    await interaction.click(
      await screen.findByRole("button", { name: "我的发布" })
    )
    const publicationCard = await screen.findByRole("article", {
      name: release.name,
    })
    const publishedBadge = within(publicationCard)
      .getByText("已上架")
      .closest('[data-slot="badge"]')

    expect(publishedBadge).not.toBeNull()
    expect(publishedBadge?.parentElement).toHaveClass(
      "capability-library-tail-status-top-right"
    )
  })

  it.each(["zh-CN", "en-US"])(
    "confirms in %s before a publisher unlists a Plugin Center item",
    async (language) => {
      await i18n.changeLanguage(language)
      const publication = {
        listing,
        current_release: release,
        latest_release: release,
        install_count: 7,
      }
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), window.location.origin)
          const method = init?.method ?? "GET"
          if (url.pathname === "/api/v1/marketplace/mine" && method === "GET") {
            return Promise.resolve(
              envelope({ items: [publication], next_cursor: null })
            )
          }
          if (
            url.pathname === `/api/v1/marketplace/${LISTING_ID}/status` &&
            method === "PATCH"
          ) {
            return Promise.resolve(envelope({ ...listing, status: "unlisted" }))
          }
          return Promise.resolve(envelope({ items: [], next_cursor: null }))
        }
      )
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      renderUserPage()

      await interaction.click(
        await screen.findByRole("button", {
          name: i18n.t("marketplace.tabs.publishing"),
        })
      )
      const publicationCard = await screen.findByRole("article", {
        name: release.name,
      })
      await interaction.click(
        within(publicationCard).getByRole("button", {
          name: i18n.t("common.actions"),
        })
      )
      await interaction.click(
        await screen.findByRole("menuitem", {
          name: i18n.t("marketplace.unlist"),
        })
      )

      const dialog = await screen.findByRole("dialog", {
        name: i18n.t("marketplace.unlistConfirmTitle", {
          name: release.name,
        }),
      })
      expect(dialog).toHaveTextContent(
        i18n.t("marketplace.unlistConfirmDescription")
      )
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = new URL(String(input), window.location.origin)
          return (
            url.pathname === `/api/v1/marketplace/${LISTING_ID}/status` &&
            init?.method === "PATCH"
          )
        })
      ).toBe(false)

      await interaction.click(
        within(dialog).getByRole("button", { name: i18n.t("common.cancel") })
      )
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", {
            name: i18n.t("marketplace.unlistConfirmTitle", {
              name: release.name,
            }),
          })
        ).not.toBeInTheDocument()
      )
      await interaction.click(
        within(publicationCard).getByRole("button", {
          name: i18n.t("common.actions"),
        })
      )
      await interaction.click(
        await screen.findByRole("menuitem", {
          name: i18n.t("marketplace.unlist"),
        })
      )
      const confirmation = await screen.findByRole("dialog", {
        name: i18n.t("marketplace.unlistConfirmTitle", {
          name: release.name,
        }),
      })
      await interaction.click(
        within(confirmation).getByRole("button", {
          name: i18n.t("marketplace.unlist"),
        })
      )

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining(`/marketplace/${LISTING_ID}/status`),
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ status: "unlisted" }),
          })
        )
      )
    }
  )

  it("shows and applies a Plugin Center update from My capabilities", async () => {
    const previousReleaseId = "40000000-0000-4000-8000-000000000009"
    let updateAvailable = true
    let resolveUpdate: ((response: Response) => void) | undefined
    const updateResponse = new Promise<Response>((resolve) => {
      resolveUpdate = resolve
    })
    const installedCapability = {
      id: CAPABILITY_ID,
      name: release.name,
      slug: listing.slug,
      type: "skill" as const,
      description: release.description,
      status: "active" as const,
      source_type: "marketplace" as const,
      marketplace_listing_id: LISTING_ID,
      marketplace_release_id: previousReleaseId,
      logo_url: null,
      has_logo: false,
      manifest: release.manifest,
      risk_summary: release.risk_summary,
      preference_status: "enabled" as const,
      can_manage: true,
      can_govern: false,
      is_owner: true,
      created_at: NOW,
      updated_at: NOW,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (url.pathname === "/api/v1/marketplace" && method === "GET") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        url.pathname === "/api/v1/capabilities" &&
        url.searchParams.get("view") === "managed" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({
            items: [
              {
                ...installedCapability,
                marketplace_release_id: updateAvailable
                  ? previousReleaseId
                  : RELEASE_ID,
              },
            ],
            next_cursor: null,
          })
        )
      }
      if (url.pathname === "/api/v1/marketplace/mine" && method === "GET") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        url.pathname === "/api/v1/marketplace/installations" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({
            items: [
              {
                listing,
                release,
                installed_capability_id: CAPABILITY_ID,
                installed_release_id: updateAvailable
                  ? previousReleaseId
                  : RELEASE_ID,
                update_available: updateAvailable,
                install_count: 2,
              },
            ],
            next_cursor: null,
          })
        )
      }
      if (
        url.pathname === `/api/v1/marketplace/${LISTING_ID}/update` &&
        method === "POST"
      ) {
        updateAvailable = false
        return updateResponse
      }
      return Promise.resolve(envelope(null))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPage()

    const catalogTabs = await screen.findByRole("tablist", {
      name: "插件中心内容分类",
    })
    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "技能" })
    )
    await interaction.click(
      within(screen.getByLabelText("内容范围")).getByRole("button", {
        name: "个人",
      })
    )
    const capabilityItem = within(
      await screen.findByRole("region", { name: "个人技能" })
    ).getByRole("article", { name: release.name })
    expect(within(capabilityItem).getByText("插件中心安装")).toBeVisible()
    const updateBadge = within(capabilityItem).getByText("有更新")
    expect(updateBadge).toBeVisible()
    expect(
      updateBadge.closest('[data-slot="badge"]')?.querySelector("svg")
    ).not.toBeNull()

    await interaction.click(
      within(capabilityItem).getByRole("button", { name: "操作" })
    )
    const updateItem = await screen.findByRole("menuitem", {
      name: "更新到最新发布",
    })
    expect(updateItem).toHaveClass("whitespace-nowrap")
    expect(updateItem.querySelector("svg")).not.toBeNull()
    await interaction.click(updateItem)
    const updateLoading = await screen.findByText("正在更新技能…")
    expect(updateLoading.closest("[data-sonner-toast]")).not.toBeNull()

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = new URL(String(input), window.location.origin)
          return (
            url.pathname === `/api/v1/marketplace/${LISTING_ID}/update` &&
            init?.method === "POST"
          )
        })
      ).toBe(true)
    })
    resolveUpdate?.(
      envelope({
        ...installedCapability,
        marketplace_release_id: RELEASE_ID,
      })
    )
    const updateNotification =
      await screen.findByText("插件中心技能已更新到当前获批发布")
    expect(updateNotification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(updateNotification.closest('[data-slot="alert"]')).toBeNull()
    await waitFor(() => {
      expect(
        within(capabilityItem).queryByText("有更新")
      ).not.toBeInTheDocument()
    })
  })

  it("keeps MCP-capable packages in the plugin catalog while exposing their MCP capability", async () => {
    const pluginListing = {
      ...listing,
      id: "30000000-0000-4000-8000-000000000002",
      type: "plugin" as const,
      slug: "plain-plugin",
      current_release_id: "40000000-0000-4000-8000-000000000002",
    }
    const pluginRelease = {
      ...release,
      id: "40000000-0000-4000-8000-000000000002",
      listing_id: pluginListing.id,
      name: "普通插件",
      manifest: { name: "plain-plugin" },
    }
    const mcpListing = {
      ...listing,
      id: "30000000-0000-4000-8000-000000000003",
      type: "plugin" as const,
      slug: "mcp-plugin",
      current_release_id: "40000000-0000-4000-8000-000000000003",
    }
    const mcpRelease = {
      ...release,
      id: "40000000-0000-4000-8000-000000000003",
      listing_id: mcpListing.id,
      name: "知识检索 MCP",
      manifest: { name: "mcp-plugin", has_mcp_servers: true },
      risk_summary: {
        ...riskSummary,
        contains_mcp_server: true,
      },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname === "/api/v1/mcp-servers") {
        return Promise.resolve(envelope({ items: [] }))
      }
      if (url.pathname !== "/api/v1/marketplace") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      const items =
        url.searchParams.get("type") === "skill"
          ? [
              {
                listing,
                release,
                installed_capability_id: null,
                installed_release_id: null,
                update_available: false,
                install_count: 1,
              },
            ]
          : [
              {
                listing: pluginListing,
                release: pluginRelease,
                installed_capability_id: null,
                installed_release_id: null,
                update_available: false,
                install_count: 2,
              },
              {
                listing: mcpListing,
                release: mcpRelease,
                installed_capability_id: null,
                installed_release_id: null,
                update_available: false,
                install_count: 3,
              },
            ]
      return Promise.resolve(envelope({ items, next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPage()

    expect(
      await screen.findByRole("heading", { name: "插件", level: 1 })
    ).toBeVisible()
    expect(
      screen.queryByRole("tablist", { name: "插件中心页面" })
    ).not.toBeInTheDocument()
    const header = screen.getByRole("banner")
    expect(screen.getByRole("button", { name: "我的发布" })).toBeVisible()
    expect(
      within(header).queryByRole("button", { name: "我的插件/Skill" })
    ).not.toBeInTheDocument()
    expect(
      within(header).queryByRole("button", { name: "插件中心" })
    ).not.toBeInTheDocument()
    const catalogTabs = screen.getByRole("tablist", {
      name: "插件中心内容分类",
    })
    const expectAddButtonBesideSearch = (
      searchLabel: string,
      addLabel: string
    ) => {
      const searchbox = screen.getByRole("searchbox", { name: searchLabel })
      const inputGroup = searchbox.closest('[data-slot="input-group"]')
      const addButton = screen.getByRole("button", { name: addLabel })
      expect(inputGroup?.parentElement).toHaveClass(
        "capability-center-search-row"
      )
      expect(addButton.parentElement).toBe(inputGroup?.parentElement)
      expect(inputGroup?.nextElementSibling).toBe(addButton)
    }
    expect(
      within(catalogTabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["应用", "插件", "技能", "MCP"])
    expect(screen.getByRole("heading", { name: "已安装" })).toBeVisible()
    const scopeToggle = screen.getByLabelText("内容范围")
    expect(
      within(scopeToggle)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["个人", "公开"])
    expect(
      within(scopeToggle).getByRole("button", { name: "个人" })
    ).toHaveAttribute("aria-pressed", "true")
    expectAddButtonBesideSearch("搜索插件", "添加插件")
    await interaction.click(screen.getByRole("button", { name: "添加插件" }))
    const pluginImportDialog = await screen.findByRole("dialog", {
      name: "添加插件",
    })
    expect(
      within(pluginImportDialog).queryByLabelText("类型")
    ).not.toBeInTheDocument()
    expect(
      within(pluginImportDialog).getByLabelText("ZIP 插件包")
    ).toBeVisible()
    expect(
      within(pluginImportDialog).queryByText("手动创建 Skill")
    ).not.toBeInTheDocument()
    expect(
      within(pluginImportDialog).queryByText("技能")
    ).not.toBeInTheDocument()
    await interaction.click(
      within(pluginImportDialog).getByRole("button", { name: "关闭" })
    )
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "添加插件" })
      ).not.toBeInTheDocument()
    })

    expect(screen.queryByText(pluginRelease.name)).not.toBeInTheDocument()
    await interaction.click(
      within(scopeToggle).getByRole("button", { name: "公开" })
    )
    expect(await screen.findByText(pluginRelease.name)).toBeVisible()
    const mcpPluginItem = screen.getByRole("article", {
      name: mcpRelease.name,
    })
    expect(mcpPluginItem).toBeVisible()
    expect(within(mcpPluginItem).getByText("包含 MCP")).toBeVisible()
    expect(screen.queryByText(release.name)).not.toBeInTheDocument()

    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "MCP" })
    )
    const mcpScopeToggle = screen.getByLabelText("内容范围")
    expect(
      within(mcpScopeToggle)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["个人"])
    expect(
      within(mcpScopeToggle).getByRole("button", { name: "个人" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      within(mcpScopeToggle).queryByRole("button", { name: "公开" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(mcpRelease.name)).not.toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "搜索MCP" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "添加插件" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "添加技能" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(pluginRelease.name)).not.toBeInTheDocument()

    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "技能" })
    )
    expect(
      within(screen.getByLabelText("内容范围")).getByRole("button", {
        name: "个人",
      })
    ).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByText(release.name)).not.toBeInTheDocument()
    await interaction.click(
      within(screen.getByLabelText("内容范围")).getByRole("button", {
        name: "公开",
      })
    )
    expect(await screen.findByText(release.name)).toBeVisible()
    expectAddButtonBesideSearch("搜索技能", "添加技能")
    expect(screen.queryByText(mcpRelease.name)).not.toBeInTheDocument()

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname === "/api/v1/marketplace" &&
          url.searchParams.get("type") === "plugin"
        )
      })
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname === "/api/v1/marketplace" &&
          url.searchParams.get("type") === "skill"
        )
      })
    ).toBe(true)
  })

  it("uses the installed and personal layout for MCP", async () => {
    const mcpPackageId = "20000000-0000-4000-8000-000000000020"
    const personalMcpPackage = {
      id: mcpPackageId,
      name: "个人数据 MCP 包",
      slug: "personal-data-mcp",
      type: "plugin" as const,
      description: "个人维护的 MCP 扩展包",
      status: "active" as const,
      source_type: "local" as const,
      marketplace_listing_id: null,
      marketplace_release_id: null,
      logo_url: null,
      has_logo: false,
      manifest: {},
      risk_summary: { ...riskSummary, contains_mcp_server: true },
      preference_status: "enabled" as const,
      can_manage: true,
      can_govern: false,
      can_select: true,
      can_delete: true,
      is_owner: true,
      created_at: NOW,
      updated_at: NOW,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname === "/api/v1/capabilities") {
        return Promise.resolve(
          envelope({ items: [personalMcpPackage], next_cursor: null })
        )
      }
      if (url.pathname === "/api/v1/mcp-servers") {
        return Promise.resolve(
          envelope({
            items: [
              {
                id: "70000000-0000-4000-8000-000000000001",
                is_builtin: false,
                name: "本地分析 MCP",
                status: "active",
                startup_timeout_seconds: 15,
                tool_timeout_seconds: 60,
                last_test_status: null,
                last_test_error_code: null,
                last_tested_at: null,
                last_used_at: null,
                created_at: NOW,
                updated_at: NOW,
                transport: "stdio",
                url: null,
                command: "node",
                args: ["server.js"],
                environment_keys: [],
                auth_type: "none",
                api_key_header: null,
                has_credential: false,
                insecure_http_acknowledged: false,
              },
            ],
          })
        )
      }
      if (url.pathname === "/api/v1/marketplace") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (url.pathname === "/api/v1/marketplace/mine") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPageWithSettingsDestination()

    const catalogTabs = await screen.findByRole("tablist", {
      name: "插件中心内容分类",
    })
    const installedPluginList = await screen.findByRole("list", {
      name: "已安装的插件",
    })
    const installedPlugin = within(installedPluginList).getByRole("article", {
      name: "个人数据 MCP 包",
    })
    expect(installedPlugin).toBeVisible()
    const includesMcpBadge = within(installedPlugin)
      .getByText("包含 MCP")
      .closest<HTMLElement>('[data-slot="badge"]')
    expect(includesMcpBadge).toBeVisible()
    expect(
      includesMcpBadge?.querySelector('img[data-default-capability-icon="mcp"]')
    ).toBeNull()
    expect(
      includesMcpBadge?.querySelector("svg.lucide-server-cog")
    ).toBeVisible()
    expect(
      await within(screen.getByRole("region", { name: "个人插件" })).findByRole(
        "article",
        { name: "个人数据 MCP 包" }
      )
    ).toBeVisible()

    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "MCP" })
    )

    expect(screen.getByRole("searchbox", { name: "搜索MCP" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "添加插件" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "添加技能" })
    ).not.toBeInTheDocument()
    const installedList = await screen.findByRole("list", {
      name: "已安装的MCP",
    })
    const coreMcpItem = within(installedList).getByRole("article", {
      name: "LinkSense Core MCP",
    })
    expect(coreMcpItem).toBeVisible()
    expect(
      coreMcpItem.querySelector('img[data-default-capability-icon="mcp"]')
    ).toBeVisible()
    expect(within(coreMcpItem).getByText("内置")).toBeVisible()
    expect(within(coreMcpItem).queryByRole("button")).not.toBeInTheDocument()
    for (const legacyName of [
      "LinkSense 文件服务 MCP",
      "LinkSense 图片生成 MCP",
      "LinkSense 知识库 MCP",
      "LinkSense Skill 创建器 MCP",
    ]) {
      expect(
        within(installedList).queryByRole("article", { name: legacyName })
      ).not.toBeInTheDocument()
    }
    const localMcpItem = within(installedList).getByRole("article", {
      name: "本地分析 MCP",
    })
    expect(localMcpItem).toBeVisible()
    expect(
      localMcpItem.querySelector('img[data-default-capability-icon="mcp"]')
    ).toBeVisible()
    const installedPersonalMcpPackage = within(installedList).getByRole(
      "article",
      { name: "个人数据 MCP 包" }
    )
    expect(installedPersonalMcpPackage).toBeVisible()
    expect(
      installedPersonalMcpPackage.querySelector(
        'img[data-default-capability-icon="mcp"]'
      )
    ).toBeVisible()
    expect(
      within(
        within(installedList).getByRole("article", {
          name: "个人数据 MCP 包",
        })
      ).getByText("包含 MCP")
    ).toBeVisible()
    for (const item of within(installedList).getAllByRole("article")) {
      expect(item.querySelector(".capability-library-type")).toBeNull()
      const enabledStatus = within(item).getByLabelText("启用")
      expect(enabledStatus).toHaveClass(
        "capability-status-badge",
        "capability-status-badge-active",
        "capability-status-badge-icon-only"
      )
      expect(enabledStatus.querySelector("svg")).not.toBeNull()
      expect(within(item).queryByText("启用")).not.toBeInTheDocument()
    }
    const mcpScopeToggle = screen.getByLabelText("内容范围")
    expect(
      within(mcpScopeToggle)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["个人"])
    expect(
      within(mcpScopeToggle).getByRole("button", { name: "个人" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      within(mcpScopeToggle).queryByRole("button", { name: "公开" })
    ).not.toBeInTheDocument()
    const connectionsHeading = await screen.findByRole("heading", {
      name: "MCP 连接",
    })
    expect(connectionsHeading).toBeVisible()
    expect(screen.getByRole("heading", { name: "MCP 扩展包" })).toBeVisible()
    const personalCatalog = screen.getByRole("region", { name: "个人MCP" })
    expect(
      within(personalCatalog).queryByRole("article", {
        name: "LinkSense Core MCP",
      })
    ).not.toBeInTheDocument()
    const personalMcpConnection = within(personalCatalog).getByRole("article", {
      name: "本地分析 MCP",
    })
    expect(personalMcpConnection).toBeVisible()
    expect(
      personalMcpConnection.querySelector(
        'img[data-default-capability-icon="mcp"]'
      )
    ).toBeVisible()
    expect(
      within(personalCatalog).getByRole("article", {
        name: "个人数据 MCP 包",
      })
    ).toBeVisible()
    for (const item of within(personalCatalog).getAllByRole("article")) {
      expect(item.querySelector(".capability-library-type")).toBeNull()
      const enabledStatus = within(item).getByLabelText("启用")
      expect(enabledStatus).toHaveClass(
        "capability-status-badge",
        "capability-status-badge-active",
        "capability-status-badge-icon-only"
      )
      expect(enabledStatus.querySelector("svg")).not.toBeNull()
      expect(within(item).queryByText("启用")).not.toBeInTheDocument()
    }
    const manageMcpButton = screen.getByRole("button", { name: "管理 MCP" })
    const connectionsHeader = connectionsHeading.parentElement
    expect(manageMcpButton).toBeVisible()
    expect(connectionsHeader).toHaveClass("capability-center-personal-actions")
    expect(connectionsHeader?.firstElementChild).toBe(connectionsHeading)
    expect(connectionsHeader).not.toContainElement(manageMcpButton)
    const searchGroup = screen
      .getByRole("searchbox", { name: "搜索MCP" })
      .closest('[data-slot="input-group"]')
    const searchRow = searchGroup?.parentElement
    expect(searchRow).toHaveClass("capability-center-search-row")
    expect(searchRow?.firstElementChild).toBe(searchGroup)
    expect(searchRow?.lastElementChild).toBe(manageMcpButton)

    await interaction.click(manageMcpButton)
    expect(
      JSON.parse(screen.getByTestId("settings-location").textContent ?? "{}")
    ).toEqual({
      pathname: "/settings/mcp",
      search: "",
      state: {
        settingsReturnTo: "/capabilities?section=mcp&scope=personal",
      },
    })

    await interaction.click(screen.getByRole("button", { name: "测试返回" }))
    const returnedCatalogTabs = await screen.findByRole("tablist", {
      name: "插件中心内容分类",
    })
    expect(
      within(returnedCatalogTabs).getByRole("tab", { name: "MCP" })
    ).toHaveAttribute("aria-selected", "true")
    expect(
      within(screen.getByLabelText("内容范围")).getByRole("button", {
        name: "个人",
      })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      await screen.findByRole("heading", { name: "MCP 连接" })
    ).toBeVisible()
    const returnedScopeToggle = screen.getByLabelText("内容范围")
    expect(
      within(returnedScopeToggle)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["个人"])
    expect(
      within(returnedScopeToggle).queryByRole("button", { name: "公开" })
    ).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), window.location.origin)
        return url.pathname === "/api/v1/marketplace"
      })
    ).toBe(false)
  })

  it("lists an internally shared application without exposing management actions", async () => {
    const applicationId = "50000000-0000-4000-8000-000000000001"
    const conversationId = "60000000-0000-4000-8000-000000000001"
    let resolveStart: ((response: Response) => void) | undefined
    const startRequest = new Promise<Response>((resolve) => {
      resolveStart = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (url.pathname === "/api/v1/marketplace") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (url.pathname === "/api/v1/applications/distribution")
        return Promise.resolve(
          envelope({
            items: [
              {
                application_id: applicationId,
                published_version_id: applicationId,
                published_version_number: "1.0.0",
                service_installation: {
                  installed_version_id: applicationId,
                  installed_version_number: "1.0.0",
                  available_version_id: applicationId,
                  available_version_number: "1.0.0",
                  update_available: false,
                },
                usage_modes: ["service"],
                installation: null,
                installed_application_id: null,
              },
            ],
          })
        )
      if (url.pathname === "/api/v1/applications" && method === "GET") {
        return Promise.resolve(
          envelope({
            items: [
              {
                id: applicationId,
                owner: { id: PUBLISHER_ID, name: "财务团队" },
                name: "财务制度助手",
                icon: { type: "preset", preset: "book-open" },
                description: "回答内部财务制度问题",
                instructions: null,
                model: "gpt-5.6-terra",
                reasoning_effort: "medium",
                status: "active",
                is_owner: false,
                can_manage: false,
                access_source: "direct",
                capability_count: 0,
                mcp_server_count: 0,
                knowledge_base_count: 0,
                dependencies_available: true,
                capabilities: [],
                mcp_servers: [],
                knowledge_bases: [],
                created_at: NOW,
                updated_at: NOW,
              },
            ],
            next_cursor: null,
          })
        )
      }
      if (
        url.pathname ===
          `/api/v1/applications/${applicationId}/conversations` &&
        method === "POST"
      ) {
        return startRequest
      }
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    const { router } = renderUserPageWithRouter("/capabilities?section=plugin")

    const catalogTabs = await screen.findByRole("tablist", {
      name: "插件中心内容分类",
    })
    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "应用" })
    )

    await interaction.click(
      within(screen.getByRole("tablist", { name: "应用范围" })).getByRole(
        "tab",
        { name: "共享我的" }
      )
    )
    const title = await screen.findByRole("heading", {
      name: "财务制度助手",
    })
    const card = title.closest('[data-slot="card"]')
    if (!(card instanceof HTMLElement)) {
      throw new Error("Expected application card")
    }
    expect(within(card).getByText("创建者：财务团队")).toBeVisible()
    expect(
      within(card).queryByText(
        "应用始终引用创建者维护的最新配置，无需重新发布。"
      )
    ).not.toBeInTheDocument()
    expect(within(card).queryByRole("button", { name: "共享" })).toBeNull()
    expect(within(card).queryByRole("button", { name: "编辑" })).toBeNull()

    const startButton = within(card).getByRole("button", {
      name: "使用",
    })
    expect(startButton).toHaveClass("border-border", "bg-background")
    expect(
      startButton.querySelector('svg[data-icon="inline-end"]')
    ).toHaveAttribute("aria-hidden", "true")
    await interaction.click(startButton)
    expect(router.state.location.pathname).toMatch(/^\/applications\/open\//)
    expect(startButton).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(
      document.querySelector('[data-slot="skeleton"]')
    ).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveClass("page-state-loading")
    expect(
      fetchMock.mock.calls.filter(
        ([input, options]) =>
          String(input).includes(
            `/applications/${applicationId}/conversations`
          ) && options?.method === "POST"
      )
    ).toHaveLength(1)
    await act(async () => {
      resolveStart?.(envelope({ conversation_id: conversationId }))
    })
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/conversations/${conversationId}`
      )
    )
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/applications/${applicationId}/conversations`
        ),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ channel: "direct" }),
        })
      )
    )
  })

  it("shows only personal applications and hides organization sharing for self-registered users", async () => {
    const applicationId = "50000000-0000-4000-8000-000000000090"
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname === "/api/v1/applications/catalog") {
        expect(url.searchParams.get("state")).toBe("all")
        return Promise.resolve(
          envelope({
            items: [
              {
                id: applicationId,
                owner: { id: PUBLISHER_ID, name: "发布者" },
                name: "个人助手",
                icon: { type: "preset", preset: "bot" },
                description: null,
                instructions: "Personal instructions",
                model: null,
                reasoning_effort: null,
                status: "active",
                is_owner: true,
                can_manage: true,
                access_source: "owner",
                capability_count: 0,
                mcp_server_count: 0,
                knowledge_base_count: 0,
                dependencies_available: true,
                capabilities: [],
                mcp_servers: [],
                knowledge_bases: [],
                share_targets: [
                  {
                    id: "10000000-0000-4000-8000-000000000090",
                    type: "user",
                    name: "历史共享对象",
                  },
                ],
                created_at: NOW,
                updated_at: NOW,
              },
            ].map((application) => ({
              type: "application",
              application,
              development: null,
            })),
            next_cursor: null,
          })
        )
      }
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPageWithRouter(
      "/capabilities?section=application&scope=personal&app_scope=shared",
      "self_registration"
    )

    expect(
      await screen.findByRole("heading", { name: "个人助手" })
    ).toBeVisible()
    expect(
      screen.queryByRole("combobox", { name: "应用范围" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/历史共享对象/u)).not.toBeInTheDocument()

    await interaction.click(
      screen.getByRole("button", { name: "个人助手的更多操作" })
    )
    expect(
      screen.queryByRole("menuitem", { name: "组织内共享" })
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId("capability-location")).toHaveTextContent(
        "app_scope=owned"
      )
    )
  })

  it.each(["zh-CN", "en-US"])(
    "places application creation in the page header and search beside the scope tabs in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(envelope({ items: [], next_cursor: null })))
      )
      const interaction = userEvent.setup()
      renderUserPage()
      await interaction.click(
        await screen.findByRole("tab", {
          name: i18n.t("marketplace.catalogTabs.application"),
        })
      )
      const header = screen.getByRole("banner")
      const create = within(header).getByRole("button", {
        name: i18n.t("applications.create"),
      })
      const tabs = screen.getByRole("tablist", {
        name: i18n.t("applications.scopeLabel"),
      })
      const search = screen.getByRole("textbox", {
        name: i18n.t("applications.search"),
      })
      const toolbar = search.closest(
        '[data-slot="application-catalog-toolbar"]'
      )
      expect(toolbar).toContainElement(tabs)
      expect(toolbar).not.toContainElement(create)
      expect(search.closest('[data-slot="input-group"]')).not.toBeNull()
      await interaction.click(create)
      const choices = await screen.findByRole("dialog", {
        name: i18n.t("applications.createTitle"),
      })
      expect(
        within(choices).getByRole("button", {
          name: new RegExp(i18n.t("applications.createStandardApp")),
        })
      ).toBeVisible()
      await interaction.keyboard("{Escape}")
      await interaction.click(
        screen.getByRole("tab", {
          name: i18n.t("applications.distribution.sharedApplications"),
        })
      )
      expect(
        within(header).queryByRole("button", {
          name: i18n.t("applications.create"),
        })
      ).not.toBeInTheDocument()
      await interaction.click(
        screen.getByRole("tab", {
          name: i18n.t("applications.distribution.center"),
        })
      )
      const centerSearch = screen.getByRole("textbox", {
        name: i18n.t("applications.distribution.centerSearch"),
      })
      expect(
        centerSearch.closest('[data-slot="application-catalog-toolbar"]')
      ).toContainElement(tabs)
      expect(
        within(header).queryByRole("button", {
          name: i18n.t("applications.create"),
        })
      ).not.toBeInTheDocument()
    }
  )

  it("renders wide two-column application cards with status and owner actions aligned", async () => {
    const longDescription =
      "通过结构化表单配置研究任务，并在应用内接收洞察、风险和行动建议。".repeat(
        12
      )
    const applications = [
      {
        id: "50000000-0000-4000-8000-000000000011",
        name: "AISG学校政策问答助手",
        model: null,
        share_targets: [
          {
            id: "10000000-0000-4000-8000-000000000031",
            type: "user" as const,
            name: "林老师",
          },
          {
            id: "10000000-0000-4000-8000-000000000032",
            type: "user_group" as const,
            name: "教务组",
          },
          {
            id: "10000000-0000-4000-8000-000000000033",
            type: "user" as const,
            name: "王老师",
          },
        ],
      },
      {
        id: "50000000-0000-4000-8000-000000000012",
        name: "教职工流程助手",
        model: "gpt-5.6-terra",
        kind: "interactive" as const,
        interactive_package: {
          id: "50000000-0000-4000-8000-000000000013",
          version: "1.1.0",
          manifest: {
            schema_version: 1 as const,
            id: "faculty-workflow-assistant",
            name: "教职工流程助手",
            version: "1.1.0",
            sdk_version: 1 as const,
          },
          created_at: NOW,
        },
      },
    ].map((application) => ({
      ...application,
      owner: { id: PUBLISHER_ID, name: "发布者" },
      icon: { type: "preset" as const, preset: "book-open" as const },
      description: application.model ? longDescription : null,
      instructions: "仅根据内部知识回答。",
      reasoning_effort: "medium",
      status: "active" as const,
      is_owner: true,
      can_manage: true,
      access_source: "owner" as const,
      capability_count: 0,
      mcp_server_count: 0,
      knowledge_base_count: 1,
      dependencies_available: true,
      capabilities: [],
      mcp_servers: [],
      knowledge_bases: [],
      created_at: NOW,
      updated_at: NOW,
    }))
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin)
        if (url.pathname === "/api/v1/applications/distribution") {
          return Promise.resolve(
            envelope({
              items: applications.map((application) => ({
                application_id: application.id,
                published_version_id: application.id,
                published_version_number: "1.0.0",
                usage_modes: ["service"],
                installation: null,
                installed_application_id: null,
                service_installation: {
                  installed_version_id: application.id,
                  installed_version_number: "1.0.0",
                  available_version_id: application.id,
                  available_version_number: "1.0.0",
                  update_available: false,
                },
              })),
            })
          )
        }
        if (url.pathname === "/api/v1/applications/catalog") {
          return Promise.resolve(
            envelope({
              items: applications.map((application) => ({
                type: "application",
                application,
                development: null,
              })),
              next_cursor: null,
            })
          )
        }
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      })
    )
    const interaction = userEvent.setup()
    renderUserPage()

    await interaction.click(await screen.findByRole("tab", { name: "应用" }))
    const title = await screen.findByRole("heading", {
      name: applications[0]!.name,
    })
    const card = title.closest('[data-slot="card"]')
    if (!(card instanceof HTMLElement)) {
      throw new Error("Expected owned application card")
    }
    const grid = card.parentElement
    const cardHeader = card.querySelector<HTMLElement>(
      '[data-slot="card-header"]'
    )
    const cardAction = cardHeader
    const description = within(card).getByText("暂无说明")
    const statistics = within(card).getByRole("list", { name: "应用资源" })
    const status = card.querySelector<HTMLElement>(
      '[data-slot="application-card-status"]'
    )
    const footer = card.querySelector<HTMLElement>('[data-slot="card-footer"]')
    const iconTile = card.querySelector<HTMLElement>(
      '[data-slot="application-card-icon"]'
    )
    const shareSummary = within(card).getByText("已共享 · 林老师、教务组…")

    expect(grid).toHaveClass("grid", "md:grid-cols-2")
    expect(grid).not.toHaveClass("xl:grid-cols-3")
    expect(card).toHaveClass("gap-5", "shadow-none")
    expect(cardHeader).toHaveClass("flex", "flex-row", "gap-3")
    expect(cardHeader).toContainElement(
      within(card).getByRole("button", {
        name: applications[0]!.name + "的更多操作",
      })
    )
    expect(description).toHaveClass(
      "line-clamp-2",
      "min-h-10",
      "wrap-anywhere",
      "leading-5"
    )
    expect(description.nextElementSibling).toBe(statistics)
    expect(statistics).toHaveClass("flex-wrap", "tabular-nums")
    expect(statistics).toHaveTextContent("插件 / Skill 0")
    expect(statistics).toHaveTextContent("知识库 1")
    const mcpCount = within(statistics).getByText("MCP 0").closest("li")
    expect(mcpCount?.querySelector("svg.lucide-server")).toBeVisible()
    expect(statistics).not.toHaveTextContent("已启用")
    expect(status).toHaveTextContent("已启用")
    expect(cardHeader).toContainElement(status)
    expect(
      card.querySelector('[data-slot="application-card-model"]')
    ).toBeNull()
    expect(footer).toHaveClass("flex-wrap", "border-t")
    expect(footer).toContainElement(shareSummary)
    expect(statistics).not.toContainElement(shareSummary)
    expect(within(card).queryByText(/王老师/u)).toBeNull()
    expect(iconTile).toHaveClass("size-12", "rounded-lg")
    expect(card.querySelector('[data-slot="avatar"]')).toHaveClass(
      "size-10",
      "after:border-0"
    )
    expect(
      within(card).queryByText("由用户在聊天中选择")
    ).not.toBeInTheDocument()

    const fixedModelCard = (
      await screen.findByRole("heading", { name: applications[1]!.name })
    ).closest('[data-slot="card"]')
    if (!(fixedModelCard instanceof HTMLElement)) {
      throw new Error("Expected fixed-model application card")
    }
    const fixedModelDescription =
      within(fixedModelCard).getByText(longDescription)
    expect(fixedModelDescription).toHaveClass(
      "line-clamp-2",
      "min-h-10",
      "wrap-anywhere"
    )
    const versionLabel = within(fixedModelCard).getByText("v1.1.0")
    const interactiveCreator = within(fixedModelCard).getByText("由我创建")
    const versionHeader = versionLabel.closest('[data-slot="card-header"]')
    expect(versionHeader).toHaveTextContent("交互式应用")
    expect(versionHeader).not.toContainElement(interactiveCreator)
    expect(
      interactiveCreator.closest('[data-slot="card-footer"]')
    ).not.toBeNull()
    const fixedModelStatistics = within(fixedModelCard).getByRole("list", {
      name: "应用资源",
    })
    const fixedModelName = within(fixedModelCard).getByText("gpt-5.6-terra")
    const fixedModelRow = fixedModelName.closest(
      '[data-slot="application-card-model-row"]'
    )
    expect(fixedModelDescription.nextElementSibling).toBe(fixedModelStatistics)
    expect(fixedModelStatistics).not.toContainElement(fixedModelName)
    expect(
      fixedModelCard.querySelector('[data-slot="application-card-metadata"]')
    ).toHaveTextContent("已启用")
    expect(fixedModelRow).not.toHaveTextContent("已启用")
    expect(fixedModelName).toHaveAttribute("title", "gpt-5.6-terra")
    expect(fixedModelName).toHaveClass("truncate")
    expect(fixedModelRow?.querySelector("svg.lucide-brain")).toBeVisible()
    expect(
      within(footer!)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["使用"])
    const useButton = within(footer!).getByRole("button", { name: "使用" })
    expect(useButton).toHaveClass("border-border", "bg-background")
    expect(useButton.querySelector('svg[data-icon="inline-end"]')).toBeVisible()
    expect(
      within(footer!).queryByRole("button", { name: "共享" })
    ).not.toBeInTheDocument()
    expect(
      within(footer!).queryByRole("button", { name: "编辑" })
    ).not.toBeInTheDocument()
    expect(
      within(footer!).queryByRole("button", { name: "删除应用" })
    ).not.toBeInTheDocument()
    await interaction.click(
      within(cardAction!).getByRole("button", {
        name: `${applications[0]!.name}的更多操作`,
      })
    )
    const actionMenu = await screen.findByRole("menu")
    expect(
      actionMenu.querySelector('[data-slot="dropdown-menu-group"]')
    ).not.toBeNull()
    expect(
      within(actionMenu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual([
      "编辑",
      "发布",
      "组织内共享",
      "申请上架",
      "用量统计",
      "外部访问",
      "停用",
      "删除应用",
    ])
    expect(screen.getByRole("menuitem", { name: "用量统计" })).toHaveAttribute(
      "href",
      `/capabilities/applications/${applications[0]!.id}/usage`
    )
    expect(screen.getByRole("menuitem", { name: "组织内共享" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "申请上架" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "编辑" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "删除应用" })).toBeVisible()
  })

  it("separates application sharing between users and user groups", async () => {
    const applicationId = "50000000-0000-4000-8000-000000000021"
    const userTargetId = "10000000-0000-4000-8000-000000000021"
    const groupTargetId = "10000000-0000-4000-8000-000000000022"
    let submittedBody: Record<string, unknown> | null = null
    let activeGrants: Array<{
      id: string
      application_id: string
      grantee_type: "user" | "user_group"
      target: { id: string; name: string }
      status: "active"
      usage_modes: ("install" | "service")[]
      created_at: string
      updated_at: string
    }> = []
    const application = {
      id: applicationId,
      owner: { id: PUBLISHER_ID, name: "发布者" },
      icon: { type: "preset" as const, preset: "book-open" as const },
      name: "AISG学校政策问答助手",
      description: null,
      instructions: "仅根据内部知识回答。",
      model: null,
      reasoning_effort: "medium" as const,
      status: "active" as const,
      is_owner: true,
      can_manage: true,
      access_source: "owner" as const,
      capability_count: 0,
      mcp_server_count: 0,
      knowledge_base_count: 1,
      dependencies_available: true,
      capabilities: [],
      mcp_servers: [],
      knowledge_bases: [],
      created_at: NOW,
      updated_at: NOW,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (
        url.pathname ===
        `/api/v1/applications/${applicationId}/distribution/settings`
      )
        return Promise.resolve(
          envelope({
            highest_version_number: "1.0.0",
            version_number: "1.0.0",
            usage_instructions: "Read the guide",
          })
        )
      if (url.pathname === "/api/v1/applications/distribution")
        return Promise.resolve(envelope({ items: [] }))
      if (url.pathname === "/api/v1/applications/catalog" && method === "GET") {
        return Promise.resolve(
          envelope({
            items: [{ type: "application", application, development: null }],
            next_cursor: null,
          })
        )
      }
      if (
        url.pathname === `/api/v1/applications/${applicationId}/grants` &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({ items: activeGrants, next_cursor: null })
        )
      }
      if (
        url.pathname === "/api/v1/applications/share-targets" &&
        method === "GET"
      ) {
        const type = url.searchParams.get("type")
        return Promise.resolve(
          envelope({
            items:
              type === "user_group"
                ? [
                    {
                      id: groupTargetId,
                      type: "user_group",
                      name: "教务组",
                      secondary_text: "负责学校政策",
                    },
                  ]
                : [
                    {
                      id: userTargetId,
                      type: "user",
                      name: "林老师",
                      secondary_text: "lin@example.test",
                    },
                  ],
            next_cursor: null,
          })
        )
      }
      if (
        url.pathname === `/api/v1/applications/${applicationId}/share` &&
        method === "POST"
      ) {
        submittedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >
        const createdGrant = {
          id: "70000000-0000-4000-8000-000000000021",
          application_id: applicationId,
          grantee_type: "user_group" as const,
          target: { id: groupTargetId, name: "教务组" },
          status: "active" as const,
          usage_modes: ["service" as const],
          created_at: NOW,
          updated_at: NOW,
        }
        activeGrants = [createdGrant]
        return Promise.resolve(
          envelope({
            version_id: applicationId,
            version_number: "1.0.0",
            usage_instructions: "Read the guide",
          })
        )
      }
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderUserPage()

    await interaction.click(await screen.findByRole("tab", { name: "应用" }))
    const card = (
      await screen.findByRole("heading", { name: application.name })
    ).closest('[data-slot="card"]')
    if (!(card instanceof HTMLElement)) {
      throw new Error("Expected application card")
    }
    await interaction.click(
      within(card).getByRole("button", {
        name: `${application.name}的更多操作`,
      })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "组织内共享" })
    )
    const dialog = await screen.findByRole("dialog", { name: "组织内共享" })
    const userTab = within(dialog).getByRole("tab", { name: "用户" })
    const groupTab = within(dialog).getByRole("tab", { name: "用户组" })
    const targetTypeSelector = userTab.closest(".share-target-type-options")
    expect(targetTypeSelector).toHaveAttribute("data-slot", "tabs-list")
    expect(userTab).toHaveAttribute("data-slot", "tabs-trigger")
    expect(groupTab).toHaveAttribute("data-slot", "tabs-trigger")
    expect(userTab).toHaveAttribute("aria-selected", "true")
    expect(userTab).toHaveAttribute("data-active")
    expect(userTab).toHaveClass("data-active:bg-muted/50")
    expect(groupTab).toHaveAttribute("aria-selected", "false")
    expect(groupTab).not.toHaveAttribute("data-active")
    expect(
      targetTypeSelector?.querySelector('[data-slot="radio-group-item"]')
    ).not.toBeInTheDocument()
    expect(targetTypeSelector?.querySelectorAll("svg")).toHaveLength(2)
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([request]) => {
          const url = new URL(String(request), window.location.origin)
          return (
            url.pathname === "/api/v1/applications/share-targets" &&
            url.searchParams.get("type") === "user"
          )
        })
      ).toBe(true)
    )

    await interaction.type(
      within(dialog).getByRole("combobox", { name: "共享用户" }),
      "林"
    )
    expect(await screen.findByRole("option", { name: /林老师/u })).toBeVisible()
    expect(screen.queryByRole("option", { name: "教务组" })).toBeNull()
    await interaction.click(screen.getByRole("option", { name: /林老师/u }))
    expect(
      within(dialog).getByRole("combobox", { name: "共享用户" })
    ).toHaveValue("林老师")
    expect(
      within(dialog).queryByText("尚未共享给任何用户或用户组。")
    ).toBeNull()
    const selectedUserRow = within(dialog)
      .getByText("林老师")
      .closest(".application-share-current-item")
    expect(selectedUserRow).not.toBeNull()
    if (!(selectedUserRow instanceof HTMLElement)) {
      throw new Error("Expected selected user preview row")
    }
    expect(selectedUserRow).toHaveClass("application-share-current-item")
    expect(
      within(selectedUserRow).queryByRole("button", { name: "取消共享" })
    ).toBeNull()
    expect(submittedBody).toBeNull()
    expect(within(dialog).getByRole("button", { name: "关闭" })).toBeVisible()
    expect(
      within(dialog).getAllByRole("button", { name: "共享" })
    ).toHaveLength(1)

    await interaction.click(groupTab)
    expect(userTab).toHaveAttribute("aria-selected", "false")
    expect(userTab).not.toHaveAttribute("data-active")
    expect(groupTab).toHaveAttribute("aria-selected", "true")
    expect(groupTab).toHaveAttribute("data-active")
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([request]) => {
          const url = new URL(String(request), window.location.origin)
          return (
            url.pathname === "/api/v1/applications/share-targets" &&
            url.searchParams.get("type") === "user_group"
          )
        })
      ).toBe(true)
    )

    await interaction.type(
      within(dialog).getByRole("combobox", { name: "共享用户组" }),
      "教"
    )
    expect(await screen.findByRole("option", { name: /教务组/u })).toBeVisible()
    expect(screen.queryByRole("option", { name: "林老师" })).toBeNull()
    await interaction.click(screen.getByRole("option", { name: /教务组/u }))
    const selectedGroupRow = within(dialog)
      .getByText("教务组")
      .closest(".application-share-current-item")
    expect(selectedGroupRow).not.toBeNull()
    if (!(selectedGroupRow instanceof HTMLElement)) {
      throw new Error("Expected selected group preview row")
    }
    const selectedGroupIcon = selectedGroupRow.querySelector(".lucide-users")
    expect(selectedGroupIcon).toHaveClass("size-5", "shrink-0")
    expect(
      within(selectedGroupRow).queryByRole("button", { name: "取消共享" })
    ).toBeNull()
    await interaction.click(
      within(dialog).getByRole("button", { name: "共享" })
    )

    await waitFor(() =>
      expect(submittedBody).toEqual({
        version_number: "1.0.0",
        usage_instructions: "Read the guide",
        target: {
          grantee_type: "user_group",
          user_group_id: groupTargetId,
          usage_modes: ["service"],
        },
      })
    )
    const shareNotification = await screen.findByText("共享成功")
    expect(shareNotification.closest("[data-sonner-toast]")).not.toBeNull()
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "组织内共享" })
      ).not.toBeInTheDocument()
    )
    await interaction.click(
      within(card).getByRole("button", {
        name: `${application.name}的更多操作`,
      })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "组织内共享" })
    )
    const reopenedDialog = await screen.findByRole("dialog", {
      name: "组织内共享",
    })
    await waitFor(() => {
      const sharedGroupRow = within(reopenedDialog)
        .getByText("教务组")
        .closest(".application-share-current-item")
      if (!(sharedGroupRow instanceof HTMLElement)) {
        throw new Error("Expected shared group row")
      }
      expect(
        within(sharedGroupRow).getByRole("button", { name: "取消共享" })
      ).toBeVisible()
    })
  })

  it(
    "creates an application with fixed runtime resources and application-scoped credential plugins",
    async () => {
      const applicationId = "50000000-0000-4000-8000-000000000002"
      const safeCapabilityId = "20000000-0000-4000-8000-000000000010"
      const credentialCapabilityId = "20000000-0000-4000-8000-000000000011"
      const skillCapabilityId = "20000000-0000-4000-8000-000000000012"
      const knowledgeBaseId = "60000000-0000-4000-8000-000000000001"
      let submittedBody: Record<string, unknown> | null = null
      const capability = (
        id: string,
        name: string,
        requiresCredentials: boolean,
        type: "plugin" | "skill" = "plugin"
      ) => ({
        id,
        name,
        slug: name,
        type,
        description: null,
        status: "active" as const,
        source_type: "local" as const,
        marketplace_listing_id: null,
        marketplace_release_id: null,
        logo_url: null,
        is_owner: true,
        can_manage: true,
        can_govern: true,
        has_logo: false,
        preference_status: "enabled" as const,
        manifest: {},
        risk_summary: {
          ...riskSummary,
          requires_credentials: requiresCredentials,
          declared_environment_keys: requiresCredentials ? ["API_KEY"] : [],
        },
        created_at: NOW,
        updated_at: NOW,
      })
      const builtInSkill = {
        ...capability(
          "builtin:capability:linksense-file-service",
          "linksense-file-service",
          false,
          "skill"
        ),
        source_type: "builtin" as const,
        builtin_key: "linksense-file-service",
        is_builtin: true,
        is_owner: false,
        can_manage: false,
        can_select: false,
        can_delete: false,
        created_at: null,
        updated_at: null,
      }
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), window.location.origin)
          const method = init?.method ?? "GET"
          if (url.pathname === "/api/v1/marketplace") {
            return Promise.resolve(envelope({ items: [], next_cursor: null }))
          }
          if (
            url.pathname === "/api/v1/applications/catalog" &&
            method === "GET"
          ) {
            return Promise.resolve(envelope({ items: [], next_cursor: null }))
          }
          if (url.pathname === "/api/v1/capabilities") {
            return Promise.resolve(
              envelope({
                items: [
                  builtInSkill,
                  capability(safeCapabilityId, "safe-plugin", false),
                  capability(credentialCapabilityId, "credential-plugin", true),
                  capability(skillCapabilityId, "dashi-ppt", false, "skill"),
                ],
                next_cursor: null,
              })
            )
          }
          if (url.pathname === "/api/v1/knowledge-bases") {
            return Promise.resolve(
              envelope({
                items: [
                  {
                    id: knowledgeBaseId,
                    name: "AISG Policy",
                    description: "内部制度知识库",
                    source_type: "local",
                    source_sync: null,
                    lifecycle_status: "active",
                    availability_status: "enabled",
                    owner: { id: PUBLISHER_ID, name: "发布者" },
                    is_owner: true,
                    access_sources: [{ type: "owner" }],
                    document_count: 1,
                    ready_document_count: 1,
                    storage_used_bytes: 1_024,
                    storage_reserved_bytes: 0,
                    storage_quota_bytes: 10_240,
                    permissions: {
                      view_content: true,
                      update: true,
                      manage_documents: true,
                      manage_grants: true,
                      create_grants: true,
                      revoke_grants: true,
                      archive: true,
                      restore: false,
                      delete: false,
                      remove_direct_share: false,
                    },
                    archived_at: null,
                    disabled_reason: null,
                    created_at: NOW,
                    updated_at: NOW,
                  },
                ],
                next_cursor: null,
              })
            )
          }
          if (url.pathname === "/api/v1/me/model-preference") {
            return Promise.resolve(
              envelope({
                configured: true,
                default_model: "model-a",
                selected_model: "model-a",
                selected_reasoning_effort: "medium",
                models: [
                  {
                    id: "model-a",
                    display_name: "Model A",
                    enabled: true,
                    context_window: null,
                    supported_reasoning_efforts: ["medium", "high"],
                    default_reasoning_effort: "medium",
                  },
                ],
              })
            )
          }
          if (url.pathname === "/api/v1/applications" && method === "POST") {
            submittedBody = JSON.parse(String(init?.body)) as Record<
              string,
              unknown
            >
            return Promise.resolve(
              envelope({
                id: applicationId,
                owner: { id: PUBLISHER_ID, name: "发布者" },
                name: "财务助手",
                icon: { type: "preset", preset: "graduation-cap" },
                description: null,
                instructions: "只回答内部财务制度。",
                model: null,
                reasoning_effort: null,
                status: "active",
                is_owner: true,
                can_manage: true,
                access_source: "owner",
                capability_count: 0,
                mcp_server_count: 0,
                knowledge_base_count: 0,
                dependencies_available: true,
                capabilities: [],
                mcp_servers: [],
                knowledge_bases: [],
                created_at: NOW,
                updated_at: NOW,
              })
            )
          }
          if (
            url.pathname === `/api/v1/applications/${applicationId}/publish` &&
            method === "POST"
          ) {
            return Promise.resolve(
              envelope({
                version_id: applicationId,
                version_number: "0.0.1",
                usage_instructions: "",
              })
            )
          }
          return Promise.resolve(envelope({ items: [], next_cursor: null }))
        }
      )
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      renderUserPage()

      const catalogTabs = await screen.findByRole("tablist", {
        name: "插件中心内容分类",
      })
      await interaction.click(
        within(catalogTabs).getByRole("tab", { name: "应用" })
      )
      const createApplicationButtons = await screen.findAllByRole("button", {
        name: "创建应用",
      })
      expect(createApplicationButtons).toHaveLength(1)
      await interaction.click(createApplicationButtons[0]!)

      const typeDialog = await screen.findByRole("dialog", { name: "创建应用" })
      const standardApplicationOption = within(typeDialog).getByRole("button", {
        name: /创建普通应用/u,
      })
      const interactiveApplicationOption = within(typeDialog).getByRole(
        "button",
        { name: /导入交互式应用/u }
      )
      const alternatives = typeDialog.querySelector(
        '[data-slot="application-creation-alternatives"]'
      )
      expect(alternatives).toHaveClass("flex-col")
      expect(alternatives).toContainElement(standardApplicationOption)
      expect(alternatives).toContainElement(interactiveApplicationOption)
      expect(standardApplicationOption).toHaveAccessibleDescription(
        i18n.t("applications.createStandardAppDescription")
      )
      expect(interactiveApplicationOption).toHaveAccessibleDescription(
        i18n.t("applications.importInteractiveAppDescription")
      )
      await interaction.click(standardApplicationOption)

      const dialog = await screen.findByRole("dialog", { name: "创建应用" })
      const dialogHeader = dialog.querySelector<HTMLElement>(
        '[data-slot="dialog-header"]'
      )
      const dialogBody = dialog.querySelector<HTMLElement>(
        '[data-slot="application-editor-body"]'
      )
      const dialogFooter = dialog.querySelector<HTMLElement>(
        '[data-slot="dialog-footer"]'
      )
      expect(dialogHeader).not.toBeNull()
      expect(dialogBody).not.toBeNull()
      expect(dialogFooter).not.toBeNull()
      expect(dialogBody).toHaveClass("overflow-y-auto")
      expect(dialogBody).not.toContainElement(dialogHeader)
      expect(dialogBody).not.toContainElement(dialogFooter)
      const leftColumn = dialog.querySelector<HTMLElement>(
        '[data-slot="application-editor-left"]'
      )
      const rightColumn = dialog.querySelector<HTMLElement>(
        '[data-slot="application-editor-right"]'
      )
      expect(leftColumn).not.toBeNull()
      expect(rightColumn).not.toBeNull()
      expect(leftColumn).toContainElement(
        within(dialog).getByRole("textbox", { name: "名称" })
      )
      expect(leftColumn).toContainElement(
        within(dialog).getByRole("combobox", { name: "状态" })
      )
      expect(rightColumn).toContainElement(
        within(dialog).getByRole("textbox", { name: "应用指令" })
      )
      expect(rightColumn).toContainElement(
        within(dialog).getByRole("combobox", { name: "插件" })
      )
      expect(rightColumn).toContainElement(
        within(dialog).getByRole("combobox", { name: "Skill" })
      )
      for (const fieldId of ["application-name", "application-instructions"]) {
        const label = dialog.querySelector<HTMLLabelElement>(
          `label[for="${fieldId}"]`
        )
        expect(label).not.toBeNull()
        expect(label?.querySelector('[aria-hidden="true"]')).toHaveTextContent(
          "*"
        )
      }
      expect(
        within(dialog).getByRole("textbox", { name: "名称" })
      ).toBeRequired()
      expect(
        within(dialog).getByRole("textbox", { name: "应用指令" })
      ).toBeRequired()
      expect(
        within(dialog).getByRole("textbox", { name: "应用指令" })
      ).toHaveClass("h-48", "max-h-48", "min-h-48", "overflow-y-auto")
      for (const fieldId of [
        "application-model",
        "application-reasoning-effort",
      ]) {
        const label = dialog.querySelector<HTMLLabelElement>(
          `label[for="${fieldId}"]`
        )
        expect(label).not.toBeNull()
        expect(label?.querySelector('[aria-hidden="true"]')).toBeNull()
      }
      expect(
        within(dialog).getByRole("combobox", { name: "模型" })
      ).not.toHaveAttribute("aria-required")
      expect(
        within(dialog).getByRole("combobox", { name: "推理强度" })
      ).not.toHaveAttribute("aria-required")
      expect(
        within(dialog).getByText(
          "不指定时，用户可以在聊天界面选择模型和推理强度。"
        )
      ).toBeVisible()
      expect(
        within(dialog).getByRole("textbox", { name: "说明" })
      ).not.toBeRequired()
      const selectedIconPreview = dialog.querySelector(
        '[data-slot="application-editor-left"] [data-slot="avatar"]'
      )
      expect(selectedIconPreview?.querySelector("svg")).toHaveClass("size-full")
      const iconPresetGroup = within(dialog).getByLabelText("内置应用图标")
      expect(iconPresetGroup).toHaveClass(
        "grid",
        "grid-cols-5",
        "sm:grid-cols-10"
      )
      expect(within(iconPresetGroup).getAllByRole("button")).toHaveLength(20)
      for (const label of [
        "机器人",
        "研究搜索",
        "知识库",
        "教育培训",
        "商务办公",
        "数据分析",
        "代码开发",
        "内容写作",
        "创意设计",
        "创新策划",
        "客户服务",
        "文档处理",
        "财务金融",
        "法律合规",
        "医疗健康",
        "安全风控",
        "流程自动化",
        "日程管理",
        "团队协作",
        "全球业务",
      ]) {
        expect(
          within(iconPresetGroup).getByRole("button", { name: label })
        ).toBeVisible()
      }
      const iconInput = within(dialog).getByLabelText("上传图片")
      await interaction.upload(
        iconInput,
        new File(
          [new Uint8Array(APPLICATION_ICON_MAX_BYTES + 1)],
          "oversized.png",
          { type: "image/png" }
        )
      )
      expect(
        within(dialog).getByText("请选择符合格式、体积和尺寸限制的图片。")
      ).toHaveAttribute("role", "alert")
      await interaction.click(
        within(dialog).getByRole("button", { name: "数据分析" })
      )
      expect(within(dialog).queryByRole("alert")).toBeNull()
      await interaction.type(
        within(dialog).getByRole("textbox", { name: "名称" }),
        "财务助手"
      )
      await interaction.type(
        within(dialog).getByRole("textbox", { name: "应用指令" }),
        "只回答内部财务制度。"
      )
      await interaction.click(
        within(dialog).getByRole("combobox", { name: "模型" })
      )
      expect(
        await screen.findByRole("option", { name: "由用户在聊天中选择" })
      ).toBeVisible()
      await interaction.click(
        await screen.findByRole("option", { name: "Model A" })
      )
      expect(
        within(dialog).getByRole("combobox", { name: "模型" })
      ).toHaveTextContent("Model A")
      expect(
        within(dialog).getByRole("combobox", { name: "推理强度" })
      ).toHaveTextContent("中")
      expect(
        within(dialog).getByRole("combobox", { name: "推理强度" })
      ).not.toHaveTextContent("medium")
      await interaction.click(
        within(dialog).getByRole("combobox", { name: "模型" })
      )
      await interaction.click(
        await screen.findByRole("option", { name: "由用户在聊天中选择" })
      )
      expect(
        within(dialog).getByRole("combobox", { name: "推理强度" })
      ).toBeDisabled()

      const pluginSelector = within(dialog).getByRole("combobox", {
        name: "插件",
      })
      const skillSelector = within(dialog).getByRole("combobox", {
        name: "Skill",
      })
      expect(pluginSelector).toHaveAttribute("placeholder", "选择插件…")
      expect(skillSelector).toHaveAttribute("placeholder", "选择 Skill…")

      await interaction.click(skillSelector)
      await interaction.type(skillSelector, "LinkSense")
      expect(
        screen.queryByRole("option", { name: /LinkSense 文件服务/u })
      ).toBeNull()
      expect(await screen.findByText("没有匹配的选项。")).toBeVisible()
      await interaction.keyboard("{Escape}")
      await interaction.clear(skillSelector)
      await interaction.click(skillSelector)
      await interaction.type(skillSelector, "dashi")
      const skillOption = await screen.findByRole("option", {
        name: /dashi-ppt/u,
      })
      expect(screen.queryByRole("option", { name: /safe-plugin/u })).toBeNull()
      await interaction.click(skillOption)
      expect(
        within(dialog).getByRole("button", { name: "移除 dashi-ppt" })
      ).toBeVisible()

      await interaction.click(pluginSelector)
      await interaction.type(pluginSelector, "dashi")
      expect(screen.queryByRole("option", { name: /dashi-ppt/u })).toBeNull()
      expect(await screen.findByText("没有匹配的选项。")).toBeVisible()
      await interaction.keyboard("{Escape}")
      await interaction.clear(pluginSelector)
      await interaction.click(pluginSelector)
      await interaction.type(pluginSelector, "safe")
      await interaction.click(
        await screen.findByRole("option", { name: /safe-plugin/u })
      )
      expect(
        within(dialog).getByRole("button", { name: "移除 safe-plugin" })
      ).toBeVisible()

      await interaction.clear(pluginSelector)
      await interaction.type(pluginSelector, "credential")
      const credentialPlugin = await screen.findByRole("option", {
        name: /credential-plugin/u,
      })
      expect(credentialPlugin).not.toHaveAttribute("aria-disabled", "true")
      expect(within(credentialPlugin).getByText("使用插件凭据")).toBeVisible()
      await interaction.click(credentialPlugin)
      expect(
        within(dialog).getByRole("button", { name: "移除 credential-plugin" })
      ).toBeVisible()

      const knowledgeBaseSelector = within(dialog).getByRole("combobox", {
        name: "知识库",
      })
      await interaction.click(knowledgeBaseSelector)
      await interaction.type(knowledgeBaseSelector, "AISG")
      await interaction.click(
        await screen.findByRole("option", { name: /AISG Policy/u })
      )
      expect(knowledgeBaseSelector).toHaveAttribute("aria-expanded", "false")
      expect(
        within(dialog).getByRole("button", { name: "移除 AISG Policy" })
      ).toBeVisible()

      await interaction.click(
        within(dialog).getByRole("button", { name: "创建" })
      )

      await waitFor(() => expect(submittedBody).not.toBeNull())
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "创建应用" })
        ).not.toBeInTheDocument()
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/applications/${applicationId}/publish`),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            version_number: "0.0.1",
            usage_instructions: "",
          }),
        })
      )
      expect(submittedBody).toMatchObject({
        name: "财务助手",
        instructions: "只回答内部财务制度。",
        model: null,
        reasoning_effort: null,
        capability_ids: [
          safeCapabilityId,
          credentialCapabilityId,
          skillCapabilityId,
        ],
        mcp_server_ids: [],
        knowledge_base_ids: [knowledgeBaseId],
        status: "active",
        icon: { type: "preset", preset: "chart-column" },
      })
      expect(submittedBody).not.toHaveProperty("public_access")
      expect(submittedBody).not.toHaveProperty("external_link")
    },
    APPLICATION_CREATION_TEST_TIMEOUT
  )

  it.each(["zh-CN", "en-US"])(
    "shows source radio choices and preserves a manual draft when switching sources in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(envelope({ items: [], next_cursor: null })))
      )
      const interaction = userEvent.setup()
      renderUserPageWithRouter("/capabilities?section=skill&scope=personal")
      await interaction.click(
        await screen.findByRole("button", {
          name: i18n.t("capability.addSkill"),
        })
      )
      const dialog = await screen.findByRole("dialog")
      const source = within(dialog).getByRole("radiogroup", {
        name: i18n.t("capability.source"),
      })
      expect(source).toHaveClass("flex", "flex-wrap", "gap-2")
      for (const option of within(source).getAllByRole("radio")) {
        expect(option.closest('[data-slot="radio-group-option"]')).toHaveClass(
          "w-auto",
          "rounded-xl",
          "border",
          "border-[var(--app-border)]"
        )
      }
      expect(within(source).getAllByRole("radio")).toHaveLength(2)
      expect(
        within(dialog).queryByRole("combobox", {
          name: i18n.t("capability.source"),
        })
      ).not.toBeInTheDocument()
      const local = within(source).getByRole("radio", {
        name: i18n.t("marketplace.importSources.local"),
      })
      const manual = within(source).getByRole("radio", {
        name: i18n.t("marketplace.importSources.manualSkill"),
      })
      expect(local).toBeChecked()
      expect(manual).not.toBeChecked()
      await interaction.click(manual)
      expect(manual).toBeChecked()
      expect(local).not.toBeChecked()
      const instructions = within(dialog).getByLabelText(
        i18n.t("marketplace.skillMarkdown")
      )
      await interaction.click(instructions)
      await interaction.paste("# Saved draft")
      await interaction.click(local)
      expect(
        within(dialog).getByLabelText(i18n.t("marketplace.zipSkillPackage"))
      ).toBeVisible()
      await interaction.keyboard("{ArrowRight}")
      expect(manual).toBeChecked()
      expect(
        within(dialog).getByLabelText(i18n.t("marketplace.skillMarkdown"))
      ).toHaveValue("# Saved draft")
    }
  )

  it.each(["zh-CN", "en-US"])(
    "allows manual skill fields to grow within limits and shows name rules in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(envelope({ items: [], next_cursor: null })))
      )
      const interaction = userEvent.setup()
      renderUserPageWithRouter("/capabilities?section=skill&scope=personal")

      await interaction.click(
        await screen.findByRole("button", {
          name: i18n.t("capability.addSkill"),
        })
      )
      const dialog = await screen.findByRole("dialog")
      expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]", "overflow-y-auto")
      await interaction.click(
        within(dialog).getByRole("radio", {
          name: i18n.t("marketplace.importSources.manualSkill"),
        })
      )

      const nameInput = within(dialog).getByRole("textbox", {
        name: i18n.t("marketplace.skillIdentifier"),
      })
      const hint = within(dialog).getByText(i18n.t("marketplace.skillNameHint"))
      expect(hint).toBeVisible()
      expect(nameInput).toHaveAccessibleDescription(hint.textContent ?? "")
      expect(
        nameInput.compareDocumentPosition(hint) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(nameInput).toHaveAttribute("maxlength", "64")
      await interaction.click(nameInput)
      await interaction.paste("a".repeat(65))
      expect(nameInput).toHaveValue("a".repeat(64))

      const fields = [
        {
          label: i18n.t("common.description"),
          minHeight: "min-h-16",
          maxHeight: "max-h-40",
          content: "Skill description\n".repeat(100),
        },
        {
          label: i18n.t("marketplace.skillMarkdown"),
          minHeight: "min-h-56",
          maxHeight: "max-h-96",
          content: "# Skill instructions\n".repeat(300),
        },
      ]
      for (const { label, minHeight, maxHeight, content } of fields) {
        const field = within(dialog).getByRole("textbox", { name: label })
        await interaction.click(field)
        await interaction.paste(content)

        expect(field).toHaveValue(content)
        expect(field).toHaveClass(
          minHeight,
          maxHeight,
          "field-sizing-content",
          "overflow-y-auto",
          "resize-none"
        )
        expect(field).not.toHaveClass("field-sizing-fixed", "h-16", "h-56")
        await interaction.clear(field)
        expect(field).toHaveValue("")
        expect(field).toHaveClass(minHeight, maxHeight, "field-sizing-content")
      }
    }
  )

  it.each(["zh-CN", "en-US"])(
    "validates manual Skill fields immediately and shows errors below the inputs in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const fetchMock = vi.fn<typeof fetch>(() =>
        Promise.resolve(envelope({ items: [], next_cursor: null }))
      )
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      renderUserPageWithRouter("/capabilities?section=skill&scope=personal")
      const openManualForm = async () => {
        await interaction.click(
          await screen.findByRole("button", {
            name: i18n.t("capability.addSkill"),
          })
        )
        const dialog = await screen.findByRole("dialog")
        await interaction.click(
          within(dialog).getByRole("radio", {
            name: i18n.t("marketplace.importSources.manualSkill"),
          })
        )
        return dialog
      }
      const dialog = await openManualForm()
      const identifier = within(dialog).getByRole("textbox", {
        name: i18n.t("marketplace.skillIdentifier"),
      })
      const display = within(dialog).getByRole("textbox", {
        name: i18n.t("marketplace.skillDisplayName"),
      })
      const preview = within(dialog).getByRole("button", {
        name: i18n.t("capability.previewSubmit"),
      })
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
      await interaction.click(identifier)
      await interaction.tab()
      expect(identifier).toHaveAccessibleDescription(
        i18n.t("marketplace.skillNameRequired")
      )
      await interaction.click(
        within(dialog).getByRole("textbox", {
          name: i18n.t("marketplace.skillMarkdown"),
        })
      )
      await interaction.paste("# Instructions")

      for (const value of [
        "ppt-se你好",
        "ppt se",
        "Ppt",
        "ppt_se",
        "-ppt",
        "ppt-",
        "ppt--se",
        "ppt/se",
      ]) {
        await interaction.clear(identifier)
        await interaction.click(identifier)
        await interaction.paste(value)
        expect(identifier).toHaveFocus()
        expect(identifier).toHaveAttribute("aria-invalid", "true")
        expect(identifier).toHaveAttribute(
          "aria-describedby",
          "capability-name-error"
        )
        expect(identifier).toHaveAccessibleDescription(
          i18n.t("marketplace.skillNameInvalid")
        )
        const error = within(dialog).getByRole("alert")
        expect(error).toHaveTextContent(i18n.t("marketplace.skillNameInvalid"))
        expect(
          identifier.compareDocumentPosition(error) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()
        expect(preview).toBeDisabled()
        await interaction.click(preview)
        await interaction.clear(identifier)
        await interaction.paste("ppt-se")
        expect(identifier).not.toHaveAttribute("aria-invalid", "true")
        expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
        expect(preview).toBeEnabled()
      }

      fireEvent.change(identifier, { target: { value: "a".repeat(65) } })
      expect(identifier).toHaveAccessibleDescription(
        i18n.t("marketplace.skillNameTooLong")
      )
      expect(preview).toBeDisabled()
      fireEvent.change(identifier, { target: { value: "linksense-docs" } })
      expect(identifier).toHaveAccessibleDescription(
        i18n.t("marketplace.skillNameReserved")
      )
      expect(preview).toBeDisabled()
      fireEvent.change(identifier, { target: { value: "ppt-se" } })

      for (const value of ["bad\u0007name", "a".repeat(65)]) {
        fireEvent.change(display, { target: { value } })
        expect(display).toHaveAttribute("aria-invalid", "true")
        expect(display).toHaveAccessibleDescription(
          i18n.t("errors.importReasons.skill_display_name_invalid")
        )
        const error = within(dialog).getByRole("alert")
        expect(
          display.compareDocumentPosition(error) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()
        expect(preview).toBeDisabled()
      }
      for (const value of ["中文 展示名称", "", "   "]) {
        fireEvent.change(display, { target: { value } })
        expect(display).not.toHaveAttribute("aria-invalid", "true")
        expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
        expect(preview).toBeEnabled()
      }
      await interaction.clear(identifier)
      expect(identifier).toHaveAccessibleDescription(
        i18n.t("marketplace.skillNameRequired")
      )
      expect(preview).toBeDisabled()
      expect(
        fetchMock.mock.calls.some(([, options]) => options?.method === "POST")
      ).toBe(false)
      await interaction.click(
        within(dialog).getByRole("button", { name: i18n.t("common.cancel") })
      )
      const reopened = await openManualForm()
      expect(within(reopened).queryByRole("alert")).not.toBeInTheDocument()
      expect(
        within(reopened).getByRole("textbox", {
          name: i18n.t("marketplace.skillIdentifier"),
        })
      ).toHaveValue("")
    }
  )

  it("falls back to Chinese name rules when the English resource is missing", () => {
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    expect(fallback.t("marketplace.skillNameHint", { lng: "en-US" })).toBe(
      "名称为 1–64 个字符，仅支持小写英文字母、数字和连字符（-）；连字符不能位于开头或结尾，也不能连续使用。请勿使用系统内置技能名称。例如：my-skill。"
    )
    for (const key of [
      "skillIdentifier",
      "skillDisplayName",
      "skillDisplayNameHint",
      "skillNameRequired",
      "skillNameTooLong",
      "skillNameInvalid",
      "skillNameReserved",
    ]) {
      expect(fallback.t(`marketplace.${key}`, { lng: "en-US" })).toBe(
        i18n.t(`marketplace.${key}`, { lng: "zh-CN" })
      )
    }
  })

  it.each([
    ["zh-CN", "automatic", "Meeting Notes Daily"],
    ["en-US", "automatic", "Meeting Notes Daily"],
    ["zh-CN", "custom", "会议纪要助手"],
    ["en-US", "custom", "My Meeting Notes"],
    ["zh-CN", "blank", null],
    ["en-US", "blank", null],
  ])(
    "submits %s manual display names in %s mode without changing the identifier",
    async (language, mode, expectedName) => {
      await i18n.changeLanguage(language ?? "zh-CN")
      let submittedBody: unknown
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), window.location.origin)
          if (
            url.pathname === "/api/v1/capabilities" &&
            init?.method === "POST"
          ) {
            submittedBody = JSON.parse(String(init.body))
            return Promise.resolve(
              envelope({
                preview_token: "manual-preview",
                expires_at: NOW,
                operation: "install",
                capability_id: null,
                source: {
                  source_type: "local",
                  import_kind: "manual_skill",
                  source_url: null,
                  filename: null,
                },
                type: "skill",
                name: "meeting-notes-daily",
                display_name: expectedName,
                description: null,
                manifest: {},
                declared_capabilities: [],
                declared_environment_keys: [],
                risk_summary: riskSummary,
                has_logo: false,
                skill_content_preview: "# Instructions",
                skill_content_truncated: false,
              })
            )
          }
          return Promise.resolve(envelope({ items: [], next_cursor: null }))
        })
      )
      const interaction = userEvent.setup()
      renderUserPageWithRouter("/capabilities?section=skill&scope=personal")
      await interaction.click(
        await screen.findByRole("button", {
          name: i18n.t("capability.addSkill"),
        })
      )
      const dialog = await screen.findByRole("dialog")
      await interaction.click(
        within(dialog).getByRole("radio", {
          name: i18n.t("marketplace.importSources.manualSkill"),
        })
      )
      const identifier = within(dialog).getByRole("textbox", {
        name: i18n.t("marketplace.skillIdentifier"),
      })
      const display = within(dialog).getByRole("textbox", {
        name: i18n.t("marketplace.skillDisplayName"),
      })
      expect(
        identifier.compareDocumentPosition(display) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(display).not.toBeRequired()
      expect(display).toHaveAttribute("maxlength", "64")
      await interaction.click(identifier)
      await interaction.paste("meeting-notes")
      expect(display).toHaveValue("Meeting Notes")
      if (mode !== "automatic") {
        await interaction.clear(display)
        if (expectedName) await interaction.paste(expectedName)
      }
      await interaction.click(identifier)
      await interaction.paste("-daily")
      expect(display).toHaveValue(expectedName ?? "")
      await interaction.click(
        within(dialog).getByRole("textbox", {
          name: i18n.t("marketplace.skillMarkdown"),
        })
      )
      await interaction.paste("# Instructions")
      await interaction.click(
        within(dialog).getByRole("button", {
          name: i18n.t("capability.previewSubmit"),
        })
      )
      expect(
        await within(dialog).findByRole("heading", {
          name: expectedName || "Meeting Notes Daily",
        })
      ).toBeVisible()
      expect(submittedBody).toMatchObject({
        name: "meeting-notes-daily",
        display_name: expectedName,
        skill_markdown: "# Instructions",
      })
      await interaction.click(
        within(dialog).getByRole("button", { name: i18n.t("common.cancel") })
      )
      await interaction.click(
        await screen.findByRole("button", {
          name: i18n.t("capability.addSkill"),
        })
      )
      const reopened = await screen.findByRole("dialog")
      await interaction.click(
        within(reopened).getByRole("radio", {
          name: i18n.t("marketplace.importSources.manualSkill"),
        })
      )
      const nextIdentifier = within(reopened).getByRole("textbox", {
        name: i18n.t("marketplace.skillIdentifier"),
      })
      expect(nextIdentifier).toHaveValue("")
      await interaction.click(nextIdentifier)
      await interaction.paste("new-skill")
      expect(
        within(reopened).getByRole("textbox", {
          name: i18n.t("marketplace.skillDisplayName"),
        })
      ).toHaveValue("New Skill")
    }
  )

  it.each(["zh-CN", "en-US"])(
    "constrains long publication source labels in %s without losing selection",
    async (language) => {
      await i18n.changeLanguage(language)
      const displayName = "Expense Review Skill 费用报销检查"
      const capability = {
        id: CAPABILITY_ID,
        name: "expense-review",
        display_name: displayName,
        slug: "expense-review",
        can_delete: true,
        type: "skill",
        description: "Review employee expenses",
        status: "active",
        source_type: "local",
        marketplace_listing_id: null,
        marketplace_release_id: null,
        logo_url: null,
        has_logo: false,
        manifest: {},
        risk_summary: riskSummary,
        preference_status: "enabled",
        can_manage: true,
        can_govern: true,
        is_owner: true,
        created_at: NOW,
        updated_at: NOW,
      }
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = new URL(String(input), window.location.origin)
          return Promise.resolve(
            envelope({
              items:
                url.pathname === "/api/v1/capabilities" ? [capability] : [],
              next_cursor: null,
            })
          )
        })
      )
      const interaction = userEvent.setup()
      renderUserPageWithRouter("/capabilities?section=skill&scope=personal")
      const personalCatalog = await screen.findByRole("region", {
        name: i18n.t("marketplace.personalCatalogLabel", {
          category: i18n.t("marketplace.catalogTabs.skill"),
        }),
      })
      const personalItem = await within(personalCatalog).findByRole("article", {
        name: displayName,
      })
      await interaction.click(
        within(personalItem).getByRole("button", {
          name: i18n.t("common.actions"),
        })
      )
      await interaction.click(
        await screen.findByRole("menuitem", {
          name: i18n.t("marketplace.applyForListing"),
        })
      )
      const dialog = await screen.findByRole("dialog", {
        name: i18n.t("marketplace.publishNew"),
      })
      const source = within(dialog).getByLabelText(
        i18n.t("marketplace.sourceCapability")
      )
      const label = `${displayName} · Skill · ${i18n.t("capability.sourceTypes.local")}`
      expect(source.closest('[data-slot="field"]')).toHaveClass("min-w-0")
      expect(source).toHaveClass("w-full", "min-w-0")
      expect(source.querySelector('[data-slot="select-value"]')).toHaveClass(
        "min-w-0"
      )
      expect(within(source).getByTitle(label)).toHaveClass("truncate")
      expect(source).toHaveTextContent(label)
      expect(
        within(dialog).getByRole("button", {
          name: i18n.t("marketplace.submitForReview"),
        })
      ).toBeEnabled()
      await interaction.click(source)
      expect(
        await screen.findByRole("option", { name: label })
      ).toHaveAttribute("aria-selected", "true")
    }
  )

  it("shows a persistent three-dot action menu with icons and submits a listing request", async () => {
    const capability = {
      id: CAPABILITY_ID,
      name: "frontend-slides",
      slug: "frontend-slides",
      type: "skill" as const,
      description: "Create animation-rich presentations",
      status: "active" as const,
      source_type: "local" as const,
      marketplace_listing_id: null,
      marketplace_release_id: null,
      logo_url: null,
      has_logo: false,
      manifest: {},
      risk_summary: riskSummary,
      preference_status: "enabled" as const,
      can_manage: true,
      can_govern: true,
      is_owner: true,
      created_at: NOW,
      updated_at: NOW,
    }
    const pendingListing = {
      ...listing,
      slug: capability.slug,
      status: "draft" as const,
      current_release_id: null,
    }
    const pendingRelease = {
      ...release,
      listing_id: pendingListing.id,
      status: "pending" as const,
      name: capability.name,
      description: capability.description,
      reviewer_id: null,
      reviewed_at: null,
      published_at: null,
    }
    const pendingPublication = {
      listing: pendingListing,
      current_release: null,
      latest_release: pendingRelease,
      install_count: 0,
    }
    const importPreview = {
      preview_token: "preview-token",
      expires_at: NOW,
      operation: "install" as const,
      capability_id: null,
      source: {
        source_type: "local" as const,
        import_kind: "zip" as const,
        source_url: null,
        filename: "uploaded-skill.zip",
      },
      type: "skill" as const,
      name: "Uploaded Skill",
      description: "Uploaded skill preview",
      manifest: {},
      declared_capabilities: [],
      declared_environment_keys: [],
      risk_summary: riskSummary,
      has_logo: false,
      skill_content_preview: "# Uploaded Skill",
      skill_content_truncated: false,
    }
    let resolveConfirm!: (response: Response) => void
    const confirmRequest = new Promise<Response>((resolve) => {
      resolveConfirm = resolve
    })
    let submitted = false
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (url.pathname === "/api/v1/marketplace" && method === "GET") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        url.pathname === "/api/v1/capabilities" &&
        url.searchParams.get("view") === "managed" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({ items: [capability], next_cursor: null })
        )
      }
      if (
        url.pathname === "/api/v1/capabilities/imports/preview-token/confirm" &&
        method === "POST"
      ) {
        return confirmRequest
      }
      if (url.pathname === `/api/v1/capabilities/${CAPABILITY_ID}/skill-edit`) {
        return Promise.resolve(
          envelope({
            name: capability.name,
            display_name: null,
            description: capability.description,
            content: "# Current instructions",
            revision: "a".repeat(64),
            files: [{ path: "SKILL.md", size_bytes: 100 }],
          })
        )
      }
      if (url.pathname === "/api/v1/marketplace/mine" && method === "GET") {
        return Promise.resolve(
          envelope({
            items: submitted ? [pendingPublication] : [],
            next_cursor: null,
          })
        )
      }
      if (url.pathname === "/api/v1/application-center/mine")
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      if (
        url.pathname === "/api/v1/marketplace/submissions" &&
        method === "POST"
      ) {
        submitted = true
        return Promise.resolve(envelope(pendingPublication))
      }
      return Promise.resolve(envelope(null))
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("XMLHttpRequest", ControllableUploadRequest)
    const interaction = userEvent.setup()
    renderUserPage()

    const catalogTabs = await screen.findByRole("tablist", {
      name: "插件中心内容分类",
    })
    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "技能" })
    )
    await interaction.click(
      within(screen.getByLabelText("内容范围")).getByRole("button", {
        name: "个人",
      })
    )
    const personalCatalog = await screen.findByRole("region", {
      name: "个人技能",
    })
    expect(
      within(personalCatalog).getByRole("article", {
        name: "Frontend Slides",
      })
    ).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "添加技能" }))
    const importDialog = await screen.findByRole("dialog", {
      name: "添加技能",
    })
    const importSource = within(importDialog).getByRole("radiogroup", {
      name: "来源",
    })
    expect(importSource).toHaveTextContent("本地 ZIP 包")
    expect(
      within(importDialog).queryByLabelText("类型")
    ).not.toBeInTheDocument()
    expect(within(importDialog).queryByText("插件")).not.toBeInTheDocument()
    expect(within(importDialog).queryByText(/^local$/u)).not.toBeInTheDocument()
    expect(within(importDialog).queryByText(/^skill$/u)).not.toBeInTheDocument()
    expect(
      within(importSource).getByRole("radio", { name: "本地 ZIP 包" })
    ).toBeChecked()
    expect(
      within(importSource).getByRole("radio", { name: "手动创建 Skill" })
    ).toBeVisible()
    expect(
      within(importSource).queryByRole("radio", { name: "URL 插件/Skill 包" })
    ).not.toBeInTheDocument()
    expect(within(importSource).getAllByRole("radio")).toHaveLength(2)

    await interaction.upload(
      within(importDialog).getByLabelText("ZIP 技能包"),
      new File(["skill archive"], "uploaded-skill.zip", {
        type: "application/zip",
      })
    )
    const previewButton = within(importDialog).getByRole("button", {
      name: "检查来源与风险",
    })
    await interaction.click(previewButton)
    expect(previewButton).toBeDisabled()
    expect(previewButton).toHaveAttribute("aria-busy", "true")
    expect(previewButton.querySelector('[data-slot="spinner"]')).not.toBeNull()
    for (const option of within(importSource).getAllByRole("radio")) {
      expect(option).toHaveAttribute("aria-disabled", "true")
    }
    await interaction.click(
      within(importSource).getByRole("radio", { name: "手动创建 Skill" })
    )
    expect(
      within(importSource).getByRole("radio", { name: "本地 ZIP 包" })
    ).toBeChecked()
    expect(within(importDialog).getByLabelText("ZIP 技能包")).toBeVisible()

    const uploadRequest = ControllableUploadRequest.latest
    expect(uploadRequest).not.toBeNull()
    act(() => uploadRequest?.emitUploadProgress(35, 100))
    expect(within(importDialog).getByText("正在上传")).toBeVisible()
    expect(within(importDialog).getByText("35%")).toBeVisible()

    act(() => uploadRequest?.emitUploadProgress(100, 100))
    expect(within(importDialog).getByText("上传完成，正在解析…")).toBeVisible()

    act(() => uploadRequest?.resolve({ success: true, data: importPreview }))
    const confirmButton = await within(importDialog).findByRole("button", {
      name: "确认安装",
    })
    await interaction.click(within(importDialog).getByRole("checkbox"))
    await interaction.click(confirmButton)
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "添加技能" })
      ).not.toBeInTheDocument()
    })
    const importLoading = await screen.findByText("正在导入技能…")
    expect(importLoading.closest("[data-sonner-toast]")).not.toBeNull()

    resolveConfirm(envelope(capability))
    expect(await screen.findByText("技能已安装")).toBeVisible()

    const personalItem = within(personalCatalog).getByRole("article", {
      name: "Frontend Slides",
    })
    const actionTrigger = within(personalItem).getByRole("button", {
      name: "操作",
    })
    expect(actionTrigger.querySelector("svg")).not.toBeNull()
    await interaction.click(actionTrigger)

    const actionMenu = await screen.findByRole("menu")
    expect(actionMenu).toHaveClass("w-max", "min-w-40")
    expect(
      actionMenu.querySelector('[data-slot="dropdown-menu-group"]')
    ).not.toBeNull()

    const menuLabels = ["仅为我停用", "更新个人技能", "申请上架", "卸载"]
    for (const label of menuLabels) {
      const item = await screen.findByRole("menuitem", { name: label })
      expect(item.querySelector("svg")).not.toBeNull()
      expect(item).toHaveClass("whitespace-nowrap")
    }

    await interaction.click(
      screen.getByRole("menuitem", { name: "更新个人技能" })
    )
    const updateDialog = await screen.findByRole("dialog", {
      name: "更新个人技能",
    })
    expect(await within(updateDialog).findByLabelText("技能正文")).toHaveValue(
      "# Current instructions"
    )
    expect(within(updateDialog).getByLabelText("技能标识")).toHaveValue(
      "frontend-slides"
    )
    expect(within(updateDialog).getByLabelText("技能标识")).toHaveAttribute(
      "readonly"
    )
    expect(
      within(updateDialog).queryByLabelText("类型")
    ).not.toBeInTheDocument()
    await interaction.click(
      within(updateDialog).getByRole("button", { name: "关闭" })
    )
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "更新个人技能" })
      ).not.toBeInTheDocument()
    })

    await interaction.click(
      within(personalItem).getByRole("button", { name: "操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "申请上架" })
    )
    expect(
      await screen.findByRole("heading", { name: "申请上架新插件/技能" })
    ).toBeVisible()
    const publishSource = screen.getByLabelText("个人插件/技能来源")
    expect(publishSource).toHaveTextContent(
      "Frontend Slides · Skill · 本地导入"
    )
    expect(publishSource).not.toHaveTextContent(CAPABILITY_ID)
    await interaction.type(screen.getByLabelText("发布说明"), "首次申请上架")
    await interaction.click(screen.getByRole("button", { name: "提交审核" }))

    await waitFor(() => {
      const submission = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname === "/api/v1/marketplace/submissions" &&
          init?.method === "POST"
        )
      })
      expect(submission).toBeDefined()
      expect(JSON.parse(String(submission?.[1]?.body))).toEqual({
        capability_id: CAPABILITY_ID,
        release_notes: "首次申请上架",
      })
    })
    const publishNotification =
      await screen.findByText("发布快照已提交管理员审核")
    expect(publishNotification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(publishNotification.closest('[data-slot="alert"]')).toBeNull()

    await interaction.click(screen.getByRole("button", { name: "我的发布" }))
    const reviewPolicyNotice = await screen.findByRole("status")
    expect(reviewPolicyNotice).not.toHaveTextContent(
      "发布快照已提交管理员审核。"
    )
    expect(reviewPolicyNotice).toHaveTextContent(
      "每一个新发布都必须重新审核；审核通过后不会自动更新已有安装。"
    )
    expect(reviewPolicyNotice).not.toHaveTextContent(
      "管理员可以审核自己提交的内容"
    )
    expect(screen.getAllByRole("status")).toHaveLength(1)

    const publicationCard = await screen.findByRole("article", {
      name: "Frontend Slides",
    })
    expect(publicationCard).toHaveTextContent(capability.description)
    expect(publicationCard).toHaveTextContent("待审核")
    expect(publicationCard).not.toHaveTextContent("草稿")
    expect(publicationCard).toHaveTextContent("已安装 0 次")
    expect(publicationCard).toHaveClass(
      "capability-library-row",
      "capability-library-row-detailed"
    )
    expect(publicationCard.parentElement).toHaveClass("capability-library-grid")
    expect(
      within(publicationCard).getByText(capability.description)
    ).toHaveClass("capability-library-description")
    expect(publicationCard.querySelector('[data-slot="card"]')).toBeNull()
    expect(publicationCard.querySelector('[data-slot="separator"]')).toBeNull()
    expect(
      within(publicationCard).getByText("待审核").closest("div")
    ).toHaveClass("capability-library-tail-status-top-right")

    const publicationActionTrigger = within(publicationCard).getByRole(
      "button",
      { name: "操作" }
    )
    expect(publicationActionTrigger.querySelector("svg")).not.toBeNull()
    await interaction.click(publicationActionTrigger)
    const publicationMenu = await screen.findByRole("menu")
    expect(publicationMenu).toHaveClass("w-max", "min-w-32")
    expect(
      publicationMenu.querySelector('[data-slot="dropdown-menu-group"]')
    ).not.toBeNull()
    for (const action of ["查看", "撤回审核"]) {
      const menuItem = screen.getByRole("menuitem", {
        name: action,
      })
      expect(menuItem).toHaveClass("whitespace-nowrap")
      expect(menuItem.querySelector("svg")).not.toBeNull()
    }
  })

  it("allows confirming an import without consulting retired scan metadata", async () => {
    const importPreview = {
      preview_token: "blocked-preview-token",
      expires_at: NOW,
      operation: "install" as const,
      capability_id: null,
      source: {
        source_type: "local" as const,
        import_kind: "zip" as const,
        source_url: null,
        filename: "blocked-skill.zip",
      },
      type: "skill" as const,
      name: "example-skill",
      description: "Example package",
      manifest: {},
      declared_capabilities: [],
      declared_environment_keys: [],
      risk_summary: retiredScanRiskSummary,
      has_logo: false,
      skill_content_preview: "# Blocked Skill",
      skill_content_truncated: false,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (url.pathname === "/api/v1/marketplace" && method === "GET") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        url.pathname === "/api/v1/capabilities" &&
        url.searchParams.get("view") === "managed" &&
        method === "GET"
      ) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      return Promise.resolve(envelope(null))
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("XMLHttpRequest", ControllableUploadRequest)
    const interaction = userEvent.setup()
    renderUserPage()

    const catalogTabs = await screen.findByRole("tablist", {
      name: "插件中心内容分类",
    })
    await interaction.click(
      within(catalogTabs).getByRole("tab", { name: "技能" })
    )
    await interaction.click(screen.getByRole("button", { name: "添加技能" }))
    const dialog = await screen.findByRole("dialog", { name: "添加技能" })
    await interaction.upload(
      within(dialog).getByLabelText("ZIP 技能包"),
      new File(["archive"], "blocked-skill.zip", {
        type: "application/zip",
      })
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: "检查来源与风险" })
    )
    act(() =>
      ControllableUploadRequest.latest?.resolve({
        success: true,
        data: importPreview,
      })
    )

    const confirm = await within(dialog).findByRole("button", {
      name: "确认安装",
    })
    expect(within(dialog).queryByText("已阻止")).not.toBeInTheDocument()
    await interaction.click(within(dialog).getByRole("checkbox"))
    expect(confirm).toBeEnabled()
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname.includes("blocked-preview-token") &&
          init?.method === "POST"
        )
      })
    ).toBe(false)
  })

  it.each(["zh-CN", "en-US"])(
    "combines application and Skill reviews and keeps application listing management in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      let currentApplication = { ...applicationRelease }
      const olderApplication = {
        ...applicationRelease,
        id: "40000000-0000-4000-8000-000000000009",
        version_number: "0.9.0",
        status: "approved",
      }
      const skillPublication = {
        listing,
        current_release: release,
        latest_release: { ...release, status: "pending" },
        install_count: 1,
      }
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input), window.location.origin).pathname
          if (
            path === `/api/v1/admin/application-center/${RELEASE_ID}/review` &&
            init?.method === "POST"
          ) {
            currentApplication = {
              ...currentApplication,
              status: "approved",
              listing_status: "published",
            }
            return Promise.resolve(envelope(null))
          }
          if (
            path ===
              `/api/v1/admin/application-center/applications/${CAPABILITY_ID}/status` &&
            init?.method === "PATCH"
          ) {
            currentApplication = {
              ...currentApplication,
              listing_status: "suspended",
            }
            return Promise.resolve(envelope(null))
          }
          if (path === "/api/v1/admin/application-center") {
            return Promise.resolve(
              envelope({
                items: [currentApplication, olderApplication],
                next_cursor: null,
              })
            )
          }
          if (path === `/api/v1/admin/application-center/${RELEASE_ID}`) {
            return Promise.resolve(
              envelope({
                release: currentApplication,
                instructions: "Review the research instructions",
                capabilities: [],
                knowledge_base_count: 0,
                mcp_server_count: 0,
                interactive_files: [],
              })
            )
          }
          return Promise.resolve(
            envelope({ items: [skillPublication], next_cursor: null })
          )
        }
      )
      vi.stubGlobal("fetch", fetchMock)
      renderAdminPage()
      expect(screen.getAllByRole("tab")).toHaveLength(2)
      const application = await screen.findByRole("article", {
        name: applicationRelease.name,
      })
      const skill = await screen.findByRole("article", { name: release.name })
      expect(application.closest('[data-slot="card"]')).toBe(
        skill.closest('[data-slot="card"]')
      )
      expect(within(application).queryByText("v0.9.0")).not.toBeInTheDocument()
      expect(
        screen.queryByText(
          i18n.t("marketplace.reviewsEmpty").replace(/[。.]+$/u, "")
        )
      ).not.toBeInTheDocument()
      await userEvent.click(
        within(application).getByRole("button", {
          name: i18n.t("applications.distribution.review"),
        })
      )
      const reviewDialog = await screen.findByRole("dialog")
      await userEvent.click(
        await within(reviewDialog).findByRole("button", {
          name: i18n.t("applications.distribution.approve"),
        })
      )
      await waitFor(() =>
        expect(
          screen.queryByRole("article", { name: applicationRelease.name })
        ).not.toBeInTheDocument()
      )
      expect(screen.getByRole("article", { name: release.name })).toBeVisible()
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          `/admin/application-center/${RELEASE_ID}/review`
        ),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ decision: "approved", comment: "" }),
        })
      )

      await userEvent.click(
        screen.getByRole("tab", { name: i18n.t("marketplace.tabs.listings") })
      )
      const listingRow = await screen.findByRole("article", {
        name: applicationRelease.name,
      })
      expect(
        screen.getAllByRole("article", { name: applicationRelease.name })
      ).toHaveLength(1)
      expect(within(listingRow).getByText("v1.0.0")).toBeVisible()
      expect(
        within(listingRow).getByText(i18n.t("marketplace.status.published"))
      ).toBeVisible()
      await userEvent.click(
        within(listingRow).getByRole("button", {
          name: i18n.t("marketplace.manageApplicationListing"),
        })
      )
      const managementDialog = await screen.findByRole("dialog")
      await userEvent.type(
        within(managementDialog).getByLabelText(
          i18n.t("applications.distribution.reviewComment")
        ),
        "Needs review"
      )
      await userEvent.click(
        await within(managementDialog).findByRole("button", {
          name: i18n.t("applications.distribution.suspend"),
        })
      )
      expect(
        await within(listingRow).findByText(
          i18n.t("marketplace.status.unlisted")
        )
      ).toBeVisible()
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          `/admin/application-center/applications/${CAPABILITY_ID}/status`
        ),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "suspended", reason: "Needs review" }),
        })
      )
    }
  )

  it("keeps pending applications visible when the Skill review queue is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return Promise.resolve(
          envelope({
            items:
              path === "/api/v1/admin/application-center"
                ? [applicationRelease]
                : [],
            next_cursor: null,
          })
        )
      })
    )
    renderAdminPage()
    expect(
      await screen.findByRole("article", { name: applicationRelease.name })
    ).toBeVisible()
    expect(
      screen.queryByText(
        i18n.t("marketplace.reviewsEmpty").replace(/[。.]+$/u, "")
      )
    ).not.toBeInTheDocument()
  })

  it("waits for both review sources before showing the shared empty state", async () => {
    let finishApplications: ((response: Response) => void) | undefined
    const applicationResponse = new Promise<Response>((resolve) => {
      finishApplications = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return path === "/api/v1/admin/application-center"
          ? applicationResponse
          : Promise.resolve(envelope({ items: [], next_cursor: null }))
      })
    )
    renderAdminPage()
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(
      screen.queryByText(
        i18n.t("marketplace.reviewsEmpty").replace(/[。.]+$/u, "")
      )
    ).not.toBeInTheDocument()
    await act(async () =>
      finishApplications?.(envelope({ items: [], next_cursor: null }))
    )
    expect(
      await screen.findByText(
        i18n.t("marketplace.reviewsEmpty").replace(/[。.]+$/u, "")
      )
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole("tab", { name: i18n.t("marketplace.tabs.listings") })
    )
    expect(
      await screen.findByText(
        i18n.t("marketplace.listingsEmpty").replace(/[。.]+$/u, "")
      )
    ).toBeVisible()
  })

  it("retains Skill reviews when application loading fails and retries the application query", async () => {
    let failed = true
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (path === "/api/v1/admin/application-center") {
          if (failed) return Promise.reject(new Error("Unavailable"))
          return Promise.resolve(
            envelope({ items: [applicationRelease], next_cursor: null })
          )
        }
        return Promise.resolve(
          envelope({
            items: [
              {
                listing,
                current_release: release,
                latest_release: { ...release, status: "pending" },
                install_count: 0,
              },
            ],
            next_cursor: null,
          })
        )
      })
    )
    renderAdminPage()
    expect(
      await screen.findByRole("article", { name: release.name })
    ).toBeVisible()
    const retry = await screen.findByRole("button", {
      name: i18n.t("common.retry"),
    })
    expect(
      screen.queryByText(
        i18n.t("marketplace.reviewsEmpty").replace(/[。.]+$/u, "")
      )
    ).not.toBeInTheDocument()
    failed = false
    await userEvent.click(retry)
    expect(
      await screen.findByRole("article", { name: applicationRelease.name })
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: i18n.t("common.retry") })
    ).not.toBeInTheDocument()
  })

  it.each([
    ["zh-CN", "draft", "rejected", "未通过"],
    ["en-US", "draft", "rejected", "Not approved"],
    ["zh-CN", "draft", "pending", "待审核"],
    ["zh-CN", "draft", "withdrawn", "已撤回"],
    ["zh-CN", "published", "rejected", "已上架"],
    ["zh-CN", "unlisted", "rejected", "已下架"],
    ["zh-CN", "suspended", "rejected", "已下架"],
  ] as const)(
    "shows the %s governance status for a %s listing with a %s release",
    async (language, listingStatus, releaseStatus, expectedStatus) => {
      await i18n.changeLanguage(language)
      const hasCurrentRelease = listingStatus !== "draft"
      const publication = {
        listing: {
          ...listing,
          status: listingStatus,
          current_release_id: hasCurrentRelease ? RELEASE_ID : null,
        },
        current_release: hasCurrentRelease ? release : null,
        latest_release: {
          ...release,
          id: "40000000-0000-4000-8000-000000000002",
          release_number: hasCurrentRelease ? 2 : 1,
          status: releaseStatus,
          published_at: null,
        },
        install_count: 0,
      }
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = new URL(String(input), window.location.origin)
          return Promise.resolve(
            envelope({
              items:
                url.pathname === "/api/v1/admin/marketplace/listings"
                  ? [publication]
                  : [],
              next_cursor: null,
            })
          )
        })
      )
      const interaction = userEvent.setup()
      renderAdminPage()
      await interaction.click(
        await screen.findByRole("tab", {
          name: i18n.t("marketplace.tabs.listings"),
        })
      )

      const item = await screen.findByRole("article", { name: release.name })
      const badge = within(item).getByText(expectedStatus)
      expect(badge).toBeVisible()
      expect(
        within(item).queryByText(i18n.t("marketplace.status.draft"))
      ).not.toBeInTheDocument()
      if (listingStatus === "draft" && releaseStatus === "rejected") {
        expect(badge).toHaveAttribute("data-variant", "destructive")
      }
    }
  )

  it.each([false, true])(
    "shows a direct governance action when suspended is %s",
    async (suspended) => {
      const actionLabel = suspended ? "重新上架" : "下架"
      const publication = {
        listing: { ...listing, status: suspended ? "suspended" : "published" },
        current_release: release,
        latest_release: release,
        install_count: 7,
      }
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), window.location.origin)
          const method = init?.method ?? "GET"
          if (url.pathname === "/api/v1/admin/application-center") {
            return Promise.resolve(envelope({ items: [], next_cursor: null }))
          }
          if (
            url.pathname === "/api/v1/admin/marketplace/reviews" &&
            method === "GET"
          ) {
            return Promise.resolve(envelope({ items: [], next_cursor: null }))
          }
          if (
            url.pathname === "/api/v1/admin/marketplace/listings" &&
            method === "GET"
          ) {
            return Promise.resolve(
              envelope({ items: [publication], next_cursor: null })
            )
          }
          return Promise.resolve(envelope(null))
        }
      )
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      renderAdminPage()

      expect(
        await screen.findByRole("heading", { name: "插件中心" })
      ).toBeVisible()
      await interaction.click(
        await screen.findByRole("tab", { name: "全部上架项" })
      )

      const item = await screen.findByRole("article", { name: release.name })
      expect(item).toHaveClass("marketplace-governance-item", "-mx-4", "px-4")
      expect(item.closest('[data-slot="card"]')).toHaveClass(
        "rounded-card",
        "border"
      )
      expect(item.querySelector(".capability-logo")).not.toBeNull()
      expect(within(item).getByText(release.description)).toBeVisible()
      expect(within(item).getByText("发布者：发布者")).toBeVisible()
      expect(within(item).getByText("Skill")).toBeVisible()
      expect(within(item).getByText("已安装 7 次")).toBeVisible()
      expect(
        within(item).getByText(suspended ? "已下架" : "已上架")
      ).toBeVisible()

      expect(within(item).queryByRole("button", { name: "操作" })).toBeNull()
      const actionTrigger = within(item).getByRole("button", {
        name: actionLabel,
      })
      const actionIcon = suspended ? "lucide-store" : "lucide-package-minus"
      expect(actionTrigger.querySelector("svg")).toHaveClass(actionIcon)
      await interaction.click(actionTrigger)
      expect(screen.queryByRole("menu")).toBeNull()
      expect(
        await screen.findByRole("heading", {
          name: `${actionLabel}“${release.name}”？`,
        })
      ).toBeVisible()
      const dialog = screen.getByRole("dialog")
      expect(
        within(dialog)
          .getByRole("button", { name: actionLabel })
          .querySelector("svg")
      ).toHaveClass(actionIcon)
      if (!suspended) expect(screen.getByLabelText("下架原因")).toBeVisible()
    }
  )

  it("shows the unlisted status consistently and lets an administrator relist a publisher-unlisted item", async () => {
    let listingStatus: "unlisted" | "published" = "unlisted"
    const publication = {
      listing: { ...listing, status: "unlisted" as const },
      current_release: release,
      latest_release: release,
      install_count: 7,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (
        path === `/api/v1/admin/marketplace/${LISTING_ID}/status` &&
        init?.method === "PATCH"
      ) {
        listingStatus = "published"
        return Promise.resolve(
          envelope({ ...publication.listing, status: listingStatus })
        )
      }
      return Promise.resolve(
        envelope({
          items:
            path === "/api/v1/admin/marketplace/listings"
              ? [
                  {
                    ...publication,
                    listing: { ...publication.listing, status: listingStatus },
                  },
                ]
              : [],
          next_cursor: null,
        })
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderAdminPage()

    await interaction.click(
      await screen.findByRole("tab", { name: "全部上架项" })
    )

    const item = await screen.findByRole("article", { name: release.name })
    expect(within(item).getByText("已下架")).toHaveAttribute(
      "data-variant",
      "destructive"
    )
    expect(within(item).queryByRole("button", { name: "下架" })).toBeNull()
    expect(
      within(item)
        .getByRole("button", { name: "重新上架" })
        .querySelector("svg")
    ).toHaveClass("lucide-store")
    await interaction.click(
      within(item).getByRole("button", { name: "重新上架" })
    )
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByRole("heading", {
        name: `重新上架“${release.name}”？`,
      })
    ).toBeVisible()
    expect(
      within(dialog).getByText(i18n.t("marketplace.relistUnlistedDescription"))
    ).toBeVisible()
    expect(
      within(dialog)
        .getByRole("button", { name: "重新上架" })
        .querySelector("svg")
    ).toHaveClass("lucide-store")
    expect(within(dialog).queryByLabelText("下架原因")).toBeNull()
    await interaction.click(
      within(dialog).getByRole("button", { name: "重新上架" })
    )
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/admin/marketplace/${LISTING_ID}/status`),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ action: "resume" }),
        })
      )
    )
    expect(await within(item).findByText("已上架")).toBeVisible()
    expect(within(item).queryByRole("button", { name: "重新上架" })).toBeNull()
  })

  it("allows an administrator to review a release without consulting retired scan metadata", async () => {
    const pendingRelease = {
      ...release,
      status: "pending" as const,
      risk_summary: retiredScanRiskSummary,
      reviewer_id: null,
      reviewed_at: null,
      published_at: null,
    }
    const pendingListing = {
      ...listing,
      status: "draft" as const,
      current_release_id: null,
    }
    const pendingPublication = {
      listing: pendingListing,
      current_release: null,
      latest_release: pendingRelease,
      install_count: 0,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (url.pathname === "/api/v1/admin/application-center") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        url.pathname === "/api/v1/admin/marketplace/reviews" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({ items: [pendingPublication], next_cursor: null })
        )
      }
      if (
        url.pathname === "/api/v1/admin/marketplace/listings" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({ items: [pendingPublication], next_cursor: null })
        )
      }
      if (
        url.pathname === `/api/v1/admin/marketplace/releases/${RELEASE_ID}` &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({
            listing: pendingListing,
            release: pendingRelease,
            files: ["SKILL.md", "payload"],
            skill_content: "# Instructions",
          })
        )
      }
      return Promise.resolve(envelope(null))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderAdminPage()

    const reviewItem = await screen.findByRole("article", {
      name: release.name,
    })
    await interaction.click(
      within(reviewItem).getByRole("button", { name: "审核" })
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "提交审核结论" })).toBeEnabled()
    })
    expect(screen.queryByText("供应链安全扫描")).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")
    ).toBe(false)
  })

  it("shows immutable release evidence and submits an administrator approval", async () => {
    const pendingRelease = {
      ...release,
      status: "pending" as const,
      reviewer_id: null,
      reviewed_at: null,
      published_at: null,
    }
    const pendingListing = {
      ...listing,
      status: "draft" as const,
      current_release_id: null,
    }
    const pendingPublication = {
      listing: pendingListing,
      current_release: null,
      latest_release: pendingRelease,
      install_count: 0,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (url.pathname === "/api/v1/admin/application-center") {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        url.pathname === "/api/v1/admin/marketplace/reviews" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({ items: [pendingPublication], next_cursor: null })
        )
      }
      if (
        url.pathname === "/api/v1/admin/marketplace/listings" &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({ items: [pendingPublication], next_cursor: null })
        )
      }
      if (
        url.pathname === `/api/v1/admin/marketplace/releases/${RELEASE_ID}` &&
        method === "GET"
      ) {
        return Promise.resolve(
          envelope({
            listing: pendingListing,
            release: pendingRelease,
            files: ["SKILL.md", "references/design.md"],
            skill_content: "# Instructions",
          })
        )
      }
      if (
        url.pathname ===
          `/api/v1/admin/marketplace/releases/${RELEASE_ID}/review` &&
        method === "PATCH"
      ) {
        return Promise.resolve(
          envelope({
            ...pendingPublication,
            listing,
            current_release: release,
            latest_release: release,
          })
        )
      }
      return Promise.resolve(envelope(null))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderAdminPage()

    const reviewItem = await screen.findByRole("article", {
      name: release.name,
    })
    expect(reviewItem).toHaveClass("marketplace-governance-item")
    expect(reviewItem.closest('[data-slot="card"]')).toHaveClass(
      "rounded-card",
      "border"
    )
    expect(reviewItem.querySelector(".capability-logo")).not.toBeNull()
    expect(within(reviewItem).getByText(release.description)).toBeVisible()
    expect(within(reviewItem).getByText("发布者：发布者")).toBeVisible()
    expect(within(reviewItem).getByText("Skill")).toBeVisible()
    expect(within(reviewItem).getByText("第 1 个发布")).toBeVisible()
    expect(within(reviewItem).getByText(/^提交于 /)).toBeVisible()
    expect(within(reviewItem).getByText("待审核")).toBeVisible()
    expect(reviewItem.querySelector('[data-slot="card"]')).toBeNull()
    expect(
      within(reviewItem).queryByRole("button", { name: "操作" })
    ).not.toBeInTheDocument()

    const reviewButton = within(reviewItem).getByRole("button", {
      name: "审核",
    })
    expect(reviewButton.querySelector("svg")).not.toBeNull()
    await interaction.click(reviewButton)

    expect(await screen.findByText("references/design.md")).toBeVisible()
    expect(screen.getByText("# Instructions")).toBeVisible()
    expect(screen.getByText(/"name": "presentation-builder"/)).toBeVisible()
    expect(screen.getByText("首次发布")).toBeVisible()
    const decisionField = document
      .getElementById("marketplace-review-decision")
      ?.closest('[data-slot="field"]')
    const commentField = document
      .getElementById("marketplace-review-comment")
      ?.closest('[data-slot="field"]')
    expect(decisionField).not.toBeNull()
    expect(commentField).not.toBeNull()
    expect(decisionField?.parentElement).toBe(commentField?.parentElement)
    expect(decisionField?.parentElement).toHaveClass("items-start")
    await interaction.click(
      screen.getByRole("button", { name: "提交审核结论" })
    )

    await waitFor(() => {
      const reviewCall = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname ===
            `/api/v1/admin/marketplace/releases/${RELEASE_ID}/review` &&
          init?.method === "PATCH"
        )
      })
      expect(reviewCall).toBeDefined()
      expect(JSON.parse(String(reviewCall?.[1]?.body))).toEqual({
        decision: "approved",
        review_comment: null,
      })
    })
    const reviewNotification =
      await screen.findByText("发布已审核通过并成为当前插件中心版本")
    expect(reviewNotification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(reviewNotification.closest('[data-slot="alert"]')).toBeNull()
  })
})
