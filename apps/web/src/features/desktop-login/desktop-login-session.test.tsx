import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { bootstrapSchema } from "@/api/contracts"
import { getAccessToken, setAccessToken } from "@/api/session"
import { AuthProvider } from "@/app/auth-context"
import { useAuth } from "@/app/auth-state"
import { BootstrapContext } from "@/app/bootstrap-state"
import i18n from "@/i18n"
import { DesktopSignInPage } from "./desktop-login-page"

const native = vi.hoisted(() => ({
  signIn: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  clear: vi.fn(async () => undefined),
}))
vi.mock("@/adapters/desktop/mygo", () => ({
  Desktop: { signIn: native.signIn, cancelSignIn: native.cancel },
}))
vi.mock("@/adapters/desktop/desktop-adapter", async (original) => ({
  ...(await original<typeof import("@/adapters/desktop/desktop-adapter")>()),
  isDesktopHost: () => true,
  clearDesktopSession: native.clear,
}))

function Probe() {
  const { status } = useAuth()
  return (
    <>
      <output data-testid="auth-status">{status}</output>
      {status === "anonymous" && <DesktopSignInPage />}
    </>
  )
}

function json(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { success: true, data }
        : { success: false, error_code: "AUTH_SESSION_EXPIRED" }
    ),
    {
      status,
      headers: {
        "content-type": "application/json",
        "x-linksense-desktop-protocol": "1",
      },
    }
  )
}

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Eli",
  email: "eli@example.com",
  role: "user",
  status: "active",
  avatar_object_key: null,
  avatar_url: null,
  preferred_locale: "zh-CN",
  language: "zh-CN",
  running_message_action: "queue",
  registration_source: "organization_invitation",
  last_login_method: "password",
  last_login_at: null,
  password_updated_at: null,
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
}

beforeEach(async () => {
  setAccessToken(null)
  await i18n.changeLanguage("zh-CN")
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  setAccessToken(null)
  vi.unstubAllGlobals()
})

describe("desktop cancellation with real auth effects", () => {
  it.each(["refresh", "current-user"])(
    "keeps the final session anonymous when cancellation races a late %s response",
    async (phase) => {
      let finish: () => void = () => {
        throw new Error("delayed response did not start")
      }
      let refreshCount = 0
      let logoutCount = 0
      let delayed = false
      const session = {
        access_token: "access-token-from-native-session-000000000000",
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        refresh_session_expires_at: new Date(
          Date.now() + 86400_000
        ).toISOString(),
        user: Object.fromEntries(
          Object.entries(user).filter(
            ([key]) =>
              !["avatar_url", "language", "registration_source"].includes(key)
          )
        ),
      }
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const path = new URL(
            input instanceof Request ? input.url : String(input),
            "http://localhost"
          ).pathname
          if (path === "/api/v1/auth/logout") {
            logoutCount += 1
            return new Response(null, {
              status: 204,
              headers: { "x-linksense-desktop-protocol": "1" },
            })
          }
          if (path === "/api/v1/auth/refresh") {
            refreshCount += 1
            if (refreshCount === 1) return json(null, 401)
            if (phase === "refresh") {
              delayed = true
              return new Promise<Response>((resolve) => {
                finish = () => resolve(json(session))
              })
            }
            return json(session)
          }
          if (path === "/api/v1/me" && phase === "current-user") {
            delayed = true
            return new Promise<Response>((resolve) => {
              finish = () => resolve(json(user))
            })
          }
          throw new Error(`Unexpected auth fixture route: ${path}`)
        })
      )
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      render(
        <QueryClientProvider client={client}>
          <BootstrapContext.Provider
            value={{
              bootstrap: bootstrapSchema.parse({ initialized: true }),
              isLoading: false,
              error: null,
              refetch: vi.fn(),
            }}
          >
            <AuthProvider>
              <MemoryRouter>
                <Probe />
              </MemoryRouter>
            </AuthProvider>
          </BootstrapContext.Provider>
        </QueryClientProvider>
      )
      await userEvent.click(
        await screen.findByRole("button", { name: "在浏览器中登录" })
      )
      await waitFor(() => expect(delayed).toBe(true))
      await userEvent.click(screen.getByRole("button", { name: "取消" }))
      expect(logoutCount).toBe(0)
      finish()
      await waitFor(() => {
        expect(logoutCount).toBe(1)
        expect(screen.getByTestId("auth-status")).toHaveTextContent("anonymous")
        expect(getAccessToken()).toBeNull()
        expect(native.clear).toHaveBeenCalledOnce()
      })
      expect(
        screen.getByRole("button", { name: "在浏览器中登录" })
      ).toBeEnabled()
    }
  )
})
