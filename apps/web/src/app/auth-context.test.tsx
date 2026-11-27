import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { supportedLocales } from "@linksense/shared"
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
  listeners: new Set<
    (token: string | null, reason: "session" | "storage") => void
  >(),
  loginSessionBoundary: 0,
  revision: 0,
}))

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn(),
  isDefinitiveAuthenticationError: vi.fn(),
  isRetryableApiError: vi.fn(),
  refreshSession: vi.fn(),
}))

vi.mock("@/api/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/session")>()),
  beginLoginSession: vi.fn(() => {
    sessionState.loginSessionBoundary += 1
    return sessionState.loginSessionBoundary
  }),
  captureAccessSessionGuard: () => {
    const { revision } = sessionState
    return () => sessionState.revision === revision
  },
  getAccessToken: vi.fn(() => sessionState.token),
  getLoginSessionBoundary: vi.fn(() => sessionState.loginSessionBoundary),
  isLoginSessionCurrent: vi.fn(
    (boundary: number) => boundary === sessionState.loginSessionBoundary
  ),
  setAccessToken: vi.fn((token: string | null) => {
    if (!token || token !== sessionState.token) sessionState.revision += 1
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

const user: User = {
  id: "00000000-0000-4000-8000-000000000001",
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

const anotherUser: User = {
  ...user,
  id: "00000000-0000-4000-8000-000000000002",
  email: "two@example.com",
  language: "fr-FR",
}

function accessTokenFor(account: User, version = "first") {
  const claims = btoa(JSON.stringify({ sub: account.id, role: account.role }))
    .replace(/=+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
  return `header.${claims}.${version}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const bootstrap = bootstrapSchema.parse({
  initialized: true,
  system_name: "LinkSense",
  default_language: "zh-CN",
})

function AuthProbe({
  nextSession,
  session,
  onSignOutError,
}: {
  nextSession?: AccessSession
  session?: AccessSession
  onSignOutError?: (error: unknown) => void
}) {
  const { status, user: currentUser, acceptSession, signOut } = useAuth()
  return (
    <>
      <output data-testid="auth-status">{status}</output>
      <output data-testid="auth-user">{currentUser?.email ?? ""}</output>
      <output data-testid="auth-role">{currentUser?.role ?? ""}</output>
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
      {session && (
        <button type="button" onClick={() => void acceptSession(session)}>
          sign in
        </button>
      )}
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
    sessionState.revision = 0
    sessionState.listeners.clear()
    sessionState.loginSessionBoundary = 0
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

  it("clears the local session before completing sign-out when the API is unreachable", async () => {
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
    const requestSignal = vi.mocked(apiRequest).mock.lastCall?.[1].signal
    expect(requestSignal?.aborted).toBe(false)
    controller.abort()
    expect(requestSignal?.aborted).toBe(true)
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

  it("keeps a newer account when the previous account's sign-out finishes", async () => {
    sessionState.token = accessTokenFor(user)
    const logout = deferred<null>()
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(user)
      .mockReturnValueOnce(logout.promise)
      .mockResolvedValueOnce(anotherUser)

    renderAuthProvider()
    await expectAuthStatus("authenticated")
    fireEvent.click(screen.getByRole("button", { name: "sign out" }))
    expect(sessionState.token).toBeNull()

    const replacement = accessTokenFor(anotherUser)
    act(() => setAccessToken(replacement))
    await waitFor(() =>
      expect(screen.getByTestId("auth-user")).toHaveTextContent(anotherUser.email)
    )
    await act(async () => logout.resolve(null))

    expect(sessionState.token).toBe(replacement)
    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated")
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
    vi.mocked(refreshSession).mockImplementationOnce(async () => {
      setAccessToken(null)
      throw expiredSessionError
    })

    renderAuthProvider()

    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent("anonymous")
    )
    expect(setAccessToken).toHaveBeenCalledWith(null)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it.each(supportedLocales)(
    "loads the signed-in user and their %s language when another tab signs in",
    async (language) => {
      const expiredSessionError = new Error("refresh session expired")
      vi.mocked(refreshSession).mockImplementationOnce(async () => {
        setAccessToken(null)
        throw expiredSessionError
      })
      vi.mocked(apiRequest).mockResolvedValue({ ...user, language })

      renderAuthProvider()
      await expectAuthStatus("anonymous")

      act(() => setAccessToken(accessTokenFor(user)))

      await expectAuthStatus("authenticated")
      expect(screen.getByTestId("auth-user")).toHaveTextContent(user.email)
      expect(setAppLanguage).toHaveBeenCalledExactlyOnceWith(language)
      expect(refreshSession).toHaveBeenCalledTimes(1)
      expect(apiRequest).toHaveBeenCalledOnce()
    }
  )

  it.each([
    { change: "account change", nextUser: anotherUser, knownIdentity: true },
    {
      change: "role change",
      nextUser: { ...user, role: "user" } satisfies User,
      knownIdentity: true,
    },
    {
      change: "unknown identity",
      nextUser: anotherUser,
      knownIdentity: false,
    },
  ])(
    "clears the previous account's data and discards its pending profile on $change",
    async ({ nextUser, knownIdentity }) => {
      sessionState.token = accessTokenFor(user)
      vi.mocked(apiRequest).mockResolvedValueOnce(user)
      const queryClient = createAuthQueryClient()
      queryClient.setQueryData(["system", "bootstrap"], bootstrap)
      queryClient.setQueryData(["conversations"], ["previous task"])
      queryClient.getMutationCache().build(queryClient, {
        mutationKey: ["previous account mutation"],
      })
      const previousQuery = deferred<string[]>()
      let previousQuerySignal: AbortSignal | undefined
      const pendingQuery = queryClient
        .fetchQuery({
          queryKey: ["me", "personalization"],
          queryFn: ({ signal }) => {
            previousQuerySignal = signal
            return previousQuery.promise
          },
        })
        .catch(() => undefined)
      renderAuthProvider(
        queryClient,
        <>
          <AuthProbe />
          <AuthRefreshProbe onRender={vi.fn()} />
        </>
      )
      await expectAuthStatus("authenticated")
      vi.mocked(setAppLanguage).mockClear()
      const previousProfile = deferred<User>()
      const nextProfile = deferred<User>()
      vi.mocked(apiRequest)
        .mockReturnValueOnce(previousProfile.promise)
        .mockReturnValueOnce(nextProfile.promise)
      fireEvent.click(screen.getByRole("button", { name: "refresh user" }))
      const previousProfileSignal =
        vi.mocked(apiRequest).mock.lastCall?.[1].signal
      expect(previousProfileSignal?.aborted).toBe(false)
      expect(previousQuerySignal?.aborted).toBe(false)

      act(() =>
        setAccessToken(
          knownIdentity ? accessTokenFor(nextUser) : "legacy-opaque-token"
        )
      )

      expect(screen.getByTestId("auth-status")).toHaveTextContent("loading")
      expect(screen.getByTestId("auth-user")).toBeEmptyDOMElement()
      expect(previousProfileSignal?.aborted).toBe(true)
      expect(previousQuerySignal?.aborted).toBe(true)
      expect(queryClient.getQueryData(["conversations"])).toBeUndefined()
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
      expect(queryClient.getQueryData(["system", "bootstrap"])).toEqual(bootstrap)

      await act(async () => nextProfile.resolve(nextUser))
      await expectAuthStatus("authenticated")
      await act(async () => {
        previousProfile.resolve({ ...user, language: "ja-JP" })
        previousQuery.resolve(["late previous account data"])
        await pendingQuery
      })

      expect(screen.getByTestId("auth-user")).toHaveTextContent(nextUser.email)
      expect(screen.getByTestId("auth-role")).toHaveTextContent(nextUser.role)
      expect(setAppLanguage).toHaveBeenCalledExactlyOnceWith(nextUser.language)
      expect(queryClient.getQueryData(["me", "personalization"])).toBeUndefined()
    }
  )

  it("keeps the verified user and cache when same-account rotation temporarily fails", async () => {
    vi.useFakeTimers()
    sessionState.token = accessTokenFor(user)
    vi.mocked(apiRequest).mockResolvedValueOnce(user)
    const queryClient = createAuthQueryClient()
    queryClient.setQueryData(["conversations"], ["current task"])
    renderAuthProvider(queryClient)
    await act(async () => {})
    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated")
    vi.mocked(apiRequest).mockRejectedValue(new Error("retryable service error"))
    vi.mocked(isRetryableApiError).mockReturnValue(true)
    const rotatedToken = accessTokenFor(user, "rotated")

    await act(async () => {
      setAccessToken(rotatedToken)
      setAccessToken(rotatedToken)
    })
    expect(apiRequest).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(10_000))

    expect(apiRequest).toHaveBeenCalledTimes(4)
    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated")
    expect(screen.getByTestId("auth-user")).toHaveTextContent(user.email)
    expect(queryClient.getQueryData(["conversations"])).toEqual(["current task"])
    expect(sessionState.token).toBe(rotatedToken)
  })

  it("clears a verified session if its rotated token is definitively rejected", async () => {
    sessionState.token = accessTokenFor(user)
    vi.mocked(apiRequest).mockResolvedValueOnce(user)
    const queryClient = createAuthQueryClient()
    queryClient.setQueryData(["conversations"], ["current task"])
    renderAuthProvider(queryClient)
    await expectAuthStatus("authenticated")
    const revoked = new Error("session revoked")
    vi.mocked(apiRequest).mockRejectedValueOnce(revoked)
    vi.mocked(isDefinitiveAuthenticationError).mockImplementation(
      (error) => error === revoked
    )

    act(() => setAccessToken(accessTokenFor(user, "rejected")))

    await expectAuthStatus("anonymous")
    expect(screen.getByTestId("auth-user")).toBeEmptyDOMElement()
    expect(queryClient.getQueryData(["conversations"])).toBeUndefined()
    expect(sessionState.token).toBeNull()
  })

  it("uses the new token when a startup profile refresh rotates it", async () => {
    const originalToken = accessTokenFor(user)
    const rotatedToken = accessTokenFor(anotherUser, "rotated")
    sessionState.token = originalToken
    const previousProfile = deferred<User>()
    vi.mocked(apiRequest)
      .mockReturnValueOnce(previousProfile.promise)
      .mockResolvedValueOnce(anotherUser)

    renderAuthProvider()
    const previousSignal = vi.mocked(apiRequest).mock.lastCall?.[1].signal
    act(() => setAccessToken(rotatedToken))
    await expectAuthStatus("authenticated")
    await act(async () => previousProfile.resolve(user))

    expect(previousSignal?.aborted).toBe(true)
    expect(screen.getByTestId("auth-user")).toHaveTextContent(anotherUser.email)
    expect(setAppLanguage).toHaveBeenCalledExactlyOnceWith(anotherUser.language)
  })

  it("verifies the startup refresh without publishing its token again", async () => {
    const session: AccessSession = {
      access_token: accessTokenFor(user),
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
    }
    vi.mocked(refreshSession).mockImplementationOnce(async () => {
      setAccessToken(session.access_token, session.access_token_expires_at)
      return session
    })
    vi.mocked(apiRequest).mockResolvedValue(user)
    renderAuthProvider()

    await expectAuthStatus("authenticated")
    expect(setAccessToken).toHaveBeenCalledOnce()
    expect(apiRequest).toHaveBeenCalledOnce()
  })

  it("persists the returned expiry and verifies the session once on local sign-in", async () => {
    const session: AccessSession = {
      access_token: accessTokenFor(user),
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
    }
    vi.mocked(refreshSession).mockImplementationOnce(async () => {
      setAccessToken(null)
      throw new Error("no refresh session")
    })
    vi.mocked(apiRequest).mockResolvedValue(user)

    renderAuthProvider(createAuthQueryClient(), <AuthProbe session={session} />)
    await expectAuthStatus("anonymous")
    fireEvent.click(screen.getByRole("button", { name: "sign in" }))

    await expectAuthStatus("authenticated")
    expect(setAccessToken).toHaveBeenLastCalledWith(
      session.access_token,
      session.access_token_expires_at
    )
    expect(apiRequest).toHaveBeenCalledOnce()
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
