import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

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

function renderProtected(role: "user" | "admin") {
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
          status: "authenticated",
          user: { ...user, role },
          acceptSession: vi.fn(),
          refreshUser: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={["/conversations/new"]}>
          <Routes>
            <Route element={<ProtectedRoute />}>
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
    clearMaintenanceAdminEntry()
  })

  it("shows maintenance instead of the public login page by default", () => {
    renderBootstrapGate()

    expect(screen.getByRole("heading", { name: "系统维护中" })).toBeVisible()
    expect(screen.getByRole("button", { name: "管理员入口" })).toBeVisible()
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
    expect(document.querySelector(".lucide-wrench")).toBeNull()
    expect(
      screen.queryByRole("heading", { name: "Conversation workspace" })
    ).not.toBeInTheDocument()
  })

  it("allows administrators to continue into the application", () => {
    renderProtected("admin")

    expect(
      screen.getByRole("heading", { name: "Conversation workspace" })
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "系统维护中" })
    ).not.toBeInTheDocument()
  })
})
