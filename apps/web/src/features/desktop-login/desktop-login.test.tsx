import { StrictMode } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { desktopLoginRedirectUri, supportedLocales } from "@linksense/shared"

import { AuthContext, type AuthContextValue } from "@/app/auth-state"
import { BootstrapContext } from "@/app/bootstrap-state"
import { bootstrapSchema } from "@/api/contracts"
import { LoginPage } from "@/pages/auth-pages"
import i18n from "@/i18n"
import { DesktopAuthorizePage } from "./desktop-login-page"
import { desktopLoginMessages } from "./messages"
import {
  clearDesktopLoginReturn,
  desktopLoginReturn,
  readDesktopLoginRequest,
  rememberDesktopLoginReturn,
} from "./return-destination"

const host = vi.hoisted(() => ({
  native: true,
  signIn: vi.fn<() => Promise<void>>(),
  cancel: vi.fn(async () => undefined),
  api: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock("@/adapters/desktop/mygo", () => ({
  Desktop: { signIn: host.signIn, cancelSignIn: host.cancel },
}))
vi.mock("@/adapters/desktop/desktop-adapter", async (original) => ({
  ...(await original<typeof import("@/adapters/desktop/desktop-adapter")>()),
  isDesktopHost: () => host.native,
}))
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: host.api,
  refreshSession: host.refresh,
}))

const request = {
  redirect_uri: desktopLoginRedirectUri,
  state: "s".repeat(43),
  code_challenge: "c".repeat(43),
  code_challenge_method: "S256",
}
const search = `?${new URLSearchParams(request)}`
const replace = vi.fn()

function LoginDestination() {
  const location = useLocation()
  return (
    <output data-testid="login-destination">
      {JSON.stringify(location.state)}
    </output>
  )
}

function page(
  kind: "native" | "authorize",
  status: AuthContextValue["status"] = "anonymous",
  query = search
) {
  const acceptSession = vi.fn(async () => undefined)
  const signOut = vi.fn(async () => undefined)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <BootstrapContext.Provider
          value={{
            bootstrap: bootstrapSchema.parse({ initialized: true }),
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          }}
        >
          <AuthContext.Provider
            value={{
              status,
              user: null,
              acceptSession,
              refreshUser: vi.fn(),
              signOut,
            }}
          >
            <MemoryRouter
              initialEntries={[
                kind === "native" ? "/login" : `/desktop/authorize${query}`,
              ]}
            >
              <Routes>
                <Route
                  path="/login"
                  element={
                    kind === "native" ? <LoginPage /> : <LoginDestination />
                  }
                />
                <Route
                  path="/desktop/authorize"
                  element={<DesktopAuthorizePage />}
                />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </BootstrapContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  )
  return { acceptSession, signOut }
}

beforeEach(async () => {
  host.native = true
  host.signIn.mockReset().mockResolvedValue(undefined)
  host.cancel.mockClear()
  host.api.mockReset()
  host.refresh.mockReset()
  replace.mockClear()
  localStorage.clear()
  vi.stubGlobal("location", {
    href: "http://localhost/",
    origin: "http://localhost",
    replace,
    reload: vi.fn(),
  })
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("desktop browser login UI", () => {
  it("opens the native browser flow without showing a server or password form", async () => {
    const session = { access_token: "native-access" }
    host.refresh.mockResolvedValue(session)
    const { acceptSession } = page("native")
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    await userEvent.click(
      screen.getByRole("button", { name: "在浏览器中登录" })
    )
    await waitFor(() => expect(acceptSession).toHaveBeenCalledWith(session))
    expect(host.signIn).toHaveBeenCalledOnce()
    expect(host.api).not.toHaveBeenCalled()
  })

  it("shows a retryable failure and does not restore a session after native sign-in fails", async () => {
    host.signIn.mockRejectedValue(new Error("native browser unavailable"))
    const { acceptSession } = page("native")
    await userEvent.click(
      screen.getByRole("button", { name: "在浏览器中登录" })
    )
    expect(
      await screen.findByText(desktopLoginMessages["zh-CN"].failed)
    ).toBeVisible()
    expect(host.refresh).not.toHaveBeenCalled()
    expect(acceptSession).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "在浏览器中登录" })).toBeEnabled()
  })

  it("cancels a pending native request without accepting a late result", async () => {
    let finish: () => void = () => {
      throw new Error("native request did not start")
    }
    host.signIn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const { acceptSession } = page("native")
    await userEvent.click(
      screen.getByRole("button", { name: "在浏览器中登录" })
    )
    expect(
      screen.getByRole("button", { name: "在浏览器中登录" })
    ).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(host.cancel).toHaveBeenCalled()
    finish()
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "在浏览器中登录" })
      ).toBeEnabled()
    )
    expect(acceptSession).not.toHaveBeenCalled()
    expect(host.refresh).not.toHaveBeenCalled()
  })

  it("discards a refresh result and clears the new native session when cancellation races refresh", async () => {
    let finish: (session: object) => void = () => {
      throw new Error("refresh did not start")
    }
    host.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const { acceptSession, signOut } = page("native")
    await userEvent.click(
      screen.getByRole("button", { name: "在浏览器中登录" })
    )
    await waitFor(() => expect(host.refresh).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByRole("button", { name: "取消" }))
    finish({ access_token: "late-access" })
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "在浏览器中登录" })
      ).toBeEnabled()
    )
    expect(signOut).toHaveBeenCalledOnce()
    expect(acceptSession).not.toHaveBeenCalled()
  })

  it("reuses an authenticated browser session and returns only a one-time code", async () => {
    host.native = false
    host.api.mockResolvedValue({ code: "k".repeat(43) })
    page("authorize", "authenticated")
    await waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(host.api).toHaveBeenCalledExactlyOnceWith(
      "/auth/desktop/authorize",
      expect.objectContaining({
        method: "POST",
        body: request,
      })
    )
    const callback = new URL(replace.mock.calls[0]?.[0] ?? "")
    expect(`${callback.protocol}//${callback.host}${callback.pathname}`).toBe(
      desktopLoginRedirectUri
    )
    expect(Object.fromEntries(callback.searchParams)).toEqual({
      code: "k".repeat(43),
      state: request.state,
    })
    expect(host.signIn).not.toHaveBeenCalled()
  })

  it("keeps the app link available when automatic launching is blocked", async () => {
    host.native = false
    host.api.mockResolvedValue({ code: "k".repeat(43) })
    replace.mockImplementationOnce(() => {
      throw new Error("browser blocked launch")
    })
    page("authorize", "authenticated")
    const link = await screen.findByRole("link", { name: "返回客户端" })
    expect(link.getAttribute("href")).toMatch(
      /^linksense-desktop:\/\/auth\/callback\?code=/u
    )
    expect(link).toHaveAttribute("referrerpolicy", "no-referrer")
  })

  it("preserves the full authorization request while an anonymous browser signs in", async () => {
    host.native = false
    page("authorize")
    const output = await screen.findByTestId("login-destination")
    expect(JSON.parse(output.textContent ?? "{}")).toEqual({
      from: `/desktop/authorize${search}`,
    })
    expect(desktopLoginReturn()).toBe(`/desktop/authorize${search}`)
    expect(host.api).not.toHaveBeenCalled()
  })

  it.each([
    "?redirect_uri=https://evil.example",
    `${search}&state=${"x".repeat(43)}`,
  ])(
    "rejects unsafe or ambiguous browser requests before making an API call: %s",
    async (query) => {
      host.native = false
      page("authorize", "authenticated", query)
      expect(
        screen.getByText(desktopLoginMessages["zh-CN"].invalid)
      ).toBeVisible()
      expect(host.api).not.toHaveBeenCalled()
      expect(replace).not.toHaveBeenCalled()
    }
  )

  it.each(supportedLocales)(
    "renders a translated native sign-in action for %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      page("native")
      expect(
        screen.getByRole("button", {
          name: desktopLoginMessages[locale].openBrowser,
        })
      ).toBeVisible()
      expect(i18n.getResource(locale, "translation", "desktopLogin")).toEqual(
        desktopLoginMessages[locale]
      )
    }
  )

  it("uses the Chinese fallback for missing locale resources", async () => {
    await i18n.changeLanguage("xx")
    page("native")
    expect(
      screen.getByRole("button", {
        name: desktopLoginMessages["zh-CN"].openBrowser,
      })
    ).toBeVisible()
  })
})

describe("browser login return destinations", () => {
  it("retains only a validated short-lived desktop destination across full-page SSO redirects", () => {
    rememberDesktopLoginReturn(search)
    expect(desktopLoginReturn()).toBe(`/desktop/authorize${search}`)
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + 5 * 60_000 + 1)
    expect(desktopLoginReturn()).toBeNull()
    expect(localStorage.getItem("linksense.desktop-login-return")).toBeNull()
  })

  it("makes the validated return request available to email activation in a new tab", () => {
    rememberDesktopLoginReturn(search)
    sessionStorage.clear()
    expect(desktopLoginReturn()).toBe(`/desktop/authorize${search}`)
    expect(
      localStorage.getItem("linksense.desktop-login-return")
    ).not.toContain("code_verifier")
    expect(
      localStorage.getItem("linksense.desktop-login-return")
    ).not.toContain("access_token")
    expect(
      localStorage.getItem("linksense.desktop-login-return")
    ).not.toContain("refresh_token")
  })

  it("rejects storage tampering, duplicate parameters and unknown fields", () => {
    expect(readDesktopLoginRequest(`${search}&access_token=bad`)).toBeNull()
    for (const destination of [
      "//evil.example/desktop/authorize" + search,
      "/api/v1/auth/login",
      "/desktop/authorize?state=invalid",
    ]) {
      localStorage.setItem(
        "linksense.desktop-login-return",
        JSON.stringify({ destination, expiresAt: Date.now() + 10_000 })
      )
      expect(desktopLoginReturn()).toBeNull()
    }
    rememberDesktopLoginReturn(search)
    clearDesktopLoginReturn()
    expect(desktopLoginReturn()).toBeNull()
  })
})
