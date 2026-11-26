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
import { clearDesktopSession } from "@/adapters/desktop/desktop-adapter"
import { ensureDesktopDeviceForAuthRestore } from "@/adapters/desktop/desktop-device-adapter"

const sessionState = vi.hoisted(() => ({
  token: null as string | null,
  listeners: new Set<
    (token: string | null, reason: "session" | "storage") => void
  >(),
  loginSessionBoundary: 0,
}))

const hostState = vi.hoisted(() => ({ mac: false }))

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn(),
  isDefinitiveAuthenticationError: vi.fn(),
  isRetryableApiError: vi.fn(),
  refreshSession: vi.fn(),
}))

vi.mock("@/api/session", () => ({
  beginLoginSession: vi.fn(() => {
    sessionState.loginSessionBoundary += 1
    return sessionState.loginSessionBoundary
  }),
  getAccessToken: vi.fn(() => sessionState.token),
  getLoginSessionBoundary: vi.fn(() => sessionState.loginSessionBoundary),
  isLoginSessionCurrent: vi.fn(
    (boundary: number) => boundary === sessionState.loginSessionBoundary
  ),
  setAccessToken: vi.fn((token: string | null) => {
    sessionState.token = token
    sessionState.listeners.forEach((listener) => listener(token, "session"))
  }),
  subscribeToAccessToken: vi.fn(
    (
      listener: (token: string | null, reason: "session" | "storage") => void
    ) => {
      sessionState.listeners.add(listener)
      return () => sessionState.listeners.delete(listener)
    }
  ),
}))

vi.mock("@/i18n", () => ({
  setAppLanguage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  clearDesktopSession: vi.fn().mockResolvedValue(undefined),
  isMacDesktopHost: () => hostState.mac,
}))

vi.mock("@/adapters/desktop/desktop-device-adapter", () => ({
  ensureDesktopDeviceForAuthRestore: vi.fn().mockResolvedValue(null),
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
  weekly_credit_limit: null,
  user_groups: [],
}

const bootstrap = bootstrapSchema.parse({
  initialized: true,
  system_name: "LinkSense",
  default_language: "zh-CN",
})

function AuthProbe({
  nextSession,
  onSignOutError,
}: {
  nextSession?: AccessSession
  onSignOutError?: (error: unknown) => void
}) {
  const {
    status,
    user: currentUser,
    acceptSession,
    retryRestore,
    signOut,
  } = useAuth()
  return (
    <>
      <output data-testid="auth-status">{status}</output>
      <output data-testid="auth-user">{currentUser?.email ?? ""}</output>
      <button
        type="button"
        onClick={() => void signOut().catch((error) => onSignOutError?.(error))}
      >
        sign out
      </button>
      {nextSession && (
        <button type="button" onClick={() => void acceptSession(nextSession)}>
          accept next session
        </button>
      )}
      <button type="button" onClick={() => retryRestore?.()}>
        retry restore
      </button>
    </>
  )
}

function AuthRefreshProbe({
  onRender,
  signal,
}: {
  onRender: () => void
  signal?: AbortSignal
}) {
  const { refreshUser } = useAuth()
  onRender()
  return (
    <button type="button" onClick={() => void refreshUser({ signal })}>
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
    sessionState.loginSessionBoundary = 0
    hostState.mac = false
    vi.mocked(apiRequest).mockReset()
    vi.mocked(refreshSession).mockReset()
    vi.mocked(isDefinitiveAuthenticationError).mockReset()
    vi.mocked(isDefinitiveAuthenticationError).mockReturnValue(false)
    vi.mocked(isRetryableApiError).mockReset()
    vi.mocked(isRetryableApiError).mockReturnValue(false)
    vi.mocked(setAccessToken).mockClear()
    vi.mocked(setAppLanguage).mockClear()
    vi.mocked(clearDesktopSession).mockReset().mockResolvedValue(undefined)
    vi.mocked(ensureDesktopDeviceForAuthRestore)
      .mockReset()
      .mockResolvedValue(null)
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

  it("resumes the paired Mac after the Web session is verified", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue(user)

    renderAuthProvider()

    await expectAuthStatus("authenticated")
    await waitFor(() =>
      expect(ensureDesktopDeviceForAuthRestore).toHaveBeenCalledExactlyOnceWith(
        user.id
      )
    )
  })

  it("clears native credentials before completing local sign-out when the API is unreachable", async () => {
    sessionState.token = "persisted-access-token"
    const unavailable = new Error("network unavailable")
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === "/auth/logout") throw unavailable
      return user
    })
    const onSignOutError = vi.fn()
    renderAuthProvider(
      createAuthQueryClient(),
      <AuthProbe onSignOutError={onSignOutError} />
    )
    await expectAuthStatus("authenticated")
    fireEvent.click(screen.getByRole("button", { name: "sign out" }))
    await waitFor(() =>
      expect(onSignOutError).toHaveBeenCalledWith(unavailable)
    )
    expect(clearDesktopSession).toHaveBeenCalledOnce()
    await expectAuthStatus("anonymous")
    expect(sessionState.token).toBeNull()
  })

  it("clears memory and account caches while reporting a failed native credential deletion", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue(user)
    const lockedStore = new Error("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
    vi.mocked(clearDesktopSession).mockRejectedValueOnce(lockedStore)
    const onSignOutError = vi.fn()
    renderAuthProvider(
      createAuthQueryClient(),
      <AuthProbe onSignOutError={onSignOutError} />
    )
    await expectAuthStatus("authenticated")
    fireEvent.click(screen.getByRole("button", { name: "sign out" }))
    await waitFor(() =>
      expect(onSignOutError).toHaveBeenCalledWith(lockedStore)
    )
    await expectAuthStatus("anonymous")
    expect(sessionState.token).toBeNull()
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

  it("does not apply a late profile or language after an abortable refresh is cancelled", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValueOnce(user)
    const controller = new AbortController()
    let finish!: (value: User) => void
    const nextProfile = new Promise<User>((resolve) => {
      finish = resolve
    })
    renderAuthProvider(
      createAuthQueryClient(),
      <>
        <AuthProbe />
        <AuthRefreshProbe onRender={vi.fn()} signal={controller.signal} />
      </>
    )
    await expectAuthStatus("authenticated")
    vi.mocked(setAppLanguage).mockClear()
    vi.mocked(apiRequest).mockImplementationOnce(async () => nextProfile)
    fireEvent.click(screen.getByRole("button", { name: "refresh user" }))
    expect(apiRequest).toHaveBeenLastCalledWith(
      "/me",
      expect.objectContaining({ signal: controller.signal })
    )
    controller.abort()
    await act(async () => {
      finish({ ...user, email: "other@example.test", language: "en-US" })
      await nextProfile
    })
    expect(screen.getByTestId("auth-user")).toHaveTextContent(user.email)
    expect(setAppLanguage).not.toHaveBeenCalled()
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

  it("does not let an earlier sign-out clear a replacement login that arrives while logout is pending", async () => {
    sessionState.token = "old-login-token"
    const replacement: AccessSession = {
      access_token: "replacement-login-token",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
    }
    const replacementUser: User = {
      ...user,
      id: "user-2",
      email: "two@example.com",
    }
    let finishLogout!: () => void
    const logoutResponse = new Promise<unknown>((resolve) => {
      finishLogout = () => resolve(null)
    })
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === "/auth/logout") return logoutResponse
      return sessionState.token === replacement.access_token
        ? replacementUser
        : user
    })
    const queryClient = createAuthQueryClient()
    queryClient.setQueryData(["conversations", "sidebar"], {
      pages: [{ items: [{ id: "replacement-login-task" }] }],
    })
    renderAuthProvider(queryClient, <AuthProbe nextSession={replacement} />)
    await expectAuthStatus("authenticated")
    expect(screen.getByTestId("auth-user")).toHaveTextContent(user.email)

    fireEvent.click(screen.getByRole("button", { name: "sign out" }))
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/auth/logout",
        expect.objectContaining({ skipRefresh: true })
      )
    )
    fireEvent.click(screen.getByRole("button", { name: "accept next session" }))
    await waitFor(() =>
      expect(screen.getByTestId("auth-user")).toHaveTextContent(
        replacementUser.email
      )
    )
    expect(sessionState.token).toBe(replacement.access_token)

    await act(async () => {
      finishLogout()
      await logoutResponse
    })

    await expectAuthStatus("authenticated")
    expect(screen.getByTestId("auth-user")).toHaveTextContent(
      replacementUser.email
    )
    expect(sessionState.token).toBe(replacement.access_token)
    expect(
      queryClient.getQueryData(["conversations", "sidebar"])
    ).toMatchObject({
      pages: [{ items: [{ id: "replacement-login-task" }] }],
    })
    expect(clearDesktopSession).not.toHaveBeenCalled()
  })

  it("removes account-scoped data at the same time a live session loses its token", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue(user)
    const queryClient = createAuthQueryClient()
    queryClient.setQueryData(["system", "bootstrap"], bootstrap)
    queryClient.setQueryData(["conversations", "sidebar"], {
      pages: [{ items: [{ id: "account-a-task" }] }],
    })

    renderAuthProvider(queryClient)
    await expectAuthStatus("authenticated")

    act(() => {
      setAccessToken(null)
      // The ended login's data must be gone before any later task can run;
      // waiting for an asynchronous cancellation would leave it in the cache.
      expect(
        queryClient.getQueryData(["conversations", "sidebar"])
      ).toBeUndefined()
      expect(queryClient.getQueryData(["system", "bootstrap"])).toEqual(
        bootstrap
      )
    })

    await expectAuthStatus("anonymous")
    expect(screen.getByTestId("auth-user")).toBeEmptyDOMElement()
  })

  it("runs native cleanup for the ending login when the token is cleared while logout is pending", async () => {
    sessionState.token = "old-login-token"
    let finishLogout!: () => void
    const logoutResponse = new Promise<unknown>((resolve) => {
      finishLogout = () => resolve(null)
    })
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === "/auth/logout") return logoutResponse
      return user
    })

    renderAuthProvider()
    await expectAuthStatus("authenticated")

    fireEvent.click(screen.getByRole("button", { name: "sign out" }))
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/auth/logout",
        expect.objectContaining({ skipRefresh: true })
      )
    )
    const loggingOutBoundary = sessionState.loginSessionBoundary

    // The definitive clear ends the verified login that sign-out is completing.
    act(() => setAccessToken(null))
    expect(sessionState.loginSessionBoundary).toBe(loggingOutBoundary + 1)
    await expectAuthStatus("anonymous")

    await act(async () => {
      finishLogout()
      await logoutResponse
    })

    await waitFor(() => expect(clearDesktopSession).toHaveBeenCalledOnce())
    expect(sessionState.loginSessionBoundary).toBe(loggingOutBoundary + 1)
    expect(sessionState.token).toBeNull()
    await expectAuthStatus("anonymous")
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
    const runtimeKey = [
      "applications",
      "interactive-runtime-token",
      user.id,
      "application-1",
      "package-1",
      "conversation-1",
    ]
    queryClient.setQueryData(runtimeKey, {
      runtime_url:
        "/api/v1/interactive-app-runtime/previous-account/index.html",
    })
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["previous-account-mutation"],
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
    expect(queryClient.getQueryData(runtimeKey)).toBeUndefined()
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    expect(screen.getByTestId("auth-user")).toBeEmptyDOMElement()
    expect(sessionState.token).toBeNull()
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

  it("retries a failed restore only after the user asks, without advancing the login generation", async () => {
    vi.mocked(refreshSession).mockRejectedValueOnce(new Error("restore failed"))

    renderAuthProvider()

    await expectAuthStatus("error")
    expect(refreshSession).toHaveBeenCalledTimes(1)
    const failedBoundary = sessionState.loginSessionBoundary

    vi.mocked(refreshSession).mockResolvedValueOnce({
      access_token: "retried-restore-token",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
    })
    vi.mocked(apiRequest).mockResolvedValue(user)
    fireEvent.click(screen.getByRole("button", { name: "retry restore" }))

    await expectAuthStatus("authenticated")
    expect(refreshSession).toHaveBeenCalledTimes(2)
    expect(apiRequest).toHaveBeenCalledWith("/me", expect.any(Object))
    expect(sessionState.loginSessionBoundary).toBe(failedBoundary)
    expect(sessionState.token).toBe("retried-restore-token")
  })

  it("ignores a restore retry while the session is not in the error state", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue(user)

    renderAuthProvider()
    await expectAuthStatus("authenticated")

    fireEvent.click(screen.getByRole("button", { name: "retry restore" }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(refreshSession).not.toHaveBeenCalled()
    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated")
  })

  it("advances the login generation when a live session loses its token, but not on rotation", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue(user)
    const queryClient = createAuthQueryClient()
    queryClient.setQueryData(["conversations", "sidebar"], {
      pages: [{ items: [{ id: "account-a-task" }] }],
    })

    renderAuthProvider(queryClient)
    await expectAuthStatus("authenticated")
    const authenticatedBoundary = sessionState.loginSessionBoundary

    act(() => setAccessToken("rotated-access-token"))
    expect(sessionState.loginSessionBoundary).toBe(authenticatedBoundary)
    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated")
    expect(queryClient.getQueryData(["conversations", "sidebar"])).toBeDefined()

    act(() => setAccessToken(null))
    expect(sessionState.loginSessionBoundary).toBe(authenticatedBoundary + 1)
    await expectAuthStatus("anonymous")
    expect(
      queryClient.getQueryData(["conversations", "sidebar"])
    ).toBeUndefined()
    expect(screen.getByTestId("auth-user")).toBeEmptyDOMElement()
  })

  it("does not advance the login generation for a storage-only token sync", async () => {
    sessionState.token = "persisted-access-token"
    vi.mocked(apiRequest).mockResolvedValue(user)

    renderAuthProvider()
    await expectAuthStatus("authenticated")
    const authenticatedBoundary = sessionState.loginSessionBoundary

    act(() => {
      sessionState.token = null
      sessionState.listeners.forEach((listener) => listener(null, "storage"))
    })

    expect(sessionState.loginSessionBoundary).toBe(authenticatedBoundary)
    await expectAuthStatus("anonymous")
  })
})
