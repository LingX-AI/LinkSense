import App from "@/App"
import { setAccessToken } from "@/api/session"
import { AppProviders } from "@/app/providers"
import {
  setupApplicationTests,
  installApiMock,
  json,
  renderApp,
} from "@/test/application/fixture"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

describe("LinkSense application", () => {
  setupApplicationTests()

  it("opens a legacy site bookmark with its filters for a personal account", async () => {
    const { fetchMock } = installApiMock({
      userOverride: { registration_source: "self_registration" },
    })
    const siteRequests: URL[] = []
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname !== "/api/v1/web-sites") return fetchMock(input, init)
      siteRequests.push(url)
      return Promise.resolve(
        json({ success: true, data: { items: [], next_cursor: null } })
      )
    })

    renderApp(
      "/knowledge-bases?tab=sites&site_search=water&site_status=disabled"
    )

    expect(
      await screen.findByRole("tab", { name: "我的站点" })
    ).toHaveAttribute("aria-selected", "true")
    expect(
      screen.getByRole("heading", { name: "应用", level: 1 })
    ).toBeVisible()
    expect(screen.getByRole("tab", { name: "我的应用" })).toBeVisible()
    expect(
      screen.queryByRole("tab", { name: "共享我的" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("tab", { name: "应用中心" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "创建应用" })).toBeVisible()
    expect(await screen.findByText("没有找到匹配的站点")).toBeVisible()
    expect(siteRequests).toHaveLength(1)
    expect(
      Object.fromEntries(siteRequests[0]?.searchParams ?? [])
    ).toMatchObject({
      search: "water",
      status: "disabled",
    })
  })

  it("redirects an uninitialized system to the first-administrator wizard", async () => {
    installApiMock({ initialized: false, refreshFails: true })
    renderApp("/login")
    expect(
      await screen.findByRole("heading", { name: "初始化 LinkSense" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: "管理员姓名" })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("系统名称")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "创建管理员并完成初始化" })
    ).toHaveClass("h-11", "w-full")
  })

  it("asks for the one-time credential when deployment protection is enabled", async () => {
    installApiMock({
      initialized: false,
      initializationCredentialRequired: true,
      refreshFails: true,
    })
    renderApp("/login")

    expect(
      await screen.findByLabelText(/^一次性初始化凭据\s*\*?$/u)
    ).toBeInTheDocument()
    expect(screen.getByText(/安装成功时终端显示的一次性凭据/u)).toBeVisible()
  })

  it("toggles the initialization password fields independently", async () => {
    installApiMock({ initialized: false, refreshFails: true })
    const interaction = userEvent.setup()
    renderApp("/login")

    const passwordInput = await screen.findByLabelText(/^新密码\s*\*?$/u)
    const confirmationInput = screen.getByLabelText(/^确认新密码\s*\*?$/u)
    await interaction.type(passwordInput, "ValidPass1!")
    await interaction.type(confirmationInput, "ValidPass1!")

    expect(passwordInput).toHaveAttribute("type", "password")
    expect(confirmationInput).toHaveAttribute("type", "password")

    const showPasswordButton = screen.getByRole("button", {
      name: "显示新密码",
    })
    expect(showPasswordButton).toHaveAttribute("aria-pressed", "false")
    await interaction.click(showPasswordButton)

    expect(passwordInput).toHaveAttribute("type", "text")
    expect(passwordInput).toHaveValue("ValidPass1!")
    expect(confirmationInput).toHaveAttribute("type", "password")
    expect(screen.getByRole("button", { name: "隐藏新密码" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    await interaction.click(
      screen.getByRole("button", { name: "显示确认新密码" })
    )
    expect(confirmationInput).toHaveAttribute("type", "text")
    expect(confirmationInput).toHaveValue("ValidPass1!")

    await interaction.click(screen.getByRole("button", { name: "隐藏新密码" }))
    expect(passwordInput).toHaveAttribute("type", "password")
    expect(confirmationInput).toHaveAttribute("type", "text")
  })

  it("uses the taller public action size for sign-in and account recovery", async () => {
    installApiMock({ refreshFails: true })
    const loginView = renderApp("/login")

    expect(await screen.findByRole("button", { name: "登录" })).toHaveClass(
      "h-11",
      "w-full"
    )
    loginView.unmount()

    const recoveryView = renderApp("/forgot-password")
    expect(
      await screen.findByRole("button", { name: "发送安全链接" })
    ).toHaveClass("h-11", "w-full")
    recoveryView.unmount()

    window.history.replaceState(null, "", "/reset-password#token=reset-token")
    renderApp("/reset-password#token=reset-token")
    expect(
      await screen.findByRole("button", { name: "保存新密码" })
    ).toHaveClass("h-11", "w-full")
  })

  it("shows the LinkSense credit on login, registration, and password recovery", async () => {
    installApiMock({ refreshFails: true, registrationEnabled: true })

    for (const path of ["/login", "/register", "/forgot-password"]) {
      const view = renderApp(path)
      const badge = await screen.findByRole("link", {
        name: "由 LinkSense 提供支持",
      })
      expect(badge).toBeVisible()
      expect(badge.parentElement).toHaveAttribute("data-placement", "page")
      expect(badge.parentElement).toHaveClass(
        "[--attribution-inset:18px]",
        "px-[var(--attribution-inset)]",
        "pb-[var(--attribution-inset)]"
      )
      view.unmount()
    }
  })

  it("places account recovery above sign-in and the registration prompt below login methods", async () => {
    installApiMock({ refreshFails: true, registrationEnabled: true })
    renderApp("/login")

    const forgotPassword = await screen.findByRole("link", {
      name: "忘记密码或首次设置密码",
    })
    const signIn = screen.getByRole("button", { name: "登录" })
    const register = screen.getByRole("link", { name: "立即注册" })
    const form = signIn.closest("form")

    expect(form).toContainElement(forgotPassword)
    expect(forgotPassword.parentElement).toHaveClass("text-right")
    expect(forgotPassword.compareDocumentPosition(signIn)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(register.parentElement).toHaveTextContent("没有账号？立即注册")
    expect(form?.parentElement?.lastElementChild).toBe(register.parentElement)
  })

  it("toggles the sign-in password visibility from the trailing eye button", async () => {
    installApiMock({ refreshFails: true })
    const interaction = userEvent.setup()
    renderApp("/login")

    const passwordInput = await screen.findByLabelText(/^密码\s*\*?$/u)
    await interaction.type(passwordInput, "Password1!")

    expect(passwordInput).toHaveAttribute("type", "password")
    expect(passwordInput).toHaveValue("Password1!")
    const showPasswordButton = screen.getByRole("button", {
      name: "显示密码",
    })
    expect(showPasswordButton.querySelector(".lucide-eye")).not.toBeNull()
    expect(showPasswordButton).toHaveAttribute("aria-pressed", "false")

    await interaction.click(showPasswordButton)

    expect(passwordInput).toHaveAttribute("type", "text")
    expect(passwordInput).toHaveValue("Password1!")
    const hidePasswordButton = screen.getByRole("button", {
      name: "隐藏密码",
    })
    expect(hidePasswordButton.querySelector(".lucide-eye-off")).not.toBeNull()
    expect(hidePasswordButton).toHaveAttribute("aria-pressed", "true")
  })

  it("restores the account language after password sign-in in a new browser", async () => {
    const { requests } = installApiMock({
      refreshFails: true,
      initialLanguage: "en-US",
    })
    const interaction = userEvent.setup()
    renderApp("/login")

    expect(window.localStorage.getItem("linksense.language")).toBeNull()
    expect(document.documentElement.lang).toBe("zh-CN")
    await interaction.type(
      await screen.findByRole("textbox", { name: "邮箱" }),
      "person@example.com"
    )
    await interaction.type(screen.getByLabelText(/^密码\s*\*?$/u), "Password1!")
    await interaction.click(screen.getByRole("button", { name: "登录" }))

    expect(
      await screen.findByRole(
        "form",
        { name: "Task composer" },
        { timeout: 5_000 }
      )
    ).toBeVisible()
    expect(document.documentElement.lang).toBe("en-US")
    expect(window.localStorage.getItem("linksense.language")).toBe("en-US")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/auth/login" && request.method === "POST"
      )
    ).toBe(true)
    expect(
      requests.some(
        (request) => request.path === "/api/v1/me" && request.method === "GET"
      )
    ).toBe(true)
  })

  it("leaves the sign-in page when another tab saves a session", async () => {
    const { requests } = installApiMock({
      refreshFails: true,
      initialLanguage: "en-US",
    })
    renderApp("/login")
    await screen.findByRole("button", { name: "登录" })

    act(() => {
      const key = "linksense.auth.access-session"
      const newValue = JSON.stringify({
        access_token: "another-tab-access-token",
        expires_at: Date.now() + 60_000,
      })
      window.localStorage.setItem(key, newValue)
      const event = new StorageEvent("storage", { key, newValue })
      Object.defineProperty(event, "storageArea", { value: window.localStorage })
      window.dispatchEvent(event)
    })

    expect(
      await screen.findByRole("form", { name: "Task composer" })
    ).toBeVisible()
    expect(document.documentElement.lang).toBe("en-US")
    expect(
      requests.filter(({ path }) => path === "/api/v1/auth/refresh")
    ).toHaveLength(1)
    expect(requests.some(({ path }) => path === "/api/v1/me")).toBe(true)
  })

  it("restores an expired account through the API client's refresh and the new token", async () => {
    const { fetchMock, requests } = installApiMock()
    const fallback = fetchMock.getMockImplementation()
    if (!fallback) throw new Error("Missing application API fixture")
    const previousToken = "previous-access-token"
    const profileTokens: Array<string | null> = []
    setAccessToken(previousToken)
    fetchMock.mockImplementation((input, init) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (path === "/api/v1/me") {
        const authorization = new Headers(init?.headers).get("Authorization")
        profileTokens.push(authorization)
        if (authorization === `Bearer ${previousToken}`) {
          return Promise.resolve(
            json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
          )
        }
      }
      return fallback(input, init)
    })
    renderApp("/login")

    expect(await screen.findByRole("form", { name: "任务输入框" })).toBeVisible()
    expect(profileTokens).toEqual([
      `Bearer ${previousToken}`,
      "Bearer test-access-token-that-is-long-enough",
    ])
    expect(
      requests.filter(({ path }) => path === "/api/v1/auth/refresh")
    ).toHaveLength(1)
  })

  it("shows an auto-dismiss notification after accepting a secure-link request", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/forgot-password")

    await interaction.type(
      await screen.findByRole("textbox", { name: "邮箱" }),
      "person@example.com"
    )
    await interaction.click(
      screen.getByRole("button", { name: "发送安全链接" })
    )

    const notification = await screen.findByText("安全链接请求已提交")
    const notificationToast = notification.closest("[data-sonner-toast]")
    expect(notificationToast).not.toBeNull()
    expect(notification.closest('[data-slot="alert"]')).toBeNull()
    expect(notificationToast).toHaveTextContent(
      "如果该邮箱对应可用账号，系统将发送密码设置或重置邮件"
    )
    expect(
      requests.find(
        (request) =>
          request.path === "/api/v1/auth/forgot-password" &&
          request.method === "POST"
      )?.body
    ).toEqual({ email: "person@example.com" })
  })

  it("shows an explicit failure status when the secure-link request cannot be queued", async () => {
    installApiMock({
      forgotPasswordResponse: () =>
        json(
          {
            success: false,
            error_code: "PASSWORD_RESET_EMAIL_DELIVERY_FAILED",
            message_key: "auth.passwordReset.deliveryFailed",
            message: "The secure link could not be sent.",
          },
          503
        ),
    })
    const interaction = userEvent.setup()
    renderApp("/forgot-password")

    await interaction.type(
      await screen.findByRole("textbox", { name: "邮箱" }),
      "person@example.com"
    )
    await interaction.click(
      screen.getByRole("button", { name: "发送安全链接" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "安全链接发送失败"
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "安全链接暂未发出，请稍后重试。"
    )
  })

  it("consumes a reset token from the fragment, clears the URL, and submits it from memory", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    window.history.replaceState(
      null,
      "",
      "/reset-password?token=query-secret#token=fragment-secret"
    )
    renderApp("/reset-password?token=query-secret#token=fragment-secret")

    expect(
      await screen.findByRole("heading", { name: "设置新密码" })
    ).toBeVisible()
    expect(window.location.search).toBe("")
    expect(window.location.hash).toBe("")

    await interaction.type(
      screen.getByLabelText(/^新密码\s*\*?$/u),
      "ValidPass1!"
    )
    await interaction.type(
      screen.getByLabelText(/^确认新密码\s*\*?$/u),
      "ValidPass1!"
    )
    await interaction.click(screen.getByRole("button", { name: "保存新密码" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/auth/reset-password" &&
            request.method === "POST"
        )?.body
      ).toEqual({ token: "fragment-secret", new_password: "ValidPass1!" })
    )
  })

  it("keeps a fragment reset token available when the app runs in StrictMode", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    window.history.replaceState(
      null,
      "",
      "/reset-password#token=strict-mode-reset-token"
    )

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/reset-password"]}>
          <AppProviders>
            <App />
          </AppProviders>
        </MemoryRouter>
      </StrictMode>
    )

    expect(
      await screen.findByRole("heading", { name: "设置新密码" })
    ).toBeVisible()
    expect(screen.getAllByRole("img", { name: "LinkSense" })[0]).toHaveClass(
      "product-logo"
    )
    expect(
      screen.queryByText("密码设置链接无效或已过期，请重新申请。")
    ).not.toBeInTheDocument()
    expect(window.location.hash).toBe("")

    await interaction.type(
      screen.getByLabelText(/^新密码\s*\*?$/u),
      "ValidPass1!"
    )
    await interaction.type(
      screen.getByLabelText(/^确认新密码\s*\*?$/u),
      "ValidPass1!"
    )
    await interaction.click(screen.getByRole("button", { name: "保存新密码" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/auth/reset-password" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        token: "strict-mode-reset-token",
        new_password: "ValidPass1!",
      })
    )
  })

  it("clears but never accepts a reset token from the query string", async () => {
    installApiMock()
    window.history.replaceState({}, "", "/reset-password?token=query-secret")
    renderApp("/reset-password?token=query-secret")

    expect(
      await screen.findByText("密码设置链接无效或已过期，请重新申请。")
    ).toBeVisible()
    expect(window.location.search).toBe("")
    expect(screen.getByRole("button", { name: "保存新密码" })).toBeDisabled()
  })

  it.each(["oidc", "saml", "social"])(
    "restores the backend-created %s session and clears the callback result",
    async (protocol) => {
      const { requests } = installApiMock()
      window.history.replaceState(
        {},
        "",
        `/auth/${protocol}/callback?result=success`
      )
      renderApp(`/auth/${protocol}/callback?result=success`)

      await waitFor(() =>
        expect(screen.getByRole("form", { name: "任务输入框" })).toBeVisible()
      )
      expect(window.location.search).toBe("")
      expect(
        requests.some(
          (request) => request.path === `/api/v1/auth/${protocol}/callback`
        )
      ).toBe(false)
    }
  )

  it.each(["oidc", "saml"])(
    "shows first-time %s users that their disabled account needs administrator approval",
    async (protocol) => {
      const { requests } = installApiMock({ refreshFails: true })
      window.history.replaceState(
        {},
        "",
        `/auth/${protocol}/callback?result=pending_approval`
      )
      renderApp(`/auth/${protocol}/callback?result=pending_approval`)

      expect(
        await screen.findByText(
          "单点登录验证成功，账号已创建并等待管理员启用。请联系管理员，启用后再重新登录。"
        )
      ).toBeVisible()
      expect(screen.getByRole("link", { name: "返回登录页" })).toHaveAttribute(
        "href",
        "/login"
      )
      expect(window.location.search).toBe("")
      expect(
        requests.some(
          (request) => request.path === `/api/v1/auth/${protocol}/callback`
        )
      ).toBe(false)
    }
  )

  it("focuses Browser Use setup after password sign-in from its deep link", async () => {
    installApiMock({ refreshFails: true })
    const interaction = userEvent.setup()
    renderApp("/settings/general#browser-extension")

    await interaction.type(
      await screen.findByRole("textbox", { name: "邮箱" }),
      "person@example.com"
    )
    await interaction.type(screen.getByLabelText(/^密码\s*\*?$/u), "Password1!")
    await interaction.click(screen.getByRole("button", { name: "登录" }))

    expect(
      await screen.findByRole("region", { name: "Browser Use" })
    ).toHaveFocus()
  })

  it.each(["oidc", "saml", "social"])(
    "restores Browser Use setup once after %s sign-in returns in the same tab",
    async (protocol) => {
      installApiMock({ refreshFails: true })
      const login = renderApp("/settings/general#browser-extension")
      await screen.findByRole("textbox", { name: "邮箱" })
      login.unmount()

      installApiMock()
      const callbackPath = `/auth/${protocol}/callback?result=success`
      window.history.replaceState({}, "", callbackPath)
      const callback = renderApp(callbackPath)
      expect(
        await screen.findByRole("region", { name: "Browser Use" })
      ).toHaveFocus()
      expect(window.location.search).toBe("")
      callback.unmount()

      window.history.replaceState({}, "", callbackPath)
      renderApp(callbackPath)
      expect(
        await screen.findByRole("form", { name: "任务输入框" })
      ).toBeVisible()
    }
  )

  it("does not reuse an API callback path as the post-password-login destination", async () => {
    installApiMock({ refreshFails: true })
    const interaction = userEvent.setup()
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/login",
            state: { from: "/api/v1/auth/oidc/callback" },
          },
        ]}
      >
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    )

    await interaction.type(
      await screen.findByRole("textbox", { name: "邮箱" }),
      "person@example.com"
    )
    await interaction.type(screen.getByLabelText(/^密码\s*\*?$/u), "Password1!")
    await interaction.click(screen.getByRole("button", { name: "登录" }))

    expect(
      await screen.findByRole("form", { name: "任务输入框" })
    ).toBeVisible()
    expect(screen.queryByText("页面不存在。")).not.toBeInTheDocument()
  })
})
