import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import {
  socialProviderSchema,
  type SocialProviderSettings,
} from "@linksense/shared"
import { AuthContext } from "@/app/auth-state"
import { setAccessToken } from "@/api/session"
import i18n from "@/i18n"
import { AdminSocialSettings } from "./admin-social-settings"
import { SocialLoginButtons } from "./social-login-buttons"
import { SocialAccounts } from "./social-accounts"
import { SocialCallbackPage } from "./social-callback-page"
import { socialEnUS, socialZhCN } from "./messages"
import microsoftLogo from "./assets/microsoft.svg"

const settings: SocialProviderSettings[] = socialProviderSchema.options.map(
  (provider) => ({
    provider,
    revision: 1,
    enabled: true,
    client_id: `${provider}-app`,
    secret_configured: true,
    team_id: provider === "apple" ? "TEAM123456" : null,
    key_id: provider === "apple" ? "KEY1234567" : null,
    graph_api_version: provider === "facebook" ? "v24.0" : null,
    redirect_uri: `https://app.example.test/api/v1/auth/social/${provider}/callback`,
  })
)
function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { success: true, data }
        : { success: false, error_code: "SOCIAL_AUTH_FAILED" }
    ),
    { status, headers: { "content-type": "application/json" } }
  )
}
function mount(element: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const auth = {
    status: "anonymous" as const,
    user: null,
    acceptSession: vi.fn(async () => {}),
    refreshUser: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
  }
  return {
    auth,
    client,
    ...render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <MemoryRouter>{element}</MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    ),
  }
}
beforeEach(async () => {
  setAccessToken("test-social-token")
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState({}, "", "/")
  setAccessToken(null)
})

describe("social sign-in UI", () => {
  it.each(["zh-CN", "en-US", "de-DE"])(
    "renders provider buttons and errors in %s including fallback",
    async (language) => {
      await i18n.changeLanguage(language)
      const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? response(null, 400)
          : response(["google", "apple"])
      )
      vi.stubGlobal("fetch", fetch)
      mount(<SocialLoginButtons />)
      const google = await screen.findByRole("button", {
        name: i18n.t("social.continueWith", { provider: "Google" }),
      })
      expect(
        screen.queryByRole("button", { name: /Facebook/ })
      ).not.toBeInTheDocument()
      fireEvent.click(google)
      expect(await screen.findByRole("alert")).toHaveTextContent(
        i18n.t("errors.socialAuthFailed")
      )
      expect(
        fetch.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/auth/social/google/start") &&
            init?.method === "POST"
        )
      ).toBe(true)
    }
  )
  it("hides the social section when no provider is enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response([]))
    )
    const { container } = mount(<SocialLoginButtons />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
  it("disables all provider buttons while authorization starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Promise<Response>(() => {})
          : response(["google", "apple"])
      )
    )
    mount(<SocialLoginButtons />)
    fireEvent.click(
      await screen.findByRole("button", { name: "使用 Google 继续" })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "使用 Apple 继续" })
      ).toBeDisabled()
    )
  })
  it("shows every provider with its brand logo on a white bordered button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(socialProviderSchema.options))
    )
    mount(<SocialLoginButtons />)
    for (const provider of socialProviderSchema.options) {
      const button = await screen.findByRole("button", {
        name: i18n.t("social.continueWith", {
          provider: i18n.t(`social.providers.${provider}`),
        }),
      })
      expect(button).toHaveAttribute("data-social-provider", provider)
      expect(button).toHaveClass("bg-white", "border-[#e2e5e9]")
      expect(button).not.toHaveClass("shadow-sm")
      const logo = button.querySelector(
        `[data-social-provider-logo="${provider}"]`
      )
      expect(logo).toBeInTheDocument()
      expect(logo?.className).not.toMatch(/(?:border|ring|shadow)-/u)
      expect(logo?.nextElementSibling).toHaveAttribute(
        "data-social-provider-label"
      )
    }
  })
  it("optically balances the Google and Microsoft brand marks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(["google", "microsoft"]))
    )
    mount(<SocialLoginButtons />)
    const google = await screen.findByRole("button", {
      name: "使用 Google 继续",
    })
    const microsoft = screen.getByRole("button", {
      name: i18n.t("social.continueWith", {
        provider: i18n.t("social.providers.microsoft"),
      }),
    })
    expect(
      google.querySelector('[data-social-provider-logo="google"] svg')
    ).toHaveClass("size-[1.375rem]")
    expect(
      microsoft.querySelector('[data-social-provider-logo="microsoft"] img')
    ).toHaveClass("size-full")
  })
  it("loads four settings rows, opens one configuration dialog, and omits blank secrets on save", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      response(
        init?.method === "PUT"
          ? settings.map((entry) => ({ ...entry, revision: 2 }))
          : settings
      )
    )
    vi.stubGlobal("fetch", fetch)
    mount(<AdminSocialSettings />)
    const row = await screen.findByRole("region", { name: "Google" })
    settings.forEach(({ provider }) => {
      const heading = screen.getByRole("heading", {
        name: i18n.t(`social.providers.${provider}`),
      })
      const logo = heading.querySelector(
        `[data-social-provider-logo="${provider}"]`
      )
      expect(logo).toHaveAttribute("aria-hidden", "true")
      expect(heading.firstElementChild).toBe(logo)
      expect(logo?.querySelector("svg, img")).toBeInTheDocument()
    })
    expect(screen.getAllByRole("button", { name: /^配置 / })).toHaveLength(4)
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("应用密钥")).not.toBeInTheDocument()
    fireEvent.click(within(row).getByRole("button", { name: "配置 Google" }))
    const google = await screen.findByRole("dialog", { name: "配置 Google" })
    expect(within(google).getAllByRole("switch")).toHaveLength(1)
    expect(within(google).getByLabelText("应用密钥")).toHaveValue("")
    expect(within(google).getByLabelText("授权回调地址")).toHaveAttribute(
      "readonly"
    )
    fireEvent.click(within(google).getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(
        true
      )
    )
    const save = fetch.mock.calls.find(([, init]) => init?.method === "PUT")
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({
      enabled: true,
      expected_revision: 1,
      client_id: "google-app",
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  })
  it("rejects an enabled provider without required credentials before sending", async () => {
    const fetch = vi.fn(async () =>
      response(
        settings.map((entry) => ({ ...entry, secret_configured: false }))
      )
    )
    vi.stubGlobal("fetch", fetch)
    mount(<AdminSocialSettings />)
    fireEvent.click(await screen.findByRole("button", { name: "配置 Google" }))
    const google = await screen.findByRole("dialog", { name: "配置 Google" })
    fireEvent.click(within(google).getByRole("button", { name: "保存" }))
    expect(await within(google).findByRole("alert")).toHaveTextContent(
      i18n.t("errors.validation")
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(socialProviderSchema.options)(
    "shows the same brand logo for %s in its row and configuration dialog",
    async (provider) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response(settings))
      )
      mount(<AdminSocialSettings />)
      const name = i18n.t(`social.providers.${provider}`)
      const row = await screen.findByRole("region", { name })
      const logo = row.querySelector(
        `[data-social-provider-logo="${provider}"]`
      )
      expect(logo).toBeInTheDocument()
      if (provider === "facebook")
        expect(logo?.querySelector("svg")).toHaveAttribute("fill", "#0866ff")
      if (provider === "google") {
        expect(logo?.querySelector("svg")).toBeInTheDocument()
        expect(logo?.querySelectorAll("path").length).toBeGreaterThan(1)
      }
      if (provider === "microsoft")
        expect(logo?.querySelector("img")).toHaveAttribute("src", microsoftLogo)
      fireEvent.click(
        within(row).getByRole("button", {
          name: i18n.t("social.configureProvider", { provider: name }),
        })
      )
      const dialog = await screen.findByRole("dialog")
      const heading = within(dialog).getByRole("heading", {
        name: i18n.t("social.configureProvider", { provider: name }),
      })
      expect(
        heading.querySelector(`[data-social-provider-logo="${provider}"]`)
          ?.innerHTML
      ).toBe(logo?.innerHTML)
    }
  )
  it.each(["zh-CN", "en-US", "de-DE"])(
    "localizes provider row actions and statuses in %s including fallback",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          response(
            settings.map((entry) => ({
              ...entry,
              enabled: entry.provider === "google",
              secret_configured: entry.provider !== "apple",
            }))
          )
        )
      )
      mount(<AdminSocialSettings />)
      const google = await screen.findByRole("region", { name: "Google" })
      expect(
        within(google).getByText(i18n.t("social.statusEnabled"))
      ).toBeVisible()
      expect(
        within(screen.getByRole("region", { name: "Apple" })).getByText(
          i18n.t("social.statusNotConfigured")
        )
      ).toBeVisible()
      expect(
        within(
          screen.getByRole("region", {
            name: i18n.t("social.providers.microsoft"),
          })
        ).getByText(i18n.t("social.statusDisabled"))
      ).toBeVisible()
      fireEvent.click(
        within(google).getByRole("button", {
          name: i18n.t("social.configureProvider", { provider: "Google" }),
        })
      )
      expect(
        await screen.findByRole("dialog", {
          name: i18n.t("social.configureProvider", { provider: "Google" }),
        })
      ).toBeVisible()
    }
  )
  it("discards cancelled credentials and preserves the saved values on reopening", async () => {
    const fetch = vi.fn(async () => response(settings))
    vi.stubGlobal("fetch", fetch)
    mount(<AdminSocialSettings />)
    fireEvent.click(await screen.findByRole("button", { name: "配置 Google" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("应用 ID"), {
      target: { value: "unsaved-app" },
    })
    fireEvent.change(within(dialog).getByLabelText("应用密钥"), {
      target: { value: "unsaved-secret" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole("button", { name: "配置 Google" }))
    const reopened = await screen.findByRole("dialog")
    expect(within(reopened).getByLabelText("应用 ID")).toHaveValue("google-app")
    expect(within(reopened).getByLabelText("应用密钥")).toHaveValue("")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("keeps configuration open on save failure and disables actions while saving", async () => {
    let complete: (result: Response) => void = () => {
      throw new Error("Save has not started")
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "PUT"
          ? new Promise<Response>((resolve) => {
              complete = resolve
            })
          : response(settings)
      )
    )
    mount(<AdminSocialSettings />)
    fireEvent.click(await screen.findByRole("button", { name: "配置 Google" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "保存" })
      ).toBeDisabled()
    )
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled()
    expect(within(dialog).getByRole("switch")).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    fireEvent.click(within(dialog).getByRole("switch"))
    expect(within(dialog).getByRole("switch")).toBeChecked()
    complete(response(null, 400))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      i18n.t("errors.socialAuthFailed")
    )
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeEnabled()
    expect(within(dialog).getByLabelText("应用 ID")).toHaveValue("google-app")
  })
  it("shows linked providers even after an admin disables them, requiring confirmation before unlink", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return response(null, 400)
      return response(
        String(url).endsWith("/providers")
          ? []
          : [{ provider: "google", created_at: "2026-09-21T00:00:00.000Z" }]
      )
    })
    vi.stubGlobal("fetch", fetch)
    mount(<SocialAccounts />)
    fireEvent.click(await screen.findByRole("button", { name: "解除关联" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(
      false
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "解除关联" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      i18n.t("errors.socialAuthFailed")
    )
  })
  it("shows email conflicts without silently creating or merging an account", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/social/callback?result=email_exists"
    )
    mount(<SocialCallbackPage />)
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("social.errors.email_exists")
    )
    expect(window.location.search).toBe("")
    expect(
      screen.getByRole("link", { name: "返回账号安全设置" })
    ).toHaveAttribute("href", "/settings/security")
  })
  it("accepts an email for a pending registration and shows mail instructions", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/social/callback?result=verify_email"
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ sent: true }))
    )
    mount(<SocialCallbackPage />)
    fireEvent.change(screen.getByLabelText(i18n.t("common.email")), {
      target: { value: "member@example.test" },
    })
    fireEvent.click(screen.getByRole("button", { name: "发送验证邮件" }))
    expect(await screen.findByRole("status")).toHaveTextContent(
      i18n.t("social.emailSent")
    )
  })
  it("removes the email proof from the address bar and requires an explicit confirmation", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/social/callback#token=one-use-email-proof"
    )
    const fetch = vi.fn(async () => response({ result: "failed" }))
    vi.stubGlobal("fetch", fetch)
    mount(<SocialCallbackPage />)
    expect(window.location.hash).toBe("")
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "验证并完成注册" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("social.errors.failed")
    )
  })
  it("keeps Chinese and English social resource keys aligned", () => {
    const keys = (value: object): string[] =>
      Object.entries(value)
        .flatMap(([key, entry]) =>
          typeof entry === "object"
            ? keys(entry).map((child) => `${key}.${child}`)
            : [key]
        )
        .sort()
    expect(keys(socialZhCN)).toEqual(keys(socialEnUS))
  })
})
