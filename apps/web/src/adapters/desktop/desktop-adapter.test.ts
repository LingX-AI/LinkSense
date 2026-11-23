import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode, createElement } from "react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  authSessionSchema,
  bootstrapSchema,
  userSchema,
  type BootstrapStatus,
} from "@/api/contracts"
import { setAccessToken } from "@/api/session"
import { AuthProvider } from "@/app/auth-context"
import { AuthContext, type AuthContextValue } from "@/app/auth-state"
import { BootstrapContext } from "@/app/bootstrap-state"
import {
  BootstrapGate,
  ProtectedRoute,
  PublicAuthRoute,
} from "@/app/route-guards"
import i18n from "@/i18n"

const native = vi.hoisted(() => ({
  isDesktop: false,
  info: vi.fn(),
  request: vi.fn(),
  openExternal: vi.fn(),
  onNavigate: vi.fn(),
  notificationsSupported: vi.fn(),
  showCompletionNotification: Object.assign(vi.fn(), { with: vi.fn() }),
  showTestNotification: Object.assign(vi.fn(), { with: vi.fn() }),
  onNotificationClick: vi.fn(),
  workspaceUsage: vi.fn(),
  cleanupWorkspaces: vi.fn(),
  workspaceNotice: vi.fn(),
  beginArtifactDownload: vi.fn(),
  beginArtifactPreview: vi.fn(),
  armArtifactDownload: vi.fn(),
  cancelArtifactDownload: vi.fn(),
  revealArtifactDownload: vi.fn(),
  onArtifactSaved: vi.fn(),
  resumeDevice: vi.fn(),
  getUpdateState: vi.fn(),
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  setUpdateChannel: vi.fn(),
  restartAfterUpdate: vi.fn(),
  openUpdateInstaller: vi.fn(),
  onUpdateChanged: vi.fn(),
}))
vi.mock("mygo-runtime", () => ({ isMyGo: () => native.isDesktop }))
vi.mock("@mygo-plugins/fetch", () => ({ fetch: native.request }))
vi.mock("./mygo", () => ({
  Desktop: {
    info: native.info,
    openExternal: native.openExternal,
    notificationsSupported: native.notificationsSupported,
    showCompletionNotification: native.showCompletionNotification,
    showTestNotification: native.showTestNotification,
    workspaceUsage: native.workspaceUsage,
    cleanupWorkspaces: native.cleanupWorkspaces,
    workspaceNotice: native.workspaceNotice,
    beginArtifactDownload: native.beginArtifactDownload,
    beginArtifactPreview: native.beginArtifactPreview,
    armArtifactDownload: native.armArtifactDownload,
    cancelArtifactDownload: native.cancelArtifactDownload,
    revealArtifactDownload: native.revealArtifactDownload,
    resumeDevice: native.resumeDevice,
    getUpdateState: native.getUpdateState,
    checkForUpdate: native.checkForUpdate,
    installUpdate: native.installUpdate,
    setUpdateChannel: native.setUpdateChannel,
    restartAfterUpdate: native.restartAfterUpdate,
    openUpdateInstaller: native.openUpdateInstaller,
  },
  events: {
    desktopNavigate: { on: native.onNavigate },
    desktopNotificationClick: { on: native.onNotificationClick },
    desktopArtifactSaved: { on: native.onArtifactSaved },
    desktopUpdateChanged: { on: native.onUpdateChanged },
  },
}))

import {
  armDesktopArtifactDownload,
  beginDesktopArtifactDownload,
  beginDesktopArtifactPreview,
  cancelDesktopArtifactDownload,
  checkDesktopUpdate,
  cleanupDesktopWorkspaces,
  desktopNotificationRouteForUser,
  getDesktopPlatform,
  getDesktopServerUrl,
  getDesktopUpdateState,
  hostFetch,
  initializeDesktopHost,
  installDesktopNavigationBridge,
  installDesktopUpdate,
  openDesktopExternal,
  openDesktopUpdateInstaller,
  readDesktopWorkspaceNotice,
  readDesktopWorkspaceUsage,
  restartDesktopAfterUpdate,
  revealDesktopArtifactDownload,
  setDesktopUpdateChannel,
  showDesktopCompletionNotification,
  showDesktopTestNotification,
  subscribeDesktopArtifactSaved,
  subscribeDesktopConversationNavigation,
  subscribeDesktopNavigation,
  subscribeDesktopNotificationClick,
  subscribeDesktopUpdateChanged,
  supportsNativeDesktopNotifications,
  updateDesktopConversationContext,
} from "./desktop-adapter"

let emitNotificationClick: (value: unknown) => void = () => undefined
native.onNotificationClick.mockImplementation(
  (callback: (value: unknown) => void) => {
    emitNotificationClick = callback
    return vi.fn()
  }
)

let emitDesktopNavigation: (value: unknown) => void = () => undefined
native.onNavigate.mockImplementation((callback: (path: unknown) => void) => {
  emitDesktopNavigation = callback
  return vi.fn()
})

const maintenanceBootstrap = bootstrapSchema.parse({
  initialized: true,
  system_name: "LinkSense",
  maintenance: {
    enabled: true,
    active: true,
    reason: "Fixture maintenance",
    start_at: null,
    end_at: null,
  },
})
const activeBootstrap = bootstrapSchema.parse({
  initialized: true,
  system_name: "LinkSense",
})

type TestSession = {
  status: AuthContextValue["status"]
  userId?: string
  role?: "admin" | "user"
}

function testSessionUser(session: TestSession) {
  // AuthProvider keeps the last user during a transient "loading" restore and
  // clears it only for a confirmed anonymous reset.
  if (!session.userId) return null
  return userSchema.parse({
    id: session.userId,
    name: "Test user",
    email: "user@example.test",
    role: session.role ?? "user",
    status: "active",
    registration_source: "organization_invitation",
  })
}

function LocationProbe() {
  const location = useLocation()
  return createElement(
    "output",
    { "data-testid": "current-path" },
    location.pathname
  )
}

const JSDOM_NAVIGATION_ERROR = "Not implemented: navigation to another Document"

function watchJsdomNavigationErrors(): string[] {
  const errors: string[] = []
  const runtime = window as Window & {
    jsdom?: {
      virtualConsole: {
        on: (event: "jsdomError", listener: (error: Error) => void) => void
      }
    }
  }
  runtime.jsdom?.virtualConsole.on("jsdomError", (error) => {
    if (error.message === JSDOM_NAVIGATION_ERROR) errors.push(error.message)
  })
  return errors
}

// The real guards, auth/bootstrap contexts, and desktop adapter, with a
// two-session harness. It reproduces maintenance unmounting ProtectedRoute and
// the public password page that a signed-in Settings flow opens.
function renderDeepLinkHarness({
  bootstrap,
  session,
  pathname,
  retryRestore,
}: {
  bootstrap: BootstrapStatus
  session: TestSession
  pathname: string
  retryRestore?: () => void
}) {
  const tree = (nextSession: TestSession, nextBootstrap: BootstrapStatus) =>
    createElement(
      BootstrapContext.Provider,
      {
        value: {
          bootstrap: nextBootstrap,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        },
      },
      createElement(
        AuthContext.Provider,
        {
          value: {
            status: nextSession.status,
            user: testSessionUser(nextSession),
            acceptSession: vi.fn(),
            refreshUser: vi.fn(),
            retryRestore,
            signOut: vi.fn(),
          },
        },
        createElement(
          MemoryRouter,
          { initialEntries: [pathname] },
          createElement(LocationProbe),
          createElement(
            Routes,
            null,
            createElement(
              Route,
              { element: createElement(BootstrapGate) },
              createElement(Route, {
                path: "/forgot-password",
                element: createElement("p", null, "Forgot password"),
              }),
              createElement(
                Route,
                { element: createElement(PublicAuthRoute) },
                createElement(Route, {
                  path: "/login",
                  element: createElement("p", null, "Sign in"),
                })
              ),
              createElement(
                Route,
                { element: createElement(ProtectedRoute) },
                createElement(Route, {
                  path: "/conversations/new",
                  element: createElement("p", null, "New task"),
                }),
                createElement(Route, {
                  path: "/conversations/:conversationId",
                  element: createElement("p", null, "Conversation task"),
                })
              )
            )
          )
        )
      )
    )
  const view = render(tree(session, bootstrap))
  return (
    nextSession: TestSession,
    nextBootstrap: BootstrapStatus = bootstrap
  ) => view.rerender(tree(nextSession, nextBootstrap))
}

beforeAll(async () => {
  await i18n.changeLanguage("en-US")
})

describe("desktop host boundary", () => {
  afterEach(() => {
    cleanup()
    setAccessToken(null)
    native.isDesktop = false
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.desktopPlatform
    updateDesktopConversationContext({
      authenticated: false,
      ownerId: null,
      ready: false,
    })
  })

  it("keeps the existing browser transport and does not call native services", async () => {
    const browserFetch = vi.fn().mockResolvedValue(new Response("{}"))
    vi.stubGlobal("fetch", browserFetch)
    await initializeDesktopHost()
    expect(getDesktopServerUrl()).toBeNull()
    expect(getDesktopPlatform()).toBeNull()
    await hostFetch("/api/v1/me")
    expect(browserFetch).toHaveBeenCalledWith("/api/v1/me", undefined)
    expect(native.info).not.toHaveBeenCalled()
    expect(native.request).not.toHaveBeenCalled()
  })

  it("validates the bridge and uses the configured server and native transport", async () => {
    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    await initializeDesktopHost()
    expect(getDesktopServerUrl()).toBe("https://example.com")
    expect(getDesktopPlatform()).toBe("darwin")
    expect(document.documentElement.dataset.desktopPlatform).toBe("darwin")
    const controller = new AbortController()
    native.request.mockResolvedValue(new Response("{}"))
    await hostFetch("https://example.com/api/v1/me", {
      signal: controller.signal,
    })
    expect(native.request).toHaveBeenCalledWith(
      "https://example.com/api/v1/me",
      { signal: controller.signal }
    )
    await openDesktopExternal("https://example.com")
    expect(native.openExternal).toHaveBeenCalledWith("https://example.com")
  })

  it("marks the native platform before bridge info resolves", async () => {
    native.isDesktop = true
    vi.stubGlobal("mygo", { platform: "darwin" })
    native.info.mockRejectedValueOnce(new Error("bridge unavailable"))
    await expect(initializeDesktopHost()).rejects.toThrow()
    expect(document.documentElement.dataset.desktopPlatform).toBe("darwin")
  })

  it("binds the Finder action to an opaque Mac save ticket and validates its event", async () => {
    const handle = "a".repeat(43)
    expect(await beginDesktopArtifactDownload()).toBeNull()
    expect(native.beginArtifactDownload).not.toHaveBeenCalled()

    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "windows",
      version: "0.1.0",
    })
    await initializeDesktopHost()
    expect(await beginDesktopArtifactDownload()).toBeNull()
    expect(native.beginArtifactDownload).not.toHaveBeenCalled()

    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    await initializeDesktopHost()
    native.beginArtifactDownload.mockResolvedValue(handle)
    native.beginArtifactPreview.mockResolvedValue(handle)
    expect(await beginDesktopArtifactDownload()).toBe(handle)
    expect(native.beginArtifactDownload).toHaveBeenCalledWith()
    expect(await beginDesktopArtifactDownload(handle)).toBe(handle)
    expect(native.beginArtifactDownload).toHaveBeenLastCalledWith(handle)
    expect(await beginDesktopArtifactPreview()).toBe(handle)
    expect(native.beginArtifactPreview).toHaveBeenCalledWith()
    await armDesktopArtifactDownload(handle, "blob:mygo://localhost/abc")
    expect(native.armArtifactDownload).toHaveBeenCalledWith(
      handle,
      "blob:mygo://localhost/abc"
    )
    await cancelDesktopArtifactDownload(handle)
    expect(native.cancelArtifactDownload).toHaveBeenCalledWith(handle)
    await revealDesktopArtifactDownload(handle)
    expect(native.revealArtifactDownload).toHaveBeenCalledWith(handle)

    const listener = vi.fn()
    const unsubscribe = vi.fn()
    native.onArtifactSaved.mockImplementation(
      (callback: (value: unknown) => void) => {
        callback({ handle, name: "report.txt" })
        callback({ handle: "short", name: "report.txt" })
        callback({ handle, name: "", path: "/tmp/report.txt" })
        return unsubscribe
      }
    )
    expect(subscribeDesktopArtifactSaved(listener)).toBe(unsubscribe)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ handle, name: "report.txt" })
  })

  it("rejects an unsupported bridge rather than making an API request", async () => {
    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 2,
      serverUrl: "https://example.com",
      platform: "windows",
      version: "0.2.0",
    })
    await expect(initializeDesktopHost()).rejects.toThrow()
    expect(native.request).not.toHaveBeenCalled()
  })

  it("connects the router to the native menu only inside the desktop host", () => {
    const navigate = vi.fn()
    const unsubscribe = vi.fn()
    native.onNavigate.mockImplementation(
      (callback: (path: unknown) => void) => {
        emitDesktopNavigation = callback
        return unsubscribe
      }
    )
    expect(subscribeDesktopNavigation(navigate)).toBeUndefined()
    expect(navigate).not.toHaveBeenCalled()

    native.isDesktop = true
    const stop = subscribeDesktopNavigation(navigate)
    expect(stop).toBeTypeOf("function")
    emitDesktopNavigation("https://outside.example.test")
    emitDesktopNavigation({ path: "/settings/general" })
    emitDesktopNavigation("/settings/general")
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith("/settings/general")
    stop?.()
  })

  it("holds only the latest valid conversation path until the guarded router subscribes", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    updateDesktopConversationContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: true,
    })
    const first = "/conversations/71000000-0000-4000-8000-000000000901"
    // Go validates the 8-4-4-4-12 hex shape; z.guid mirrors that native parsing.
    const latest = "/conversations/71000000-0000-0000-0000-000000000903"

    emitDesktopNavigation("/settings/general")
    emitDesktopNavigation("/conversations/new")
    emitDesktopNavigation(first)
    emitDesktopNavigation(first + "?token=fixture")
    emitDesktopNavigation(first + "#token=fixture")
    emitDesktopNavigation("https://outside.example.test" + first)
    emitDesktopNavigation({ path: first })
    emitDesktopNavigation(latest)

    const navigate = vi.fn()
    const stop = subscribeDesktopConversationNavigation(navigate)
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(latest)
    stop?.()

    // Menu actions remain live-only when no protected listener is active.
    emitDesktopNavigation("/settings/general")
    const next = vi.fn()
    const stopNext = subscribeDesktopNavigation(next)
    expect(next).not.toHaveBeenCalled()
    stopNext?.()
    const after = "/conversations/71000000-0000-4000-8000-000000000904"
    emitDesktopNavigation(after)
    expect(next).not.toHaveBeenCalled()

    const final = vi.fn()
    const stopFinal = subscribeDesktopConversationNavigation(final)
    expect(final).toHaveBeenCalledOnce()
    expect(final).toHaveBeenCalledWith(after)
    stopFinal?.()
  })

  it("defers a conversation path until the index redirect settles", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const navigate = vi.fn()
    const stop = subscribeDesktopConversationNavigation(navigate)
    updateDesktopConversationContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: false,
    })
    const target = "/conversations/71000000-0000-4000-8000-000000000905"
    emitDesktopNavigation(target)
    expect(navigate).not.toHaveBeenCalled()
    updateDesktopConversationContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: true,
    })
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(target)
    stop?.()
  })

  it("drops a waiting conversation when the signed-in owner signs out", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const navigate = vi.fn()
    const stop = subscribeDesktopConversationNavigation(navigate)
    const target = "/conversations/71000000-0000-4000-8000-000000000906"
    updateDesktopConversationContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: false,
    })
    emitDesktopNavigation(target)
    expect(navigate).not.toHaveBeenCalled()

    updateDesktopConversationContext({
      authenticated: false,
      ownerId: null,
      ready: false,
    })
    updateDesktopConversationContext({
      authenticated: false,
      ownerId: null,
      ready: false,
    })
    updateDesktopConversationContext({
      authenticated: true,
      ownerId: "owner-b",
      ready: true,
    })
    expect(navigate).not.toHaveBeenCalled()
    stop?.()
  })

  it("keeps a pre-auth conversation link across an anonymous sign-out", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const navigate = vi.fn()
    const stop = subscribeDesktopConversationNavigation(navigate)
    const target = "/conversations/71000000-0000-4000-8000-000000000907"
    updateDesktopConversationContext({
      authenticated: false,
      ownerId: null,
      ready: false,
    })
    emitDesktopNavigation(target)
    // DesktopSignInPage Cancel signs out even though the browser is anonymous.
    updateDesktopConversationContext({
      authenticated: false,
      ownerId: null,
      ready: false,
    })
    updateDesktopConversationContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: true,
    })
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(target)
    stop?.()
  })

  it("opens a conversation link immediately from a signed-in public page", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: {
        status: "authenticated",
        userId: "10000000-0000-4000-8000-0000000000a1",
        role: "user",
      },
      pathname: "/forgot-password",
    })
    expect(screen.getByText("Forgot password")).toBeVisible()

    const target = "/conversations/71000000-0000-4000-8000-000000000908"
    act(() => emitDesktopNavigation(target))

    expect(screen.getByTestId("current-path")).toHaveTextContent(target)
    expect(screen.getByText("Conversation task")).toBeVisible()
    expect(screen.queryByText("Forgot password")).toBeNull()
  })

  it("does not deliver a maintenance-pending link to a replacement account", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const update = renderDeepLinkHarness({
      bootstrap: maintenanceBootstrap,
      session: {
        status: "authenticated",
        userId: "10000000-0000-4000-8000-0000000000a2",
        role: "user",
      },
      pathname: "/conversations/new",
    })
    // Maintenance keeps ProtectedRoute unmounted for a non-admin account.
    expect(screen.queryByText("New task")).toBeNull()
    act(() =>
      emitDesktopNavigation(
        "/conversations/71000000-0000-4000-8000-000000000909"
      )
    )

    // MaintenancePage's admin entry signs A out before B signs in.
    update({ status: "anonymous" })
    update(
      {
        status: "authenticated",
        userId: "10000000-0000-4000-8000-0000000000b2",
        role: "admin",
      },
      maintenanceBootstrap
    )

    expect(screen.getByText("New task")).toBeVisible()
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/conversations/new"
    )
    expect(screen.queryByText("Conversation task")).toBeNull()
  })

  it("fences a pre-auth launch link to the first owner restored under maintenance", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const target = "/conversations/71000000-0000-4000-8000-000000000912"
    const update = renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: { status: "loading" },
      pathname: "/conversations/new",
    })
    // The native link arrives before auth publishes an owner.
    act(() => emitDesktopNavigation(target))

    // A is restored, but maintenance keeps ProtectedRoute unmounted.
    update(
      {
        status: "authenticated",
        userId: "10000000-0000-4000-8000-0000000000a5",
        role: "user",
      },
      maintenanceBootstrap
    )
    expect(screen.queryByText("New task")).toBeNull()
    expect(screen.queryByText("Conversation task")).toBeNull()

    // A chooses Admin Entry and signs out.
    update({ status: "anonymous" }, maintenanceBootstrap)
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/conversations/new"
    )

    // B signs in with an active bootstrap; the stale link must not route.
    update(
      {
        status: "authenticated",
        userId: "10000000-0000-4000-8000-0000000000b5",
        role: "user",
      },
      activeBootstrap
    )
    expect(screen.getByText("New task")).toBeVisible()
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      "/conversations/new"
    )
    expect(screen.queryByText("Conversation task")).toBeNull()
  })

  it("keeps a pre-auth link while a signed-out user cancels and restarts sign-in", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const update = renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: { status: "anonymous" },
      pathname: "/login",
    })
    const target = "/conversations/71000000-0000-4000-8000-000000000910"
    act(() => emitDesktopNavigation(target))

    // Cancel calls signOut while still anonymous, then the retry signs in.
    update({ status: "anonymous" })
    update({
      status: "authenticated",
      userId: "10000000-0000-4000-8000-0000000000a3",
      role: "user",
    })

    expect(screen.getByTestId("current-path")).toHaveTextContent(target)
    expect(screen.getByText("Conversation task")).toBeVisible()
  })

  it("keeps a known owner pending link across a transient session restore", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const update = renderDeepLinkHarness({
      bootstrap: maintenanceBootstrap,
      session: {
        status: "authenticated",
        userId: "10000000-0000-4000-8000-0000000000a4",
        role: "user",
      },
      pathname: "/conversations/new",
    })
    const target = "/conversations/71000000-0000-4000-8000-000000000911"
    act(() => emitDesktopNavigation(target))

    update({
      status: "loading",
      userId: "10000000-0000-4000-8000-0000000000a4",
      role: "user",
    })
    update(
      {
        status: "authenticated",
        userId: "10000000-0000-4000-8000-0000000000a4",
        role: "user",
      },
      activeBootstrap
    )

    expect(screen.getByTestId("current-path")).toHaveTextContent(target)
    expect(screen.getByText("Conversation task")).toBeVisible()
  })

  it("keeps a pending conversation link through an explicit session-restore retry", async () => {
    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    native.resumeDevice.mockResolvedValue({ state: "unpaired" })
    await initializeDesktopHost()
    installDesktopNavigationBridge()
    setAccessToken(null)

    const target = "/conversations/71000000-0000-4000-8000-000000000913"
    const targetUserId = "10000000-0000-4000-8000-0000000000d4"
    const recoveredUser = testSessionUser({
      status: "authenticated",
      userId: targetUserId,
    })
    const session = authSessionSchema.parse({
      access_token: "deep-link-recovery-access-token-00000001",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_session_expires_at: "2099-03-01T00:00:00.000Z",
      user: {
        id: targetUserId,
        email: "deep-link@example.test",
        name: "Deep Link User",
        avatar_object_key: null,
        role: "user",
        status: "active",
        preferred_locale: "en-US",
        running_message_action: "queue",
        last_login_at: null,
        last_login_method: "password",
        password_updated_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    })
    const jsonResponse = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-linksense-desktop-protocol": "1",
        },
      })
    let refreshCalls = 0
    let releaseInitialRefresh!: (response: Response) => void
    let releaseRecoveredRefresh!: (response: Response) => void
    const initialRefresh = new Promise<Response>((resolve) => {
      releaseInitialRefresh = resolve
    })
    const recoveredRefresh = new Promise<Response>((resolve) => {
      releaseRecoveredRefresh = resolve
    })
    native.request.mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === "/api/v1/auth/refresh") {
        refreshCalls += 1
        return refreshCalls === 1 ? initialRefresh : recoveredRefresh
      }
      if (url.pathname === "/api/v1/me") {
        return jsonResponse({ success: true, data: recoveredUser })
      }
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const documentBeforeRestore = document
    const navigationErrors = watchJsdomNavigationErrors()
    const paths: string[] = []
    function PathHistoryProbe() {
      const location = useLocation()
      if (paths.at(-1) !== location.pathname) paths.push(location.pathname)
      return createElement(
        "output",
        { "data-testid": "path-history" },
        paths.join(",")
      )
    }

    render(
      createElement(
        StrictMode,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            BootstrapContext.Provider,
            {
              value: {
                bootstrap: activeBootstrap,
                isLoading: false,
                error: null,
                refetch: vi.fn(),
              },
            },
            createElement(
              AuthProvider,
              null,
              createElement(
                MemoryRouter,
                { initialEntries: ["/conversations/new"] },
                createElement(LocationProbe),
                createElement(PathHistoryProbe),
                createElement(
                  Routes,
                  null,
                  createElement(
                    Route,
                    { element: createElement(BootstrapGate) },
                    createElement(
                      Route,
                      { element: createElement(ProtectedRoute) },
                      createElement(Route, {
                        path: "/conversations/new",
                        element: createElement("p", null, "New task"),
                      }),
                      createElement(Route, {
                        path: "/conversations/:conversationId",
                        element: createElement("p", null, "Conversation task"),
                      })
                    )
                  )
                )
              )
            )
          )
        )
      )
    )

    await waitFor(() => expect(refreshCalls).toBe(1))
    act(() => emitDesktopNavigation(target))
    expect(screen.queryByText("Conversation task")).toBeNull()

    await act(async () => {
      releaseInitialRefresh(
        jsonResponse(
          { success: false, error_code: "AUTH_RESTORE_REJECTED" },
          400
        )
      )
    })
    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible()
    expect(screen.queryByText("Conversation task")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() => expect(refreshCalls).toBe(2))
    expect(await screen.findByText("Loading…")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Retry" })
    ).not.toBeInTheDocument()

    await act(async () => {
      releaseRecoveredRefresh(jsonResponse({ success: true, data: session }))
    })

    expect(await screen.findByText("Conversation task")).toBeVisible()
    await waitFor(() =>
      expect(screen.getByTestId("current-path")).toHaveTextContent(target)
    )
    expect(screen.queryByText("New task")).toBeNull()
    expect(screen.getByTestId("path-history")).toHaveTextContent(
      `/conversations/new,${target}`
    )
    expect(refreshCalls).toBe(2)
    expect(document).toBe(documentBeforeRestore)
    expect(navigationErrors).toEqual([])
  })

  it.each(["web", "windows"] as const)(
    "reloads the document on %s Retry instead of retrying in place",
    async (host) => {
      if (host === "windows") {
        native.isDesktop = true
        native.info.mockResolvedValue({
          bridgeVersion: 1,
          serverUrl: "https://example.com",
          platform: "windows",
          version: "0.1.0",
        })
        await initializeDesktopHost()
      }
      const retryRestore = vi.fn()
      const navigationErrors = watchJsdomNavigationErrors()
      renderDeepLinkHarness({
        bootstrap: activeBootstrap,
        session: { status: "error" },
        pathname: "/login",
        retryRestore,
      })

      fireEvent.click(await screen.findByRole("button", { name: "Retry" }))

      expect(retryRestore).not.toHaveBeenCalled()
      expect(navigationErrors).toEqual([JSDOM_NAVIGATION_ERROR])
    }
  )

  it("verifies notification support and keeps delivery failures distinct", async () => {
    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    native.notificationsSupported.mockResolvedValue(true)
    await initializeDesktopHost()
    expect(supportsNativeDesktopNotifications()).toBe(true)

    const { signal } = new AbortController()
    native.showCompletionNotification.with.mockReturnValue(
      native.showCompletionNotification
    )
    native.showTestNotification.with.mockReturnValue(
      native.showTestNotification
    )
    const input = {
      userId: "10000000-0000-4000-8000-000000000001",
      conversationId: "20000000-0000-4000-8000-000000000001",
      turnId: "30000000-0000-4000-8000-000000000001",
      body: "Processed successfully",
    }
    native.showCompletionNotification.mockResolvedValueOnce(undefined)
    await expect(
      showDesktopCompletionNotification(input, signal)
    ).resolves.toBe("shown")
    expect(native.showCompletionNotification).toHaveBeenCalledWith(input)

    native.showTestNotification.mockResolvedValueOnce(undefined)
    await expect(showDesktopTestNotification("Test", signal)).resolves.toBe(
      "shown"
    )

    native.showCompletionNotification.mockRejectedValueOnce(
      new Error("DESKTOP_NOTIFICATIONS_DENIED")
    )
    await expect(
      showDesktopCompletionNotification(input, signal)
    ).resolves.toBe("denied")

    native.showCompletionNotification.mockRejectedValueOnce(
      new Error("system failure")
    )
    await expect(
      showDesktopCompletionNotification(input, signal)
    ).resolves.toBe("failed")

    native.showCompletionNotification.mockRejectedValueOnce(
      new Error("DESKTOP_NOTIFICATIONS_UNSUPPORTED")
    )
    await expect(
      showDesktopCompletionNotification(input, signal)
    ).resolves.toBe("unsupported")
    await expect(
      showDesktopCompletionNotification(input, AbortSignal.abort())
    ).resolves.toBe("cancelled")
    expect(native.showCompletionNotification.with).toHaveBeenCalledTimes(4)
  })

  it("accepts only UUID notification clicks and holds a launch click", () => {
    native.isDesktop = true
    const target = {
      userId: "10000000-0000-4000-8000-000000000001",
      conversationId: "20000000-0000-4000-8000-000000000001",
    }
    emitNotificationClick("https://outside.example.test")
    emitNotificationClick({ ...target, conversationId: "../../etc/passwd" })

    const listener = vi.fn()
    const unsubscribe = subscribeDesktopNotificationClick(listener)
    expect(listener).not.toHaveBeenCalled()

    emitNotificationClick(target)
    expect(listener).toHaveBeenCalledWith(target)
    expect(desktopNotificationRouteForUser(target, target.userId)).toBe(
      `/conversations/${target.conversationId}`
    )
    expect(
      desktopNotificationRouteForUser(
        target,
        "10000000-0000-4000-8000-000000000002"
      )
    ).toBeNull()

    const pendingTarget = {
      ...target,
      conversationId: "20000000-0000-4000-8000-000000000002",
    }
    unsubscribe?.()
    emitNotificationClick(pendingTarget)
    expect(listener).toHaveBeenCalledTimes(1)
    const nextListener = vi.fn()
    subscribeDesktopNotificationClick(nextListener)
    expect(nextListener).toHaveBeenCalledWith(pendingTarget)
  })

  it("validates the read-only conversation workspace notice", async () => {
    const conversationId = "40000000-0000-4000-8000-000000000001"
    await expect(readDesktopWorkspaceNotice(conversationId)).rejects.toThrow(
      "DESKTOP_HOST_UNAVAILABLE"
    )
    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    await initializeDesktopHost()
    native.workspaceNotice.mockResolvedValue({ cleared: true })
    await expect(readDesktopWorkspaceNotice(conversationId)).resolves.toEqual({
      cleared: true,
    })
    expect(native.workspaceNotice).toHaveBeenCalledWith(conversationId)

    native.workspaceNotice.mockResolvedValueOnce({
      cleared: true,
      path: "/tmp/workspace",
    })
    await expect(readDesktopWorkspaceNotice(conversationId)).rejects.toThrow()
  })

  it("validates native account-scoped workspace usage and cleanup relays", async () => {
    await expect(readDesktopWorkspaceUsage()).rejects.toThrow(
      "DESKTOP_HOST_UNAVAILABLE"
    )
    await expect(cleanupDesktopWorkspaces()).rejects.toThrow(
      "DESKTOP_HOST_UNAVAILABLE"
    )
    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    await initializeDesktopHost()
    native.workspaceUsage.mockResolvedValue({
      bytes: 1536,
      files: 4,
      sessions: 1,
      retentionDays: 14,
      budgetBytes: 10 * 1024 * 1024 * 1024,
    })
    await expect(readDesktopWorkspaceUsage()).resolves.toMatchObject({
      files: 4,
      sessions: 1,
    })
    expect(native.workspaceUsage).toHaveBeenCalledWith()

    native.workspaceUsage.mockResolvedValueOnce({
      bytes: 0,
      files: 0,
      sessions: 0,
      retentionDays: 14,
      budgetBytes: 10 * 1024 * 1024 * 1024,
      path: "/tmp/workspace",
    })
    await expect(readDesktopWorkspaceUsage()).rejects.toThrow()

    native.cleanupWorkspaces.mockResolvedValue({
      status: "busy",
      deletedSessions: 0,
      freedBytes: 0,
      retainedBytes: 0,
    })
    await expect(cleanupDesktopWorkspaces()).resolves.toEqual({
      status: "busy",
      deletedSessions: 0,
      freedBytes: 0,
      retainedBytes: 0,
    })

    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "windows",
      version: "0.1.0",
    })
    await initializeDesktopHost()
    await expect(readDesktopWorkspaceUsage()).rejects.toThrow(
      "DESKTOP_HOST_UNAVAILABLE"
    )
    await expect(cleanupDesktopWorkspaces()).rejects.toThrow(
      "DESKTOP_HOST_UNAVAILABLE"
    )
  })
})

describe("desktop update lifecycle boundary", () => {
  async function initializeHost(platform: "darwin" | "windows") {
    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform,
      version: "0.1.0",
    })
    await initializeDesktopHost()
  }

  afterEach(() => {
    native.isDesktop = false
    vi.clearAllMocks()
    delete document.documentElement.dataset.desktopPlatform
  })

  it("validates native snapshots and rejects unknown feed fields", async () => {
    await initializeHost("darwin")
    native.getUpdateState.mockResolvedValue({
      state: "downloading",
      version: "1.2.3",
      notes: "Release notes <b>literal</b>",
      channel: "beta",
      betaAvailable: true,
      installAvailable: true,
      downloadAvailable: true,
      downloaded: 10,
      total: 100,
      revision: 4,
    })
    await expect(getDesktopUpdateState()).resolves.toEqual({
      state: "downloading",
      version: "1.2.3",
      notes: "Release notes <b>literal</b>",
      channel: "beta",
      betaAvailable: true,
      installAvailable: true,
      downloadAvailable: true,
      downloaded: 10,
      total: 100,
      revision: 4,
    })

    native.getUpdateState.mockResolvedValueOnce({
      state: "available",
      version: "1.2.3",
      releaseUrl: "https://outside.example.test",
      revision: 5,
    })
    await expect(getDesktopUpdateState()).rejects.toThrow()
    native.getUpdateState.mockResolvedValueOnce({
      state: "available",
      version: "1.2.3",
      installerUrl: "https://outside.example.test",
      revision: 6,
    })
    await expect(getDesktopUpdateState()).rejects.toThrow()
    native.getUpdateState.mockResolvedValueOnce({
      state: "available",
      revision: 7,
    })
    await expect(getDesktopUpdateState()).rejects.toThrow()
    native.getUpdateState.mockResolvedValueOnce({
      state: "available",
      version: "1.2.3",
      notes: "x".repeat(4097),
      revision: 8,
    })
    await expect(getDesktopUpdateState()).rejects.toThrow()
  })

  it("keeps the legacy check contract for older Mac responses", async () => {
    await initializeHost("darwin")
    native.checkForUpdate.mockResolvedValue({
      state: "available",
      version: "1.2.3",
    })
    await expect(checkDesktopUpdate()).resolves.toEqual({
      state: "available",
      version: "1.2.3",
    })
    native.checkForUpdate.mockResolvedValueOnce({ state: "available" })
    await expect(checkDesktopUpdate()).rejects.toThrow()
  })

  it("fences installs by the exact revision and persists the channel", async () => {
    await initializeHost("darwin")
    native.installUpdate.mockResolvedValue({
      state: "downloading",
      downloaded: 0,
      total: 50,
      revision: 9,
    })
    await expect(installDesktopUpdate(9)).resolves.toMatchObject({
      state: "downloading",
      revision: 9,
    })
    expect(native.installUpdate).toHaveBeenCalledWith(9)
    await expect(installDesktopUpdate(-1)).rejects.toThrow()
    expect(native.installUpdate).toHaveBeenCalledOnce()

    native.setUpdateChannel.mockResolvedValue({
      state: "available",
      version: "1.2.3",
      channel: "beta",
      betaAvailable: true,
      downloadAvailable: true,
      revision: 10,
    })
    await expect(setDesktopUpdateChannel("beta")).resolves.toMatchObject({
      channel: "beta",
    })
    expect(native.setUpdateChannel).toHaveBeenCalledWith("beta")
  })

  it("restarts and opens the configured installer without accepting a URL", async () => {
    await initializeHost("darwin")
    native.restartAfterUpdate.mockResolvedValue(undefined)
    native.openUpdateInstaller.mockResolvedValue(undefined)
    await restartDesktopAfterUpdate()
    expect(native.restartAfterUpdate).toHaveBeenCalledWith()
    await openDesktopUpdateInstaller()
    expect(native.openUpdateInstaller).toHaveBeenCalledWith()
    expect(native.openExternal).not.toHaveBeenCalled()
  })

  it("delivers only validated update events and can unsubscribe", async () => {
    await initializeHost("darwin")
    let emit: (value: unknown) => void = () => undefined
    const unsubscribe = vi.fn()
    native.onUpdateChanged.mockImplementation(
      (callback: (value: unknown) => void) => {
        emit = callback
        return unsubscribe
      }
    )
    const listener = vi.fn()
    const stop = subscribeDesktopUpdateChanged(listener)
    emit({
      state: "staged",
      version: "1.2.3",
      notes: "Release notes <b>literal</b>",
      revision: 5,
    })
    emit({
      state: "available",
      version: "1.2.3",
      releaseUrl: "https://outside.example.test",
    })
    emit("https://outside.example.test")
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({
      state: "staged",
      version: "1.2.3",
      notes: "Release notes <b>literal</b>",
      revision: 5,
    })
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
