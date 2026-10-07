import { cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { ReactElement } from "react"
import { supportedLocales } from "@linksense/shared"

import { bootstrapSchema } from "@/api/contracts"
import { setAccessToken } from "@/api/session"
import { AuthContext, type AuthContextValue } from "@/app/auth-state"
import { BootstrapContext } from "@/app/bootstrap-state"
import { AppProviders } from "@/app/providers"
import { ThemeProvider } from "@/app/theme-context"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import i18n from "@/i18n"
import {
  CompleteRegistrationPage,
  ForgotPasswordPage,
  LoginPage,
  RegistrationPage,
  ResetPasswordPage,
} from "@/pages/auth-pages"

const teamsAdapterMocks = vi.hoisted(() => ({
  detectTeamsHost: vi.fn(async () => ({
    kind: "teams" as const,
    locale: "zh-CN",
  })),
  getTeamsSsoToken: vi.fn(async () => "teams-sso-token"),
}))

vi.mock("@/adapters/teams/teams-adapter", () => ({
  detectTeamsHost: teamsAdapterMocks.detectTeamsHost,
  getTeamsSsoToken: teamsAdapterMocks.getTeamsSsoToken,
}))

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const bootstrap = bootstrapSchema.parse({
  initialized: true,
  system_name: "LinkSense",
  default_language: "zh-CN",
  teams_sso: { status: "not_configured" },
  oidc: { status: "not_configured" },
  registration: { enabled: false },
})

function renderRegistrationPage({
  complete = false,
  page,
  acceptSession = vi.fn(async () => undefined),
}: {
  complete?: boolean
  page?: ReactElement
  acceptSession?: AuthContextValue["acceptSession"]
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BootstrapContext.Provider
          value={{
            bootstrap: { ...bootstrap, registration: { enabled: true } },
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          }}
        >
          <AuthContext.Provider
            value={{
              status: "anonymous",
              user: null,
              acceptSession,
              refreshUser: vi.fn(),
              signOut: vi.fn(),
            }}
          >
            <MemoryRouter
              initialEntries={[complete ? "/register/activate" : "/register"]}
            >
              <Routes>
                <Route
                  path="/register"
                  element={page ?? <RegistrationPage />}
                />
                <Route
                  path="/register/activate"
                  element={<CompleteRegistrationPage />}
                />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </BootstrapContext.Provider>
        <NotificationCenter />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

function renderLoginPageWithAuthStatus(
  status: AuthContextValue["status"],
  registrationEnabled = false
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BootstrapContext.Provider
        value={{
          bootstrap: {
            ...bootstrap,
            registration: { enabled: registrationEnabled },
          },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }}
      >
        <AuthContext.Provider
          value={{
            status,
            user: null,
            acceptSession: vi.fn(),
            refreshUser: vi.fn(),
            signOut: vi.fn(),
          }}
        >
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/conversations/new" element={<h1>任务首页</h1>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </BootstrapContext.Provider>
    </QueryClientProvider>
  )
}

describe("LoginPage session restoration", () => {
  it.each(supportedLocales)(
    "marks both login fields as required without changing their accessible names in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      renderLoginPageWithAuthStatus("anonymous")
      for (const id of ["login-email", "login-password"]) {
        const label = document.querySelector(`label[for="${id}"]`)
        expect(label?.lastElementChild).toHaveTextContent("*")
        expect(label?.lastElementChild).toHaveClass("text-destructive")
        expect(label?.lastElementChild).toHaveAttribute("aria-hidden", "true")
      }
      expect(
        screen.getByRole("textbox", { name: i18n.t("common.email") })
      ).toBeRequired()
      expect(document.getElementById("login-password")).toHaveAccessibleName(
        i18n.t("auth.password")
      )
    }
  )

  it("places the language selector at the page top right outside the login form", () => {
    renderLoginPageWithAuthStatus("anonymous")
    const selector = screen.getByRole("combobox", { name: "界面语言" })
    expect(selector.closest("main")).toBeNull()
    expect(selector.parentElement).toHaveClass("justify-end", "shrink-0")
    expect(selector.parentElement?.parentElement).toHaveClass("public-shell")
    expect(selector).toHaveClass("rounded-md")
    expect(selector).not.toHaveClass("rounded-lg", "rounded-full")
  })
  beforeEach(async () => {
    teamsAdapterMocks.detectTeamsHost.mockClear()
    teamsAdapterMocks.getTeamsSsoToken.mockClear()
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("keeps the password form hidden while the saved session is being restored", () => {
    renderLoginPageWithAuthStatus("loading")

    expect(screen.getByRole("status")).toHaveTextContent("正在加载")
    expect(
      screen.queryByRole("textbox", { name: "邮箱" })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^密码\s*\*?$/u)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "登录" })
    ).not.toBeInTheDocument()
    expect(teamsAdapterMocks.detectTeamsHost).not.toHaveBeenCalled()
  })

  it("keeps the password form hidden after the session has already been restored", () => {
    renderLoginPageWithAuthStatus("authenticated")

    expect(
      screen.queryByRole("textbox", { name: "邮箱" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "登录" })
    ).not.toBeInTheDocument()
    expect(teamsAdapterMocks.detectTeamsHost).not.toHaveBeenCalled()
  })

  it("shows the password form without two provider spinners while login methods load", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    )
    const { container } = renderLoginPageWithAuthStatus("anonymous")

    expect(screen.getByRole("textbox", { name: "邮箱" })).toBeVisible()
    expect(screen.getByLabelText(/^密码\s*\*?$/u)).toBeVisible()
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled()
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0)
  })

  it("shows inline login errors and focuses the first invalid field", async () => {
    const interaction = userEvent.setup()
    renderLoginPageWithAuthStatus("anonymous")

    await interaction.click(screen.getByRole("button", { name: "登录" }))
    const email = screen.getByRole("textbox", { name: "邮箱" })
    const password = screen.getByLabelText(/^密码\s*\*?$/u)
    expect(email).toHaveFocus()
    expect(email).toHaveAttribute("aria-invalid", "true")
    expect(password).toHaveAttribute("aria-invalid", "true")

    await interaction.type(email, "owner@example.com")
    await interaction.click(screen.getByRole("button", { name: "登录" }))
    expect(password).toHaveFocus()
  })

  it("marks the login action busy and shows a spinner while submitting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    )
    const interaction = userEvent.setup()
    renderLoginPageWithAuthStatus("anonymous")

    await interaction.type(
      screen.getByRole("textbox", { name: "邮箱" }),
      "owner@example.com"
    )
    await interaction.type(screen.getByLabelText(/^密码\s*\*?$/u), "secret")
    await interaction.click(screen.getByRole("button", { name: "登录" }))

    const submit = screen.getByRole("button", { name: "登录" })
    expect(submit).toHaveAttribute("aria-busy", "true")
    expect(submit.querySelector('[data-slot="spinner"]')).not.toBeNull()
  })

  it("hides the registration entry while open registration is disabled", () => {
    renderLoginPageWithAuthStatus("anonymous")

    expect(
      screen.queryByRole("link", { name: "立即注册" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("没有账号？")).not.toBeInTheDocument()
  })

  it("shows the registration entry after an administrator enables it", () => {
    renderLoginPageWithAuthStatus("anonymous", true)

    const registerLink = screen.getByRole("link", { name: "立即注册" })
    expect(registerLink).toHaveAttribute("href", "/register")
    expect(registerLink.parentElement).toHaveTextContent("没有账号？立即注册")
  })
})

describe("open registration pages", () => {
  it.each([
    ["registration", <RegistrationPage />, ["registration-email"]],
    [
      "activation",
      <CompleteRegistrationPage />,
      ["registration-password", "registration-password-confirmation"],
    ],
    ["recovery", <ForgotPasswordPage />, ["forgot-email"]],
    ["reset", <ResetPasswordPage />, ["new-password", "confirm-password"]],
  ] as const)("marks every required field in the %s form", (_, page, ids) => {
    renderRegistrationPage({ page })
    for (const id of ids) {
      const label = document.querySelector(`label[for="${id}"]`)
      expect(label?.lastElementChild).toHaveTextContent("*")
      expect(label?.lastElementChild).toHaveClass("text-destructive")
      expect(label?.lastElementChild).toHaveAttribute("aria-hidden", "true")
    }
  })

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    window.history.replaceState(null, "", "/")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.history.replaceState(null, "", "/")
  })

  it("submits a trimmed email and always shows the generic accepted result", async () => {
    const requests: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined
        )
        return json(
          {
            success: true,
            data: { code: "REGISTRATION_REQUEST_ACCEPTED" },
          },
          202
        )
      })
    )
    const interaction = userEvent.setup()
    renderRegistrationPage()

    await interaction.type(
      screen.getByRole("textbox", { name: "邮箱" }),
      "  New.Person@Example.com  "
    )
    await interaction.click(
      screen.getByRole("button", { name: "发送激活邮件" })
    )

    expect(
      await screen.findByText("如果该邮箱可以注册，系统将发送账号激活邮件。")
    ).toBeVisible()
    expect(
      screen.queryByRole("textbox", { name: "邮箱" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "发送激活邮件" })
    ).not.toBeInTheDocument()
    expect(requests).toContainEqual({ email: "New.Person@Example.com" })
  })

  it("sets the password through the fragment token and accepts the returned session", async () => {
    const token = "opaque-registration-token".repeat(2)
    window.history.replaceState(null, "", `/register/activate#token=${token}`)
    const requests: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined
        )
        return json({
          success: true,
          data: {
            access_token: "a".repeat(48),
            access_token_expires_at: "2026-09-01T10:00:00.000Z",
            refresh_session_expires_at: "2026-11-30T08:00:00.000Z",
            user: {
              id: "00000000-0000-4000-8000-000000000001",
              name: "new.person",
              email: "new.person@example.com",
              avatar_object_key: null,
              role: "user",
              status: "active",
              preferred_locale: "zh-CN",
              running_message_action: "queue",
              last_login_at: "2026-09-01T08:00:00.000Z",
              last_login_method: "password",
              password_updated_at: "2026-09-01T08:00:00.000Z",
              created_at: "2026-08-31T08:00:00.000Z",
              updated_at: "2026-09-01T08:00:00.000Z",
            },
          },
        })
      })
    )
    const interaction = userEvent.setup()
    const acceptSession = vi.fn(async () => undefined)
    renderRegistrationPage({ complete: true, acceptSession })

    expect(window.location.hash).toBe("")
    await interaction.type(
      screen.getByLabelText(/^新密码\s*\*?$/u),
      "Valid123!"
    )
    await interaction.type(
      screen.getByLabelText(/^确认新密码\s*\*?$/u),
      "Valid123!"
    )
    await interaction.click(
      screen.getByRole("button", { name: "激活账号并登录" })
    )

    await vi.waitFor(() => expect(acceptSession).toHaveBeenCalledOnce())
    expect(requests).toContainEqual({
      token,
      new_password: "Valid123!",
    })
  })
})

describe("LoginPage Teams sign-in", () => {
  beforeEach(async () => {
    setAccessToken(null)
    window.localStorage.clear()
    window.sessionStorage.clear()
    teamsAdapterMocks.detectTeamsHost.mockReset()
    teamsAdapterMocks.detectTeamsHost.mockResolvedValue({
      kind: "teams",
      locale: "zh-CN",
    })
    teamsAdapterMocks.getTeamsSsoToken.mockReset()
    teamsAdapterMocks.getTeamsSsoToken.mockResolvedValue("teams-sso-token")
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("tells first-time Teams users that their disabled account needs administrator approval", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin)
        const method = init?.method ?? "GET"
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined
        requests.push({ path: url.pathname, method, body })

        if (url.pathname === "/api/v1/system/bootstrap") {
          return json({
            success: true,
            data: {
              initialized: true,
              system_name: "LinkSense",
              default_language: "zh-CN",
              teams_sso: { status: "configured" },
              oidc: { status: "not_configured" },
            },
          })
        }

        if (url.pathname === "/api/v1/auth/refresh") {
          return json(
            { success: false, error_code: "AUTH_SESSION_EXPIRED" },
            401
          )
        }

        if (url.pathname === "/api/v1/auth/teams/exchange") {
          return json(
            {
              success: false,
              error_code: "EXTERNAL_ACCOUNT_PENDING_APPROVAL",
              message_key: "auth.external.accountPendingApproval",
            },
            403
          )
        }

        return json({ success: false, error_code: "NOT_FOUND" }, 404)
      })
    )

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AppProviders>
          <LoginPage />
        </AppProviders>
      </MemoryRouter>
    )

    expect(
      await screen.findByText(
        "身份验证成功，账号已创建并等待管理员启用。请联系管理员，启用后再重新登录。"
      )
    ).toBeVisible()
    expect(teamsAdapterMocks.getTeamsSsoToken).toHaveBeenCalledOnce()
    expect(
      requests.find(
        (request) =>
          request.path === "/api/v1/auth/teams/exchange" &&
          request.method === "POST"
      )?.body
    ).toEqual({ token: "teams-sso-token" })
    expect(
      screen.queryByRole("button", { name: "重试" })
    ).not.toBeInTheDocument()
  })
})
