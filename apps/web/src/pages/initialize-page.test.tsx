import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { bootstrapSchema } from "@/api/contracts"
import { BootstrapContext } from "@/app/bootstrap-state"
import i18n from "@/i18n"
import { InitializePage } from "@/pages/initialize-page"

const bootstrap = bootstrapSchema.parse({
  initialized: false,
  system_name: "LinkSense",
  default_language: "zh-CN",
  initialization_credential_required: true,
  teams_sso: { status: "not_configured" },
  oidc: { status: "not_configured" },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("InitializePage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("reports every invalid field inline and focuses the first one", async () => {
    const interaction = userEvent.setup()
    renderPage()

    await interaction.click(
      screen.getByRole("button", { name: "创建管理员并完成初始化" })
    )

    const credential = screen.getByLabelText("一次性初始化凭据")
    expect(credential).toHaveFocus()
    expect(credential).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByLabelText("管理员姓名")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByLabelText("邮箱")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByLabelText("新密码")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByLabelText("确认新密码")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
  })

  it("accepts the authentication user projection returned after initialization", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (path === "/api/v1/system/initialize") {
        return json(
          {
            success: true,
            data: {
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "admin@example.com",
                name: "Administrator",
                avatar_object_key: null,
                role: "admin",
                status: "active",
                preferred_locale: "zh-CN",
                running_message_action: "queue",
                last_login_at: null,
                last_login_method: null,
                password_updated_at: "2026-09-01T08:00:00.000Z",
                created_at: "2026-09-01T08:00:00.000Z",
                updated_at: "2026-09-01T08:00:00.000Z",
              },
            },
          },
          201
        )
      }
      if (path === "/api/v1/system/bootstrap") {
        return json({
          success: true,
          data: {
            initialized: true,
            system_name: "LinkSense",
            default_language: "zh-CN",
          },
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()

    await interaction.type(
      screen.getByLabelText("一次性初始化凭据"),
      "initialization-credential"
    )
    await interaction.type(screen.getByLabelText("管理员姓名"), "Administrator")
    await interaction.type(screen.getByLabelText("邮箱"), "admin@example.com")
    await interaction.type(screen.getByLabelText("新密码"), "Password1!")
    await interaction.type(screen.getByLabelText("确认新密码"), "Password1!")
    await interaction.click(
      screen.getByRole("button", { name: "创建管理员并完成初始化" })
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <BootstrapContext.Provider
          value={{
            bootstrap,
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          }}
        >
          <InitializePage />
        </BootstrapContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}
