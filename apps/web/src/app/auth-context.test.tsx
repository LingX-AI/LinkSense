import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  apiRequest,
  isDefinitiveAuthenticationError,
  refreshSession,
} from "@/api/client"
import { bootstrapSchema, type AuthSession, type User } from "@/api/contracts"
import { setAccessToken } from "@/api/session"
import { AuthProvider } from "@/app/auth-context"
import { useAuth } from "@/app/auth-state"
import { BootstrapContext } from "@/app/bootstrap-state"
import { setAppLanguage } from "@/i18n"

const sessionState = vi.hoisted(() => ({
  token: null as string | null,
  listeners: new Set<(token: string | null) => void>(),
}))

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn(),
  isDefinitiveAuthenticationError: vi.fn(),
  refreshSession: vi.fn(),
}))

vi.mock("@/api/session", () => ({
  getAccessToken: vi.fn(() => sessionState.token),
  setAccessToken: vi.fn((token: string | null) => {
    sessionState.token = token
    sessionState.listeners.forEach((listener) => listener(token))
  }),
  subscribeToAccessToken: vi.fn((listener: (token: string | null) => void) => {
    sessionState.listeners.add(listener)
    return () => sessionState.listeners.delete(listener)
  }),
}))

vi.mock("@/i18n", () => ({
  setAppLanguage: vi.fn().mockResolvedValue(undefined),
}))

const user: User = {
  id: "user-1",
  name: "One",
  email: "one@example.com",
  role: "admin",
  status: "active",
  avatar_url: null,
  language: "zh-CN",
  login_method: "password",
  running_message_action: "queue",
  registration_source: "organization_invitation",
  weekly_token_limit: null,
  monthly_token_limit: null,
  user_groups: [],
}

const bootstrap = bootstrapSchema.parse({
  initialized: true,
  system_name: "LinkSense",
  default_language: "zh-CN",
})

function AuthProbe() {
  const { status, user: currentUser } = useAuth()
  return (
    <>
      <output data-testid="auth-status">{status}</output>
      <output data-testid="auth-user">{currentUser?.email ?? ""}</output>
    </>
  )
}

function renderAuthProvider() {
  return render(
    <BootstrapContext.Provider
      value={{
        bootstrap,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }}
    >
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    </BootstrapContext.Provider>
  )
}

describe("AuthProvider session restoration", () => {
  beforeEach(() => {
    sessionState.token = null
    sessionState.listeners.clear()
    vi.mocked(apiRequest).mockReset()
    vi.mocked(refreshSession).mockReset()
    vi.mocked(isDefinitiveAuthenticationError).mockReset()
    vi.mocked(isDefinitiveAuthenticationError).mockReturnValue(false)
    vi.mocked(setAccessToken).mockClear()
    vi.mocked(setAppLanguage).mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("uses the persisted access token to load the user without rotating the refresh session", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue(user)

    renderAuthProvider()

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "authenticated"
    )
    expect(screen.getByTestId("auth-user")).toHaveTextContent(user.email)
    expect(apiRequest).toHaveBeenCalledWith("/me", expect.any(Object))
    expect(refreshSession).not.toHaveBeenCalled()
    expect(setAccessToken).not.toHaveBeenCalledWith(null)
  })

  it("applies the database language before exposing the restored session", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue({ ...user, language: "en-US" })
    let finishLanguageChange: (() => void) | undefined
    vi.mocked(setAppLanguage).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLanguageChange = resolve
        })
    )

    renderAuthProvider()

    await waitFor(() => expect(setAppLanguage).toHaveBeenCalledWith("en-US"))
    expect(screen.getByTestId("auth-status")).toHaveTextContent("loading")

    await act(async () => {
      finishLanguageChange?.()
    })

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "authenticated"
    )
  })

  it("keeps the browser-detected language when the account has no preference", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue({ ...user, language: null })

    renderAuthProvider()

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "authenticated"
    )
    expect(setAppLanguage).not.toHaveBeenCalled()
  })

  it("keeps the session loading after a temporary failure and retries automatically", async () => {
    vi.useFakeTimers()
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(user)

    renderAuthProvider()

    await act(async () => {
      await Promise.resolve()
    })
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("auth-status")).toHaveTextContent("loading")
    expect(sessionState.token).toBe("persisted-access-token")
    expect(setAccessToken).not.toHaveBeenCalledWith(null)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated")
    expect(apiRequest).toHaveBeenCalledTimes(2)
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it("clears the session only when refresh reports a definitive authentication failure", async () => {
    const expiredSessionError = new Error("refresh session expired")
    vi.mocked(refreshSession).mockRejectedValue(expiredSessionError)
    vi.mocked(isDefinitiveAuthenticationError).mockImplementation(
      (error) => error === expiredSessionError
    )

    renderAuthProvider()

    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent("anonymous")
    )
    expect(setAccessToken).toHaveBeenCalledWith(null)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it("persists the access-token expiry when accepting a new session", async () => {
    const session: AuthSession = {
      access_token: "new-access-token",
      access_token_expires_at: "2026-07-13T12:00:00.000Z",
    }
    vi.mocked(refreshSession).mockResolvedValue(session)
    vi.mocked(apiRequest).mockResolvedValue(user)

    renderAuthProvider()

    expect(await screen.findByTestId("auth-status")).toHaveTextContent(
      "authenticated"
    )
    expect(setAccessToken).toHaveBeenCalledWith(
      session.access_token,
      session.access_token_expires_at
    )
  })
})
