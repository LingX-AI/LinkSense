import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"
import { supportedLocales } from "@linksense/shared"

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

const initializationResult = {
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
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("InitializePage", () => {
  it.each(supportedLocales)(
    "marks all required initialization fields with red indicators in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      renderPage()
      for (const id of [
        "initialization-credential",
        "admin-name",
        "admin-email",
        "admin-password",
        "admin-password-confirm",
      ]) {
        const label = document.querySelector(`label[for="${id}"]`)
        expect(label?.lastElementChild).toHaveTextContent("*")
        expect(label?.lastElementChild).toHaveClass("text-destructive")
        expect(label?.lastElementChild).toHaveAttribute("aria-hidden", "true")
      }
    }
  )

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("places the language selector at the page top right with the shared compact radius", () => {
    renderPage()
    const selector = screen.getByRole("combobox", { name: "界面语言" })
    expect(selector.closest("main")).toBeNull()
    expect(selector.parentElement).toHaveClass("justify-end", "shrink-0")
    expect(selector.parentElement?.parentElement).toHaveClass("public-shell")
    expect(selector).toHaveClass("rounded-md")
    expect(selector).not.toHaveClass("rounded-lg", "rounded-full")
  })

  it("reports every invalid field inline and focuses the first one", async () => {
    const interaction = userEvent.setup()
    renderPage()
    expect(
      screen.getByRole("link", { name: "由 LinkSense 提供支持" })
    ).toHaveClass(
      "mr-3",
      "-mb-2.5",
      "max-md:mr-0",
      "max-md:self-center",
      "max-md:mb-1"
    )

    await interaction.click(
      screen.getByRole("button", { name: "创建管理员并完成初始化" })
    )

    const credential = screen.getByLabelText(/^一次性初始化凭据\s*\*?$/u)
    expect(credential).toHaveFocus()
    expect(credential).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("textbox", { name: "管理员姓名" })).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByRole("textbox", { name: "邮箱" })).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByLabelText(/^新密码\s*\*?$/u)).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByLabelText(/^确认新密码\s*\*?$/u)).toHaveAttribute(
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
            data: initializationResult,
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
      screen.getByLabelText(/^一次性初始化凭据\s*\*?$/u),
      "initialization-credential"
    )
    await interaction.type(
      screen.getByRole("textbox", { name: "管理员姓名" }),
      "Administrator"
    )
    await interaction.type(
      screen.getByRole("textbox", { name: "邮箱" }),
      "admin@example.com"
    )
    await interaction.type(
      screen.getByLabelText(/^新密码\s*\*?$/u),
      "Password1!"
    )
    await interaction.type(
      screen.getByLabelText(/^确认新密码\s*\*?$/u),
      "Password1!"
    )
    await interaction.click(
      screen.getByRole("button", { name: "创建管理员并完成初始化" })
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it("refreshes a fresh uninitialized bootstrap cache after creating the administrator", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 15_000 },
        mutations: { retry: false },
      },
    })
    queryClient.setQueryData(["system", "bootstrap"], bootstrap)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (path === "/api/v1/system/initialize") {
        return json({ success: true, data: initializationResult }, 201)
      }
      if (path === "/api/v1/system/bootstrap") {
        return json({
          success: true,
          data: { ...bootstrap, initialized: true },
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage(queryClient)
    await fillValidInitializationForm(interaction)

    await interaction.click(
      screen.getByRole("button", { name: "创建管理员并完成初始化" })
    )

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(["system", "bootstrap"])).toMatchObject({
        initialized: true,
      })
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("preserves the administrator fields when initialization fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ success: false, error_code: "INTERNAL_ERROR" }, 500)
      )
    )
    const interaction = userEvent.setup()
    renderPage()
    await fillValidInitializationForm(interaction)

    await interaction.click(
      screen.getByRole("button", { name: "创建管理员并完成初始化" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("errors.unknown")
    )
    expect(screen.getByRole("textbox", { name: "管理员姓名" })).toHaveValue(
      "Administrator"
    )
    expect(screen.getByRole("textbox", { name: "邮箱" })).toHaveValue(
      "admin@example.com"
    )
    expect(screen.getByLabelText(/^新密码\s*\*?$/u)).toHaveValue("Password1!")
    expect(screen.getByLabelText(/^确认新密码\s*\*?$/u)).toHaveValue(
      "Password1!"
    )
  })

  it("replaces an in-flight pre-initialization bootstrap read with a fresh successful read", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    queryClient.setQueryData(["system", "bootstrap"], bootstrap)
    let previousReadAborted = false
    const previousRead = queryClient
      .fetchQuery({
        queryKey: ["system", "bootstrap"],
        queryFn: ({ signal }) =>
          new Promise<typeof bootstrap>((resolve) => {
            signal.addEventListener("abort", () => {
              previousReadAborted = true
              resolve(bootstrap)
            })
          }),
      })
      .catch(() => undefined)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (path === "/api/v1/system/initialize") {
        return json({ success: true, data: initializationResult }, 201)
      }
      if (path === "/api/v1/system/bootstrap") {
        return json({
          success: true,
          data: { ...bootstrap, initialized: true },
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage(queryClient)
    await fillValidInitializationForm(interaction)

    await interaction.click(
      screen.getByRole("button", { name: "创建管理员并完成初始化" })
    )

    try {
      await vi.waitFor(() =>
        expect(queryClient.getQueryData(["system", "bootstrap"])).toMatchObject(
          {
            initialized: true,
          }
        )
      )
      expect(previousReadAborted).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      await queryClient.cancelQueries({ queryKey: ["system", "bootstrap"] })
      await previousRead
    }
  })
})

async function fillValidInitializationForm(
  interaction: ReturnType<typeof userEvent.setup>
) {
  await interaction.type(
    screen.getByLabelText(/^一次性初始化凭据\s*\*?$/u),
    "initialization-credential"
  )
  await interaction.type(
    screen.getByRole("textbox", { name: "管理员姓名" }),
    "Administrator"
  )
  await interaction.type(
    screen.getByRole("textbox", { name: "邮箱" }),
    "admin@example.com"
  )
  await interaction.type(screen.getByLabelText(/^新密码\s*\*?$/u), "Password1!")
  await interaction.type(
    screen.getByLabelText(/^确认新密码\s*\*?$/u),
    "Password1!"
  )
}

function renderPage(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
) {
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
