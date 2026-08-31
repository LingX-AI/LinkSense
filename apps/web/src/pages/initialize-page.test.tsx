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
