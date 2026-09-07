import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import {
  apiRequest,
  isDefinitiveAuthenticationError,
  isRetryableApiError,
  refreshSession,
} from "@/api/client"
import { bootstrapSchema, type AccessSession, type User } from "@/api/contracts"
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
  isRetryableApiError: vi.fn(),
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
  const { status, user: currentUser, signOut } = useAuth()
  return (
    <>
      <output data-testid="auth-status">{status}</output>
      <output data-testid="auth-user">{currentUser?.email ?? ""}</output>
      <button type="button" onClick={() => void signOut()}>
        sign out
      </button>
    </>
  )
}

function AuthRefreshProbe({ onRender }: { onRender: () => void }) {
  const { refreshUser } = useAuth()
  onRender()
  return (
    <button type="button" onClick={() => void refreshUser()}>
      refresh user
    </button>
  )
}

function createAuthQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderAuthProvider(
  queryClient = createAuthQueryClient(),
  children: ReactNode = <AuthProbe />
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <BootstrapContext.Provider
        value={{
          bootstrap,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }}
      >
        <AuthProvider>{children}</AuthProvider>
      </BootstrapContext.Provider>
    </QueryClientProvider>
  )
}

async function expectAuthStatus(status: string) {
  await waitFor(() =>
    expect(screen.getByTestId("auth-status")).toHaveTextContent(status)
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
    vi.mocked(isRetryableApiError).mockReset()
    vi.mocked(isRetryableApiError).mockReturnValue(false)
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

    await expectAuthStatus("authenticated")
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

    await expectAuthStatus("authenticated")
  })

  it("keeps the browser-detected language when the account has no preference", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue({ ...user, language: null })

    renderAuthProvider()

    await expectAuthStatus("authenticated")
    expect(setAppLanguage).not.toHaveBeenCalled()
  })

  it("does not broadcast an unchanged user snapshot to auth consumers", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockImplementation(async () => ({
      ...user,
      user_groups: [],
    }))
    const onRender = vi.fn()

    renderAuthProvider(
      createAuthQueryClient(),
      <>
        <AuthProbe />
        <AuthRefreshProbe onRender={onRender} />
      </>
    )
    await expectAuthStatus("authenticated")
    const renderCountAfterRestore = onRender.mock.calls.length

    fireEvent.click(screen.getByRole("button", { name: "refresh user" }))
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2))
    await act(async () => {
      await Promise.resolve()
    })

    expect(onRender).toHaveBeenCalledTimes(renderCountAfterRestore)
  })

  it("clears account queries and model preferences before signing out", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockImplementation(async (path) =>
      path === "/me" ? user : null
    )
    const queryClient = createAuthQueryClient()
    queryClient.setQueryData(["system", "bootstrap"], bootstrap)
    queryClient.setQueryData(["conversations", "sidebar"], {
      pages: [{ items: [{ id: "previous-account-task" }] }],
    })
    queryClient.setQueryData(["me", "model-preference", "new"], {
      selected_model: "previous-account-model",
    })

    renderAuthProvider(queryClient)
    await expectAuthStatus("authenticated")

    fireEvent.click(screen.getByRole("button", { name: "sign out" }))

    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent("anonymous")
    )
    expect(
      queryClient.getQueryData(["conversations", "sidebar"])
    ).toBeUndefined()
    expect(
      queryClient.getQueryData(["me", "model-preference", "new"])
    ).toBeUndefined()
    expect(queryClient.getQueryData(["system", "bootstrap"])).toEqual(bootstrap)
  })

  it("keeps the session loading after a temporary failure and retries automatically", async () => {
    vi.useFakeTimers()
    vi.mocked(isRetryableApiError).mockReturnValue(true)
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

  it("stops immediately when session restoration fails with a non-retryable response", async () => {
    vi.useFakeTimers()
    vi.mocked(refreshSession).mockRejectedValue(
      new Error("invalid authentication response")
    )

    renderAuthProvider()

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId("auth-status")).toHaveTextContent("error")
    expect(refreshSession).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it("stops after three attempts when session restoration keeps failing temporarily", async () => {
    vi.useFakeTimers()
    vi.mocked(isRetryableApiError).mockReturnValue(true)
    vi.mocked(refreshSession).mockRejectedValue(
      new Error("service unavailable")
    )

    renderAuthProvider()

    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(4_000)
    })

    expect(refreshSession).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId("auth-status")).toHaveTextContent("error")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(refreshSession).toHaveBeenCalledTimes(3)
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
    const session: AccessSession = {
      access_token: "new-access-token",
      access_token_expires_at: "2026-07-13T12:00:00.000Z",
    }
    vi.mocked(refreshSession).mockResolvedValue(session)
    vi.mocked(apiRequest).mockResolvedValue(user)

    renderAuthProvider()

    await expectAuthStatus("authenticated")
    expect(setAccessToken).toHaveBeenCalledWith(
      session.access_token,
      session.access_token_expires_at
    )
  })
})
