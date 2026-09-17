import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { toast } from "sonner"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"

import { bootstrapSchema, userSchema } from "@/api/contracts"
import { AuthContext } from "@/app/auth-state"
import { BootstrapContext } from "@/app/bootstrap-state"
import {
  clearMaintenanceAdminEntry,
  enableMaintenanceAdminEntry,
} from "@/app/maintenance-admin-entry"
import {
  BootstrapGate,
  ProtectedRoute,
  PublicAuthRoute,
} from "@/app/route-guards"
import i18n from "@/i18n"

const bootstrap = bootstrapSchema.parse({
  initialized: true,
  system_name: "LinkSense",
  default_language: "zh-CN",
  maintenance_id: "01900000-0000-7000-8000-000000000001",
  maintenance: {
    enabled: true,
    active: true,
    reason: "数据库升级",
    start_at: "2026-08-04T12:00:00.000Z",
    end_at: "2026-08-04T13:00:00.000Z",
  },
})

const user = userSchema.parse({
  id: "01900000-0000-7000-8000-000000000011",
  name: "Regular User",
  email: "user@example.test",
  role: "user",
  status: "active",
  avatar_url: null,
  language: "zh-CN",
  login_method: "password",
  running_message_action: "queue",
  registration_source: "organization_invitation",
  user_groups: [],
})

function MaintenanceConfigurationDestination() {
  const location = useLocation()
  return (
    <h1>
      {location.pathname}
      {location.search}
    </h1>
  )
}

function renderProtected(
  role: "user" | "admin",
  maintenance: typeof bootstrap.maintenance = bootstrap.maintenance,
  initialPath = "/conversations/new",
  accountStatus: typeof user.status = "active",
  userId = user.id
) {
  const tree = (
    currentMaintenance: typeof bootstrap.maintenance,
    periodId = bootstrap.maintenance_id
  ) => (
    <BootstrapContext.Provider
      value={{
        bootstrap: {
          ...bootstrap,
          maintenance: currentMaintenance,
          maintenance_id: periodId,
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }}
    >
      <AuthContext.Provider
        value={{
          status: "authenticated",
          user: { ...user, id: userId, role, status: accountStatus },
          acceptSession: vi.fn(),
          refreshUser: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<BootstrapGate />}>
              <Route element={<ProtectedRoute />}>
                <Route
                  path="*"
                  element={
                    <>
                      <h1>Conversation workspace</h1>
                      <input aria-label="Draft" />
                      <Link to="/archived">Archived tasks</Link>
                      <Link to="/conversations/new">New task</Link>
                    </>
                  }
                />
                <Route
                  path="/admin/settings"
                  element={<MaintenanceConfigurationDestination />}
                />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </BootstrapContext.Provider>
  )
  const view = render(tree(maintenance))
  return {
    ...view,
    updateMaintenance: (
      next: typeof bootstrap.maintenance,
      periodId = bootstrap.maintenance_id
    ) => view.rerender(tree(next, periodId)),
  }
}

function renderBootstrapGate({
  initialPath = "/login",
  role,
  signOut = vi.fn(),
}: {
  initialPath?: string
  role?: "user" | "admin"
  signOut?: () => Promise<void>
} = {}) {
  return render(
    <BootstrapContext.Provider
      value={{
        bootstrap,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }}
    >
      <AuthContext.Provider
        value={{
          status: role ? "authenticated" : "anonymous",
          user: role ? { ...user, role } : null,
          acceptSession: vi.fn(),
          refreshUser: vi.fn(),
          signOut,
        }}
      >
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<BootstrapGate />}>
              <Route path="/login" element={<h1>Login page</h1>} />
              <Route
                path="/conversations/new"
                element={<h1>Conversation workspace</h1>}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </BootstrapContext.Provider>
  )
}

function renderPublicAuthRoute({
  status,
  initialEntry = "/login",
}: {
  status: "loading" | "authenticated" | "anonymous" | "error"
  initialEntry?: string | { pathname: string; state?: Record<string, unknown> }
}) {
  return render(
    <AuthContext.Provider
      value={{
        status,
        user: status === "authenticated" ? user : null,
        acceptSession: vi.fn(),
        refreshUser: vi.fn(),
        signOut: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<PublicAuthRoute />}>
            <Route path="/login" element={<h1>Login page</h1>} />
          </Route>
          <Route
            path="/conversations/new"
            element={<h1>Conversation workspace</h1>}
          />
          <Route path="/knowledge-bases" element={<h1>Knowledge bases</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe("public authentication route guard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
  })

  it("keeps the login page hidden while the saved session is being restored", () => {
    renderPublicAuthRoute({ status: "loading" })

    expect(screen.getByRole("status")).toHaveTextContent("正在加载")
    expect(
      screen.queryByRole("heading", { name: "Login page" })
    ).not.toBeInTheDocument()
  })

  it("shows a retry action when the saved session cannot be restored", () => {
    renderPublicAuthRoute({ status: "error" })

    expect(screen.getByRole("alert")).toHaveTextContent(
      "登录状态恢复失败，请检查网络后重试。"
    )
    expect(screen.getByRole("button", { name: "重试" })).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Login page" })
    ).not.toBeInTheDocument()
  })

  it("redirects authenticated visitors away from the login page", async () => {
    renderPublicAuthRoute({ status: "authenticated" })

    expect(
      await screen.findByRole("heading", { name: "Conversation workspace" })
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Login page" })
    ).not.toBeInTheDocument()
  })

  it("preserves a safe protected destination for authenticated visitors", async () => {
    renderPublicAuthRoute({
      status: "authenticated",
      initialEntry: { pathname: "/login", state: { from: "/knowledge-bases" } },
    })

    expect(
      await screen.findByRole("heading", { name: "Knowledge bases" })
    ).toBeVisible()
  })
})

describe("maintenance route guard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.restoreAllMocks()
    clearMaintenanceAdminEntry()
  })

  it("shows maintenance instead of the public login page by default", () => {
    renderBootstrapGate()

    expect(screen.getByRole("heading", { name: "系统维护中" })).toBeVisible()
    expect(screen.getByRole("button", { name: "管理员入口" })).toBeVisible()
    expect(
      screen.queryByRole("dialog", { name: "已开启系统维护" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Login page" })
    ).not.toBeInTheDocument()
  })

  it("allows the login page after the maintenance admin entry is enabled", () => {
    enableMaintenanceAdminEntry()

    renderBootstrapGate()

    expect(screen.getByRole("heading", { name: "Login page" })).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "系统维护中" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: "已开启系统维护" })
    ).not.toBeInTheDocument()
  })

  it("opens the admin login entry after signing out a regular user", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    const interaction = userEvent.setup()
    renderBootstrapGate({
      initialPath: "/conversations/new",
      role: "user",
      signOut,
    })

    await interaction.click(screen.getByRole("button", { name: "管理员入口" }))

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByRole("heading", { name: "Login page" })
    ).toBeVisible()
  })

  it("shows the maintenance page instead of the application to regular users", () => {
    renderProtected("user")

    const heading = screen.getByRole("heading", { name: "系统维护中" })
    expect(heading).toBeVisible()
    expect(heading).toHaveClass(
      "text-[length:var(--app-font-16)]",
      "leading-[var(--app-line-24)]"
    )
    expect(screen.getByText("数据库升级")).toBeVisible()
    expect(
      screen.queryByRole("dialog", { name: "已开启系统维护" })
    ).not.toBeInTheDocument()
    expect(document.querySelector(".lucide-wrench")).toBeNull()
    expect(
      screen.queryByRole("link", { name: "已开启系统维护" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Conversation workspace" })
    ).not.toBeInTheDocument()
  })

  it.each([
    ["zh-CN", "已开启系统维护", "维护设置", "不再显示"],
    [
      "en-US",
      "System maintenance enabled",
      "Maintenance settings",
      "Don’t show again",
    ],
    ["fr-FR", "已开启系统维护", "维护设置", "不再显示"],
  ])(
    "shows an accessible localized dialog and opens maintenance settings in %s",
    async (language, title, settingsLabel, dismissLabel) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      renderProtected("admin")
      const dialog = await screen.findByRole("dialog", { name: title })
      expect(dialog).toHaveAccessibleDescription(
        i18n.t("maintenance.dialogDescription")
      )
      expect(within(dialog).getByText("数据库升级")).toBeVisible()
      expect(
        screen.queryByRole("link", { name: title })
      ).not.toBeInTheDocument()
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", { name: dismissLabel })
        ).toHaveFocus()
      )
      await interaction.click(
        within(dialog).getByRole("button", { name: settingsLabel })
      )
      // The destination is another page entry, so its reminder can be dismissed too.
      await interaction.click(
        await screen.findByRole("button", { name: dismissLabel })
      )
      expect(
        await screen.findByRole("heading", {
          name: "/admin/settings?section=maintenance",
        })
      ).toBeVisible()
    }
  )

  it.each([
    "/conversations/new",
    "/settings/general",
    "/archived",
    "/admin/users",
  ])("opens the reminder on authenticated page %s", async (path) => {
    renderProtected("admin", bootstrap.maintenance, path)
    expect(
      await screen.findByRole("dialog", { name: "已开启系统维护" })
    ).toBeVisible()
  })

  it("tracks maintenance activation, completion, disabling, and unavailable status", async () => {
    const scheduled = { ...bootstrap.maintenance!, active: false }
    const view = renderProtected("admin", scheduled)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    view.updateMaintenance(bootstrap.maintenance)
    expect(
      await screen.findByRole("dialog", { name: "已开启系统维护" })
    ).toBeVisible()
    view.updateMaintenance(scheduled)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    view.updateMaintenance({ ...scheduled, enabled: false })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    view.updateMaintenance(undefined)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("preserves dismissal across background updates and opens again when maintenance restarts", async () => {
    const interaction = userEvent.setup()
    const view = renderProtected("admin")
    await interaction.click(
      await screen.findByRole("button", { name: "不再显示" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    view.updateMaintenance({
      ...bootstrap.maintenance!,
      reason: "Updated reason",
      end_at: "2026-08-04T15:00:00.000Z",
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Conversation workspace" })
    ).toBeVisible()
    view.updateMaintenance({ ...bootstrap.maintenance!, active: false })
    view.updateMaintenance(
      bootstrap.maintenance,
      "01900000-0000-7000-8000-000000000002"
    )
    expect(
      await screen.findByRole("dialog", { name: "已开启系统维护" })
    ).toBeVisible()
  })

  it("opens again when an administrator navigates to another page and returns", async () => {
    const interaction = userEvent.setup()
    renderProtected("admin")
    for (const destination of ["Archived tasks", "New task"]) {
      await interaction.click(
        await screen.findByRole("button", { name: "关闭" })
      )
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      await interaction.click(screen.getByRole("link", { name: destination }))
      expect(
        await screen.findByRole("dialog", { name: "已开启系统维护" })
      ).toBeVisible()
    }
  })

  it.each(["escape", "close button"])(
    "can dismiss the reminder using %s",
    async (action) => {
      const interaction = userEvent.setup()
      renderProtected("admin")
      await screen.findByRole("dialog", { name: "已开启系统维护" })
      if (action === "escape") await interaction.keyboard("{Escape}")
      else
        await interaction.click(
          screen.getByRole("button", { name: i18n.t("common.close") })
        )
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      expect(
        screen.getByRole("heading", { name: "Conversation workspace" })
      ).toBeVisible()
    }
  )

  it.each(["/login", "/login/", "/login?next=/admin/settings"])(
    "does not show an administrator reminder on %s",
    (initialPath) => {
      renderBootstrapGate({ role: "admin", initialPath })
      expect(screen.getByRole("heading", { name: "Login page" })).toBeVisible()
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(
        screen.queryByRole("link", { name: "已开启系统维护" })
      ).not.toBeInTheDocument()
    }
  )

  it("preserves the administrator's page and draft when maintenance starts and ends", async () => {
    const interaction = userEvent.setup()
    const inactive = { ...bootstrap.maintenance!, active: false }
    const view = renderProtected("admin", inactive)
    const draft = screen.getByRole("textbox", { name: "Draft" })
    await interaction.type(draft, "Unsent message")
    view.updateMaintenance(bootstrap.maintenance)
    await interaction.click(
      await screen.findByRole("button", { name: "不再显示" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft)
    expect(draft).toHaveValue("Unsent message")
    view.updateMaintenance(inactive)
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft)
    expect(draft).toHaveValue("Unsent message")
  })

  it("also reminds administrators on non-login pages outside the protected route", async () => {
    renderBootstrapGate({ role: "admin", initialPath: "/conversations/new" })
    expect(
      await screen.findByRole("dialog", { name: "已开启系统维护" })
    ).toBeVisible()
  })

  it("does not show the reminder for disabled administrators", () => {
    renderProtected(
      "admin",
      bootstrap.maintenance,
      "/conversations/new",
      "disabled"
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("supports maintenance without a reason or scheduled dates", async () => {
    renderProtected("admin", {
      enabled: true,
      active: true,
      reason: null,
      start_at: null,
      end_at: null,
    })
    const dialog = await screen.findByRole("dialog", { name: "已开启系统维护" })
    expect(
      within(dialog).queryByText(i18n.t("maintenance.reasonLabel"))
    ).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole("button", { name: "不再显示" })
    ).toBeVisible()
  })

  it("remembers do-not-show across navigation and remounting for the same administrator", async () => {
    const interaction = userEvent.setup()
    const view = renderProtected("admin")
    await interaction.click(
      await screen.findByRole("button", { name: "不再显示" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await interaction.click(
      screen.getByRole("link", { name: "Archived tasks" })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    view.unmount()
    renderProtected("admin")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it.each([
    ["zh-CN", "已开启系统维护", "不再显示"],
    ["en-US", "System maintenance enabled", "Don’t show again"],
    ["fr-FR", "已开启系统维护", "不再显示"],
  ])(
    "retains the bottom-right maintenance link after suppressing the dialog in %s",
    async (language, label, dismissLabel) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      const view = renderProtected("admin")
      await interaction.click(
        await screen.findByRole("button", { name: dismissLabel })
      )
      const indicator = await screen.findByRole("link", { name: label })
      expect(indicator).toBeVisible()
      expect(indicator).toHaveClass(
        "fixed",
        "right-[max(1rem,var(--app-safe-area-right))]",
        "bottom-[max(1rem,var(--app-safe-area-bottom))]"
      )
      expect(indicator).toHaveAttribute(
        "href",
        "/admin/settings?section=maintenance"
      )
      await interaction.click(indicator)
      expect(
        await screen.findByRole("heading", {
          name: "/admin/settings?section=maintenance",
        })
      ).toBeVisible()
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(screen.getByRole("link", { name: label })).toBeVisible()
      view.updateMaintenance({ ...bootstrap.maintenance!, active: false })
      expect(
        screen.queryByRole("link", { name: label })
      ).not.toBeInTheDocument()
    }
  )

  it("does not suppress a different administrator's reminder", async () => {
    const interaction = userEvent.setup()
    const view = renderProtected("admin")
    await interaction.click(
      await screen.findByRole("button", { name: "不再显示" })
    )
    view.unmount()
    renderProtected(
      "admin",
      bootstrap.maintenance,
      "/conversations/new",
      "active",
      "01900000-0000-7000-8000-000000000099"
    )
    expect(
      await screen.findByRole("dialog", { name: "已开启系统维护" })
    ).toBeVisible()
  })

  it("shows a new period even if the browser missed the end of the previous maintenance", async () => {
    const interaction = userEvent.setup()
    const view = renderProtected("admin")
    await interaction.click(
      await screen.findByRole("button", { name: "不再显示" })
    )
    view.updateMaintenance(
      bootstrap.maintenance,
      "01900000-0000-7000-8000-000000000002"
    )
    expect(
      await screen.findByRole("dialog", { name: "已开启系统维护" })
    ).toBeVisible()
  })

  it("closes an open reminder when another tab suppresses the same maintenance", async () => {
    renderProtected("admin")
    await screen.findByRole("dialog", { name: "已开启系统维护" })
    const key = `linksense.maintenance-notice.dismissed:${user.id}`
    act(() => {
      window.localStorage.setItem(key, bootstrap.maintenance_id!)
      const event = new StorageEvent("storage", { key })
      Object.defineProperty(event, "storageArea", {
        value: window.localStorage,
      })
      window.dispatchEvent(event)
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  })

  it("keeps temporary dismissal scoped to the current page after Escape", async () => {
    const interaction = userEvent.setup()
    renderProtected("admin")
    await screen.findByRole("dialog")
    await interaction.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await interaction.click(
      screen.getByRole("link", { name: "Archived tasks" })
    )
    expect(
      await screen.findByRole("dialog", { name: "已开启系统维护" })
    ).toBeVisible()
    expect(
      window.localStorage.getItem(
        `linksense.maintenance-notice.dismissed:${user.id}`
      )
    ).toBeNull()
  })

  it("reports a failed preference save and keeps the temporary close available", async () => {
    const interaction = userEvent.setup()
    const showError = vi.spyOn(toast, "error").mockImplementation(() => "toast")
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable")
    })
    renderProtected("admin")
    await interaction.click(
      await screen.findByRole("button", { name: "不再显示" })
    )
    expect(showError).toHaveBeenCalledWith(i18n.t("maintenance.rememberFailed"))
    expect(screen.getByRole("dialog")).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "关闭" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  })

  it("keeps long maintenance details scrollable with a decorative warning illustration and separate actions", async () => {
    const reason = "维护说明与检查事项。".repeat(100)
    renderProtected("admin", { ...bootstrap.maintenance!, reason })
    const dialog = await screen.findByRole("dialog", { name: "已开启系统维护" })
    const illustration = dialog.querySelector(".lucide-wrench")
    expect(illustration).toBeInTheDocument()
    const decorativeBackground = illustration?.closest(
      'div[aria-hidden="true"]'
    )
    expect(decorativeBackground).toHaveClass(
      "bg-warning/25",
      "pointer-events-none",
      "overflow-hidden"
    )
    expect(decorativeBackground).not.toContainElement(
      within(dialog).getByRole("button", { name: "关闭" })
    )
    expect(
      decorativeBackground?.querySelector("button, a, input, [tabindex]")
    ).toBeNull()
    const scrollableBody = within(dialog)
      .getByText(reason)
      .closest(".overflow-y-auto")
    expect(scrollableBody).not.toBeNull()
    expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]", "overflow-hidden")
    expect(scrollableBody).not.toContainElement(
      within(dialog).getByRole("button", { name: "不再显示" })
    )
    expect(scrollableBody).not.toContainElement(
      within(dialog).getByRole("button", { name: "维护设置" })
    )
    expect(scrollableBody).not.toContainElement(
      within(dialog).getByRole("button", { name: "关闭" })
    )
  })
})
