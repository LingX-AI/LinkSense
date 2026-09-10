import App from "@/App"
import { AppProviders } from "@/app/providers"
import {
  setupApplicationTests,
  installApiMock,
  json,
  renderApp,
} from "@/test/application/fixture"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

describe("LinkSense application", () => {
  setupApplicationTests()
  it("redirects an uninitialized system to the first-administrator wizard", async () => {
    installApiMock({ initialized: false, refreshFails: true })
    renderApp("/login")
    expect(
      await screen.findByRole("heading", { name: "初始化 LinkSense" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("管理员姓名")).toBeInTheDocument()
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

    expect(await screen.findByLabelText("一次性初始化凭据")).toBeInTheDocument()
    expect(screen.getByText(/安装成功时终端显示的一次性凭据/u)).toBeVisible()
  })

  it("toggles the initialization password fields independently", async () => {
    installApiMock({ initialized: false, refreshFails: true })
    const interaction = userEvent.setup()
    renderApp("/login")

    const passwordInput = await screen.findByLabelText("新密码")
    const confirmationInput = screen.getByLabelText("确认新密码")
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

  it("toggles the sign-in password visibility from the trailing eye button", async () => {
    installApiMock({ refreshFails: true })
    const interaction = userEvent.setup()
    renderApp("/login")

    const passwordInput = await screen.findByLabelText("密码")
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
      await screen.findByLabelText("邮箱"),
      "person@example.com"
    )
    await interaction.type(screen.getByLabelText("密码"), "Password1!")
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

  it("shows an auto-dismiss notification after accepting a secure-link request", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/forgot-password")

    await interaction.type(
      await screen.findByLabelText("邮箱"),
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
      await screen.findByLabelText("邮箱"),
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

    await interaction.type(screen.getByLabelText("新密码"), "ValidPass1!")
    await interaction.type(screen.getByLabelText("确认新密码"), "ValidPass1!")
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
    expect(screen.getByRole("img", { name: "LinkSense" })).toHaveClass(
      "public-brand-logo"
    )
    expect(
      screen.queryByText("密码设置链接无效或已过期，请重新申请。")
    ).not.toBeInTheDocument()
    expect(window.location.hash).toBe("")

    await interaction.type(screen.getByLabelText("新密码"), "ValidPass1!")
    await interaction.type(screen.getByLabelText("确认新密码"), "ValidPass1!")
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

  it("restores the backend-created OIDC session and clears the callback result", async () => {
    const { requests } = installApiMock()
    window.history.replaceState({}, "", "/auth/oidc/callback?result=success")
    renderApp("/auth/oidc/callback?result=success")

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "任务输入框" })).toBeVisible()
    )
    expect(window.location.search).toBe("")
    expect(
      requests.some((request) => request.path === "/api/v1/auth/oidc/callback")
    ).toBe(false)
  })

  it("shows first-time OIDC users that their disabled account needs administrator approval", async () => {
    const { requests } = installApiMock({ refreshFails: true })
    window.history.replaceState(
      {},
      "",
      "/auth/oidc/callback?result=pending_approval"
    )
    renderApp("/auth/oidc/callback?result=pending_approval")

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
      requests.some((request) => request.path === "/api/v1/auth/oidc/callback")
    ).toBe(false)
  })

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
      await screen.findByLabelText("邮箱"),
      "person@example.com"
    )
    await interaction.type(screen.getByLabelText("密码"), "Password1!")
    await interaction.click(screen.getByRole("button", { name: "登录" }))

    expect(
      await screen.findByRole("form", { name: "任务输入框" })
    ).toBeVisible()
    expect(screen.queryByText("页面不存在。")).not.toBeInTheDocument()
  })
})
