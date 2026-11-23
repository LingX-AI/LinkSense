import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { useEffect } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  bootstrapSchema,
  userSchema,
  type AccessSession,
  type User,
} from "@/api/contracts"
import {
  getAccessToken,
  getLoginSessionBoundary,
  setAccessToken,
} from "@/api/session"
import { AuthProvider } from "@/app/auth-context"
import { AuthContext, useAuth, type AuthContextValue } from "@/app/auth-state"
import { BootstrapContext } from "@/app/bootstrap-state"
import { ProtectedRoute, PublicAuthRoute } from "@/app/route-guards"
import { browserExtensionSettingsPath } from "@/features/browser-use/settings-path"
import i18n from "@/i18n"

const desktopHost = vi.hoisted(() => ({
  mac: false,
  clear: vi.fn(),
  navigation: null as ((path: string) => void) | null,
}))

vi.mock("@/adapters/desktop/desktop-adapter", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/adapters/desktop/desktop-adapter")
  >()),
  isDesktopHost: () => true,
  isMacDesktopHost: () => desktopHost.mac,
  clearDesktopSession: desktopHost.clear,
  subscribeDesktopNavigation: (listener: (path: string) => void) => {
    desktopHost.navigation = listener
    return () => undefined
  },
}))

vi.mock("@/adapters/desktop/desktop-device-adapter", () => ({
  resumeDesktopDeviceForAuthRestore: vi.fn().mockResolvedValue(null),
}))

const applicationPath =
  "/applications/20000000-0000-4000-8000-000000000001/run/30000000-0000-4000-8000-000000000001"
const user = userSchema.parse({
  id: "user-1",
  name: "First user",
  email: "first@example.test",
  role: "user",
  status: "active",
  registration_source: "organization_invitation",
})
const bootstrap = bootstrapSchema.parse({ initialized: true })

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="current-path">{`${location.pathname}${location.hash}`}</output>
}

function renderSession(initialStatus: AuthContextValue["status"], initialPath = applicationPath) {
  const tree = (status: AuthContextValue["status"], userId = user.id) => (
    <BootstrapContext.Provider
      value={{ bootstrap, isLoading: false, error: null, refetch: vi.fn() }}
    >
      <AuthContext.Provider
        value={{
          status,
          user: status === "authenticated" ? { ...user, id: userId } : null,
          acceptSession: vi.fn(),
          refreshUser: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={[initialPath]}>
          <LocationProbe />
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path={applicationPath} element={<p>Interactive app</p>} />
              <Route path="/settings/general" element={<p>General settings</p>} />
              <Route path="/conversations/new" element={<p>New task</p>} />
            </Route>
            <Route element={<PublicAuthRoute />}>
              <Route path="/login" element={<p>Sign in</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </BootstrapContext.Provider>
  )
  const view = render(tree(initialStatus))
  return (status: AuthContextValue["status"], userId = user.id) =>
    view.rerender(tree(status, userId))
}

describe("account-scoped login destinations", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  afterEach(cleanup)

  it.each([
    { userId: user.id, destination: applicationPath },
    { userId: "user-2", destination: "/conversations/new" },
  ])(
    "restores a task only for its previous account when signing in as $userId",
    async ({ userId, destination }) => {
      const updateSession = renderSession("loading")
      updateSession("authenticated")
      expect(await screen.findByText("Interactive app")).toBeVisible()

      updateSession("anonymous")
      expect(await screen.findByText("Sign in")).toBeVisible()
      updateSession("authenticated", userId)

      await waitFor(() =>
        expect(screen.getByTestId("current-path").textContent).toBe(destination)
      )
    }
  )

  it("preserves a directly opened application link when no previous account viewed it", async () => {
    const updateSession = renderSession("anonymous")
    expect(await screen.findByText("Sign in")).toBeVisible()

    updateSession("authenticated", "user-2")

    expect(await screen.findByText("Interactive app")).toBeVisible()
    expect(screen.getByTestId("current-path").textContent).toBe(applicationPath)
  })

  it.each(["anonymous", "authenticated"] as const)(
    "opens a browser extension setup link at its settings section from a %s browser",
    async (initialStatus) => {
      const updateSession = renderSession(initialStatus, browserExtensionSettingsPath)
      if (initialStatus === "anonymous") {
        expect(await screen.findByText("Sign in")).toBeVisible()
        updateSession("authenticated")
      }
      expect(await screen.findByText("General settings")).toBeVisible()
      expect(screen.getByTestId("current-path")).toHaveTextContent(browserExtensionSettingsPath)
    }
  )
})

const macUserA = userSchema.parse({
  id: "mac-user-a",
  name: "Mac user A",
  email: "mac-a@example.test",
  role: "user",
  status: "active",
  registration_source: "self_registration",
})
const macUserB = userSchema.parse({
  ...macUserA,
  id: "mac-user-b",
  email: "mac-b@example.test",
})
const macNextSession: AccessSession = {
  access_token: "account-b-token",
  access_token_expires_at: "2099-01-01T00:00:00.000Z",
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function macJson(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: {
      "content-type": "application/json",
      "x-linksense-desktop-protocol": "1",
    },
  })
}

const macAuth: { current: AuthContextValue | null } = { current: null }

function MacAuthProbe({
  nextSession,
  onSignOutError,
}: {
  nextSession: AccessSession
  onSignOutError?: (error: unknown) => void
}) {
  const auth = useAuth()
  // Tests call the same provider callbacks a later Settings mutation would
  // have captured, even after this probe's render has gone stale.
  useEffect(() => {
    macAuth.current = auth
  })
  return (
    <>
      <output data-testid="mac-auth-status">{auth.status}</output>
      <output data-testid="mac-auth-user">{auth.user?.id ?? ""}</output>
      <button
        type="button"
        onClick={() =>
          void auth.signOut().catch((error) => onSignOutError?.(error))
        }
      >
        sign out mac session
      </button>
      <button type="button" onClick={() => void auth.acceptSession(nextSession)}>
        accept next mac session
      </button>
    </>
  )
}

function requestedPath(input: RequestInfo | URL) {
  return new URL(String(input), window.location.origin).pathname
}

function installMacFetch(
  handler: (path: string) => Promise<Response> | Response
) {
  const paths: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = requestedPath(input)
      paths.push(path)
      return Promise.resolve(handler(path))
    })
  )
  return paths
}

function createMacQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderMacAuth({
  queryClient = createMacQueryClient(),
  onSignOutError,
}: {
  queryClient?: QueryClient
  onSignOutError?: (error: unknown) => void
} = {}) {
  render(
    <QueryClientProvider client={queryClient}>
      <BootstrapContext.Provider
        value={{ bootstrap, isLoading: false, error: null, refetch: vi.fn() }}
      >
        <AuthProvider>
          <MemoryRouter initialEntries={["/conversations/new"]}>
            <Routes>
              <Route element={<ProtectedRoute />}>
                <Route
                  path="/conversations/new"
                  element={<p>New task composer</p>}
                />
                <Route
                  path="/settings/general"
                  element={<p>General settings</p>}
                />
              </Route>
              <Route element={<PublicAuthRoute />}>
                <Route path="/login" element={<p>Sign in form</p>} />
              </Route>
            </Routes>
            <MacAuthProbe
              nextSession={macNextSession}
              onSignOutError={onSignOutError}
            />
          </MemoryRouter>
        </AuthProvider>
      </BootstrapContext.Provider>
    </QueryClientProvider>
  )
  return queryClient
}

function expectMacSignOutHoldClosed() {
  expect(screen.getByTestId("mac-auth-status")).toHaveTextContent("loading")
  expect(screen.getByTestId("mac-auth-user")).toBeEmptyDOMElement()
  expect(screen.queryByText("New task composer")).not.toBeInTheDocument()
  expect(screen.queryByText("Sign in form")).not.toBeInTheDocument()
}

describe("Mac sign-out route closure", () => {
  beforeEach(() => {
    desktopHost.mac = false
    desktopHost.navigation = null
    desktopHost.clear.mockReset()
    macAuth.current = null
    setAccessToken(null)
  })
  afterEach(cleanup)

  it("keeps the Mac protected route and login closed until logout and native cleanup settle", async () => {
    desktopHost.mac = true
    setAccessToken("account-a-token", Date.now() + 60_000)
    const logout = deferred<Response>()
    const nativeClear = deferred<void>()
    desktopHost.clear.mockReturnValue(nativeClear.promise)
    let activeUser: User = macUserA
    installMacFetch((path) => {
      if (path === "/api/v1/me") return macJson(activeUser)
      if (path === "/api/v1/auth/logout") return logout.promise
      throw new Error(`unexpected request ${path}`)
    })
    const queryClient = createMacQueryClient()
    queryClient.setQueryData(["system", "bootstrap"], bootstrap)
    queryClient.setQueryData(["conversation", "account-a"], {
      title: "account A detail",
    })

    renderMacAuth({ queryClient })

    expect(await screen.findByText("New task composer")).toBeVisible()
    expect(desktopHost.navigation).toBeTypeOf("function")
    const boundaryBefore = getLoginSessionBoundary()

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "sign out mac session" })
      )
      // A definitive null can arrive in the same turn as the sign-out intent.
      setAccessToken(null)
    })

    expect(screen.queryByText("New task composer")).not.toBeInTheDocument()
    expect(screen.queryByText("Sign in form")).not.toBeInTheDocument()
    expect(screen.getByTestId("mac-auth-status")).toHaveTextContent("loading")
    expect(screen.getByTestId("mac-auth-user")).toBeEmptyDOMElement()
    expect(
      queryClient.getQueryData(["conversation", "account-a"])
    ).toBeUndefined()
    expect(queryClient.getQueryData(["system", "bootstrap"])).toEqual(bootstrap)
    expect(getLoginSessionBoundary()).toBe(boundaryBefore + 1)
    expect(desktopHost.clear).not.toHaveBeenCalled()

    // A shell menu action delivered while cleanup is pending cannot reopen it.
    act(() => desktopHost.navigation?.("/settings/general"))
    expect(screen.queryByText("General settings")).not.toBeInTheDocument()
    expect(screen.queryByText("Sign in form")).not.toBeInTheDocument()
    expect(screen.getByTestId("mac-auth-status")).toHaveTextContent("loading")

    // An in-flight old login acceptance cannot reopen the routes mid-cleanup.
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "accept next mac session" })
      )
    })
    expect(screen.getByTestId("mac-auth-status")).toHaveTextContent("loading")
    expect(screen.getByTestId("mac-auth-user")).toBeEmptyDOMElement()
    expect(getAccessToken()).toBeNull()

    // HTTP logout settles; native ClearSession is still pending.
    await act(async () => {
      logout.resolve(macJson(null))
      await logout.promise
    })
    await waitFor(() => expect(desktopHost.clear).toHaveBeenCalledOnce())
    expect(screen.getByTestId("mac-auth-status")).toHaveTextContent("loading")
    expect(screen.queryByText("Sign in form")).not.toBeInTheDocument()

    // Native cleanup settles; only now may the anonymous login appear.
    await act(async () => {
      nativeClear.resolve()
      await nativeClear.promise
    })
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-status")).toHaveTextContent(
        "anonymous"
      )
    )
    expect(await screen.findByText("Sign in form")).toBeVisible()
    expect(desktopHost.clear).toHaveBeenCalledOnce()

    // Sign-in after the exit settles restores the protected route.
    activeUser = macUserB
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "accept next mac session" })
      )
    })
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-user")).toHaveTextContent(
        "mac-user-b"
      )
    )
    expect(await screen.findByText("New task composer")).toBeVisible()
    expect(getAccessToken()).toBe("account-b-token")
    expect(desktopHost.clear).toHaveBeenCalledOnce()
  })

  it("refuses a captured profile refresh during the HTTP logout and native clear holds", async () => {
    desktopHost.mac = true
    setAccessToken("account-a-token", Date.now() + 60_000)
    const logout = deferred<Response>()
    const nativeClear = deferred<void>()
    desktopHost.clear.mockReturnValue(nativeClear.promise)
    let activeUser: User = macUserA
    const paths = installMacFetch((path) => {
      if (path === "/api/v1/me") return macJson(activeUser)
      if (path === "/api/v1/auth/logout") return logout.promise
      throw new Error(`unexpected request ${path}`)
    })
    const queryClient = createMacQueryClient()
    queryClient.setQueryData(["system", "bootstrap"], bootstrap)

    renderMacAuth({ queryClient })
    expect(await screen.findByText("New task composer")).toBeVisible()
    const refreshUser = macAuth.current!.refreshUser
    const profileRequestsBeforeSignOut = paths.filter(
      (path) => path === "/api/v1/me"
    ).length
    expect(profileRequestsBeforeSignOut).toBe(1)

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "sign out mac session" })
      )
    })
    expectMacSignOutHoldClosed()

    // A Settings mutation completing during the HTTP logout hold must not
    // start /me under the new boundary with the outgoing bearer.
    await act(async () => {
      await refreshUser()
    })
    expect(paths.filter((path) => path === "/api/v1/me")).toHaveLength(
      profileRequestsBeforeSignOut
    )
    expect(paths).not.toContain("/api/v1/auth/refresh")
    expectMacSignOutHoldClosed()

    // HTTP logout settles; native ClearSession is still held.
    await act(async () => {
      logout.resolve(macJson(null))
      await logout.promise
    })
    await waitFor(() => expect(desktopHost.clear).toHaveBeenCalledOnce())

    // The same captured callback is refused during native cleanup.
    await act(async () => {
      await refreshUser()
    })
    expect(paths.filter((path) => path === "/api/v1/me")).toHaveLength(
      profileRequestsBeforeSignOut
    )
    expect(paths).not.toContain("/api/v1/auth/refresh")
    expectMacSignOutHoldClosed()

    await act(async () => {
      nativeClear.resolve()
      await nativeClear.promise
    })
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-status")).toHaveTextContent(
        "anonymous"
      )
    )
    expect(await screen.findByText("Sign in form")).toBeVisible()
    expect(paths.filter((path) => path === "/api/v1/me")).toHaveLength(
      profileRequestsBeforeSignOut
    )

    // A later sign-in still refreshes the profile normally.
    activeUser = macUserB
    await act(async () => {
      await macAuth.current!.acceptSession(macNextSession)
    })
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-user")).toHaveTextContent(
        "mac-user-b"
      )
    )
    expect(await screen.findByText("New task composer")).toBeVisible()
    expect(paths.filter((path) => path === "/api/v1/me")).toHaveLength(
      profileRequestsBeforeSignOut + 1
    )
    expect(paths).not.toContain("/api/v1/auth/refresh")
    expect(getAccessToken()).toBe("account-b-token")
  })

  it("lets only the first Mac sign-out own logout and native cleanup", async () => {
    desktopHost.mac = true
    setAccessToken("account-a-token", Date.now() + 60_000)
    const logout = deferred<Response>()
    const nativeClear = deferred<void>()
    desktopHost.clear.mockReturnValue(nativeClear.promise)
    let activeUser: User = macUserA
    const paths = installMacFetch((path) => {
      if (path === "/api/v1/me") return macJson(activeUser)
      if (path === "/api/v1/auth/logout") return logout.promise
      throw new Error(`unexpected request ${path}`)
    })
    const queryClient = createMacQueryClient()
    queryClient.setQueryData(["system", "bootstrap"], bootstrap)

    renderMacAuth({ queryClient })
    expect(await screen.findByText("New task composer")).toBeVisible()
    const boundaryBefore = getLoginSessionBoundary()
    const logoutRequests = () =>
      paths.filter((path) => path === "/api/v1/auth/logout").length

    // A double invocation in the same turn owns one boundary and one logout.
    await act(async () => {
      const { signOut } = macAuth.current!
      void signOut().catch(() => undefined)
      void signOut().catch(() => undefined)
      await Promise.resolve()
    })
    expect(logoutRequests()).toBe(1)
    expect(getLoginSessionBoundary()).toBe(boundaryBefore + 1)
    expect(desktopHost.clear).not.toHaveBeenCalled()
    expectMacSignOutHoldClosed()

    // HTTP logout settles; native ClearSession is still held.
    await act(async () => {
      logout.resolve(macJson(null))
      await logout.promise
    })
    await waitFor(() => expect(desktopHost.clear).toHaveBeenCalledOnce())

    // Another invocation during native cleanup is refused too.
    await act(async () => {
      void macAuth.current!.signOut().catch(() => undefined)
      await Promise.resolve()
    })
    expect(logoutRequests()).toBe(1)
    expect(desktopHost.clear).toHaveBeenCalledOnce()
    expect(getLoginSessionBoundary()).toBe(boundaryBefore + 1)
    expectMacSignOutHoldClosed()

    await act(async () => {
      nativeClear.resolve()
      await nativeClear.promise
    })
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-status")).toHaveTextContent(
        "anonymous"
      )
    )
    expect(await screen.findByText("Sign in form")).toBeVisible()
    expect(logoutRequests()).toBe(1)
    expect(desktopHost.clear).toHaveBeenCalledOnce()
    expect(getLoginSessionBoundary()).toBe(boundaryBefore + 1)

    // A clean sign-in afterwards still refreshes the profile.
    activeUser = macUserB
    await act(async () => {
      await macAuth.current!.acceptSession(macNextSession)
    })
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-user")).toHaveTextContent(
        "mac-user-b"
      )
    )
    expect(await screen.findByText("New task composer")).toBeVisible()
    expect(getAccessToken()).toBe("account-b-token")
    expect(logoutRequests()).toBe(1)
    expect(desktopHost.clear).toHaveBeenCalledOnce()
  })

  it("releases the Mac sign-out hold and retries when logout or native cleanup rejects", async () => {
    desktopHost.mac = true
    setAccessToken("account-a-token", Date.now() + 60_000)
    const clearError = new Error("native clear unavailable")
    const heldLogout = deferred<Response>()
    const heldClear = deferred<void>()
    let logoutAttempt = 0
    let activeUser: User = macUserA
    const paths = installMacFetch((path) => {
      if (path === "/api/v1/me") return macJson(activeUser)
      if (path === "/api/v1/auth/logout") {
        logoutAttempt += 1
        if (logoutAttempt === 1) return Promise.reject(new Error("offline"))
        if (logoutAttempt === 2) return heldLogout.promise
        return macJson(null)
      }
      throw new Error(`unexpected request ${path}`)
    })
    desktopHost.clear
      .mockReturnValueOnce(heldClear.promise)
      .mockRejectedValueOnce(clearError)
      .mockResolvedValue(undefined)
    const signOutErrors: unknown[] = []
    const logoutRequests = () =>
      paths.filter((path) => path === "/api/v1/auth/logout").length

    renderMacAuth({ onSignOutError: (error) => signOutErrors.push(error) })
    expect(await screen.findByText("New task composer")).toBeVisible()

    // Attempt 1: HTTP logout rejects, but native cleanup still owns the hold.
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "sign out mac session" })
      )
    })
    await waitFor(() => expect(desktopHost.clear).toHaveBeenCalledOnce())
    expectMacSignOutHoldClosed()
    await act(async () => {
      heldClear.resolve()
      await heldClear.promise
    })
    await waitFor(() => expect(signOutErrors).toHaveLength(1))
    expect(signOutErrors[0]).toMatchObject({
      status: 0,
      errorCode: "NETWORK_UNAVAILABLE",
    })
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-status")).toHaveTextContent(
        "anonymous"
      )
    )
    expect(await screen.findByText("Sign in form")).toBeVisible()
    expect(getAccessToken()).toBeNull()
    expect(desktopHost.clear).toHaveBeenCalledOnce()

    // Attempt 2: logout settles, but native cleanup rejects.
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "sign out mac session" })
      )
    })
    await waitFor(() => expect(logoutRequests()).toBe(2))
    expectMacSignOutHoldClosed()
    await act(async () => {
      heldLogout.resolve(macJson(null))
      await heldLogout.promise
    })
    await waitFor(() => expect(signOutErrors).toHaveLength(2))
    expect(signOutErrors[1]).toBe(clearError)
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-status")).toHaveTextContent(
        "anonymous"
      )
    )
    expect(await screen.findByText("Sign in form")).toBeVisible()
    expect(getAccessToken()).toBeNull()
    expect(desktopHost.clear).toHaveBeenCalledTimes(2)

    // Attempt 3: the released hold allows a clean retry.
    await act(async () => {
      await macAuth.current!.signOut()
    })
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-status")).toHaveTextContent(
        "anonymous"
      )
    )
    expect(signOutErrors).toHaveLength(2)
    expect(logoutRequests()).toBe(3)
    expect(desktopHost.clear).toHaveBeenCalledTimes(3)

    // Sign-in and profile refresh still work after the rejected attempts.
    activeUser = macUserB
    await act(async () => {
      await macAuth.current!.acceptSession(macNextSession)
    })
    await waitFor(() =>
      expect(screen.getByTestId("mac-auth-user")).toHaveTextContent(
        "mac-user-b"
      )
    )
    expect(await screen.findByText("New task composer")).toBeVisible()
    expect(getAccessToken()).toBe("account-b-token")
  })
})
