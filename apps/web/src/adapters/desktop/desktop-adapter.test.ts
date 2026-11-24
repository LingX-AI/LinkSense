import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  StrictMode,
  Suspense,
  createElement,
  lazy,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react"
import {
  createMemoryRouter,
  MemoryRouter,
  Navigate,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from "react-router-dom"
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
import { desktopDeviceSettingsHref } from "@/features/desktop-execution/desktop-execution-target"
import { personalizationQueryKey } from "@/features/personalization/use-personalization"
import i18n from "@/i18n"
import { SettingsPersonalizationPage } from "@/pages/settings-pages"

const native = vi.hoisted(() => ({
  isDesktop: false,
  info: vi.fn(),
  request: vi.fn(),
  openExternal: vi.fn(),
  onNavigate: vi.fn(),
  notificationsSupported: vi.fn(),
  showCompletionNotification: Object.assign(vi.fn(), { with: vi.fn() }),
  showTestNotification: Object.assign(vi.fn(), { with: vi.fn() }),
  showUpdateNotification: Object.assign(vi.fn(), { with: vi.fn() }),
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
    showUpdateNotification: native.showUpdateNotification,
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
  cancelDeferredDesktopNotification,
  cancelDesktopArtifactDownload,
  checkDesktopUpdate,
  cleanupDesktopWorkspaces,
  desktopUpdateSettingsHref,
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
  scopeDesktopNotificationNavigation,
  setDesktopUpdateChannel,
  showDesktopCompletionNotification,
  showDesktopTestNotification,
  showDesktopUpdateNotification,
  subscribeDesktopArtifactSaved,
  subscribeDesktopLaunchNavigation,
  subscribeDesktopNavigation,
  subscribeDesktopUpdateChanged,
  supportsNativeDesktopNotifications,
  updateDesktopLaunchContext,
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
const pairingOwner = "10000000-0000-4000-8000-0000000000f1"
const pairingConversation = "71000000-0000-4000-8000-000000000921"
const pairingSession: TestSession = {
  status: "authenticated",
  userId: pairingOwner,
  role: "user",
}

function initializePairingTestHost(platform: "darwin" | "windows" = "darwin") {
  native.isDesktop = true
  native.info.mockResolvedValueOnce({
    bridgeVersion: 1,
    serverUrl: "https://example.test",
    platform,
    version: "0.1.0",
  })
  return initializeDesktopHost()
}

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

function LocationProbe({
  onLocation,
}: {
  onLocation?: (path: string) => void
}) {
  const location = useLocation()
  const path = `${location.pathname}${location.hash}`
  useLayoutEffect(() => {
    onLocation?.(path)
  }, [location.key, onLocation, path])
  return createElement("output", { "data-testid": "current-path" }, path)
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
  conversationPage = createElement("p", null, "Conversation task"),
  session,
  pathname,
  retryRestore,
  onLocation,
}: {
  bootstrap: BootstrapStatus
  conversationPage?: ReactNode
  session: TestSession
  pathname: string
  retryRestore?: () => void
  onLocation?: (path: string) => void
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
          createElement(LocationProbe, { onLocation }),
          createElement(
            Suspense,
            { fallback: createElement("p", null, "Loading destination") },
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
                    index: true,
                    element: createElement(Navigate, {
                      to: "/conversations/new",
                      replace: true,
                    }),
                  }),
                  createElement(Route, {
                    path: "/conversations/new",
                    element: createElement("p", null, "New task"),
                  }),
                  createElement(Route, {
                    path: "/conversations/:conversationId",
                    element: conversationPage,
                  }),
                  createElement(Route, {
                    path: "/settings/general",
                    element: createElement("p", null, "General settings"),
                  })
                )
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
    updateDesktopLaunchContext({
      authenticated: false,
      ownerId: null,
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })
  })

  it("holds a pairing link that arrives before the Mac platform and index route are ready", async () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    expect(getDesktopPlatform()).toBeNull()
    emitDesktopNavigation(desktopDeviceSettingsHref)
    await initializePairingTestHost()

    renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: pairingSession,
      pathname: "/",
    })

    expect(screen.getByTestId("current-path")).toHaveTextContent(
      desktopDeviceSettingsHref
    )
  })

  it("requires the exact pairing settings anchor and deduplicates by pathname and hash", async () => {
    await initializePairingTestHost()
    installDesktopNavigationBridge()
    const onLocation = vi.fn()
    renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: pairingSession,
      pathname: "/settings/general",
      onLocation,
    })
    act(() =>
      emitDesktopNavigation(`${desktopDeviceSettingsHref}?code=fixture`)
    )
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      /^\/settings\/general$/u
    )

    act(() => emitDesktopNavigation(desktopDeviceSettingsHref))
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      desktopDeviceSettingsHref
    )
    onLocation.mockClear()
    act(() => emitDesktopNavigation(desktopDeviceSettingsHref))
    expect(onLocation).not.toHaveBeenCalled()
  })

  it.each(["conversation link", "notification"] as const)(
    "preserves the current conversation anchor on a duplicate %s",
    async (source) => {
      await initializePairingTestHost()
      const conversation = `/conversations/${pairingConversation}`
      const anchoredConversation = `${conversation}#message-fixture`
      const onLocation = vi.fn()
      renderDeepLinkHarness({
        bootstrap: activeBootstrap,
        session: pairingSession,
        pathname: anchoredConversation,
        onLocation,
      })
      onLocation.mockClear()

      act(() => {
        if (source === "conversation link") {
          emitDesktopNavigation(conversation)
        } else {
          emitNotificationClick({
            userId: pairingOwner,
            conversationId: pairingConversation,
          })
        }
      })

      expect(screen.getByTestId("current-path")).toHaveTextContent(
        anchoredConversation
      )
      expect(onLocation).not.toHaveBeenCalled()
    }
  )

  it("does not open a pairing link on Windows", async () => {
    await initializePairingTestHost("windows")
    renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: pairingSession,
      pathname: "/conversations/new",
    })
    act(() => emitDesktopNavigation(desktopDeviceSettingsHref))
    expect(screen.getByText("New task")).toBeVisible()
    expect(screen.queryByText("General settings")).toBeNull()
  })

  it("holds the fixed update-settings notification path until a protected owner is ready", async () => {
    await initializePairingTestHost()
    installDesktopNavigationBridge()
    const menuNavigate = vi.fn()
    const stopMenu = subscribeDesktopNavigation(menuNavigate)
    const navigate = vi.fn()
    const stop = subscribeDesktopLaunchNavigation(navigate)
    updateDesktopLaunchContext({
      authenticated: false,
      ownerId: null,
      ready: false,
      pathname: "/login",
      hash: "",
    })

    act(() => emitDesktopNavigation(desktopUpdateSettingsHref))
    act(() =>
      emitDesktopNavigation(`${desktopUpdateSettingsHref}?token=fixture`)
    )
    expect(navigate).not.toHaveBeenCalled()
    expect(menuNavigate).not.toHaveBeenCalled()

    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: true,
      pathname: "/conversations/new",
      hash: "",
    })
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(desktopUpdateSettingsHref)
    expect(menuNavigate).not.toHaveBeenCalled()
    stop?.()
    stopMenu?.()
  })

  it("keeps an existing launch link ahead of the update notification path", async () => {
    await initializePairingTestHost()
    installDesktopNavigationBridge()
    const navigate = vi.fn()
    const stop = subscribeDesktopLaunchNavigation(navigate)
    const conversation = `/conversations/${pairingConversation}`
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })

    act(() => emitDesktopNavigation(desktopUpdateSettingsHref))
    act(() => emitDesktopNavigation(desktopDeviceSettingsHref))
    act(() => emitDesktopNavigation(conversation))
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: true,
      pathname: "/conversations/new",
      hash: "",
    })
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(conversation)

    // The update intent must not replace the already-opened task after the
    // protected route commits.
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: true,
      pathname: conversation,
      hash: "",
    })
    expect(navigate).toHaveBeenCalledOnce()
    stop?.()
  })

  it("drops a queued update intent once pairing is selected", async () => {
    await initializePairingTestHost()
    installDesktopNavigationBridge()
    const navigate = vi.fn()
    const stop = subscribeDesktopLaunchNavigation(navigate)
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })

    act(() => {
      emitDesktopNavigation(desktopUpdateSettingsHref)
      emitDesktopNavigation(desktopDeviceSettingsHref)
    })
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: true,
      pathname: "/conversations/new",
      hash: "",
    })
    expect(navigate.mock.calls).toEqual([[desktopDeviceSettingsHref]])

    // The update intent must not surface on the next context flush after the
    // pairing route (or its blocked draft) commits.
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: true,
      pathname: "/settings/general",
      hash: "#desktop-devices-heading",
    })
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: true,
      pathname: "/settings/personalization",
      hash: "",
    })
    expect(navigate.mock.calls).toEqual([[desktopDeviceSettingsHref]])
    stop?.()
  })

  it("discards an update intent while a conversation handoff waits on a draft", async () => {
    await initializePairingTestHost()
    installDesktopNavigationBridge()
    const navigate = vi.fn()
    const stop = subscribeDesktopLaunchNavigation(navigate)
    const pathname = "/settings/personalization"
    const linked = `/conversations/${pairingConversation}`
    const buffered = "71000000-0000-4000-8000-000000000927"
    const stopScope = scopeDesktopNotificationNavigation(pairingOwner, pathname)
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: false,
      pathname,
      hash: "",
    })

    act(() => {
      emitDesktopNavigation(linked)
      emitNotificationClick({
        userId: pairingOwner,
        conversationId: buffered,
      })
    })
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: true,
      pathname,
      hash: "",
    })
    expect(navigate.mock.calls).toEqual([[linked]])

    // The update intent arrives while the lower-priority notification click
    // waits behind the conversation/draft handoff. Declining that draft must
    // not leave the update intent to jump to Settings later.
    act(() => emitDesktopNavigation(desktopUpdateSettingsHref))
    act(() => cancelDeferredDesktopNotification(linked))
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: true,
      pathname,
      hash: "",
    })
    expect(navigate.mock.calls).toEqual([[linked]])
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: pairingOwner,
      ready: true,
      pathname: "/settings/general",
      hash: "",
    })
    expect(navigate.mock.calls).toEqual([[linked]])
    stopScope?.()
    stop?.()
  })

  it("opens pairing only after an anonymous sign-in has been cancelled and retried", async () => {
    await initializePairingTestHost()
    const update = renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: { status: "anonymous" },
      pathname: "/login",
    })
    act(() => emitDesktopNavigation(desktopDeviceSettingsHref))
    update({ status: "loading" })
    update({ status: "anonymous" })
    expect(screen.getByText("Sign in")).toBeVisible()
    expect(native.openExternal).not.toHaveBeenCalled()

    update(pairingSession)
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      desktopDeviceSettingsHref
    )
  })

  it("does not pass an owner-bound waiting pairing link to a replacement account", async () => {
    await initializePairingTestHost()
    const onLocation = vi.fn()
    const update = renderDeepLinkHarness({
      bootstrap: maintenanceBootstrap,
      session: pairingSession,
      pathname: "/conversations/new",
      onLocation,
    })
    act(() => emitDesktopNavigation(desktopDeviceSettingsHref))
    update({ status: "loading", userId: pairingOwner })
    update({ status: "anonymous" })
    update(
      { ...pairingSession, userId: "10000000-0000-4000-8000-0000000000f2" },
      activeBootstrap
    )
    expect(screen.getByText("New task")).toBeVisible()
    expect(onLocation).not.toHaveBeenCalledWith(desktopDeviceSettingsHref)
  })

  it.each(["conversation link", "notification"] as const)(
    "stages both distinct conversation destinations despite pairing (%s first)",
    async (first) => {
      await initializePairingTestHost()
      const conversation = `/conversations/${pairingConversation}`
      const notificationConversation = "71000000-0000-4000-8000-000000000922"
      const notification = `/conversations/${notificationConversation}`
      const onLocation = vi.fn()
      const update = renderDeepLinkHarness({
        bootstrap: activeBootstrap,
        session: { status: "loading" },
        pathname: "/conversations/new",
        onLocation,
      })
      const emitConversation = () => emitDesktopNavigation(conversation)
      const emitNotification = () =>
        emitNotificationClick({
          userId: pairingOwner,
          conversationId: notificationConversation,
        })

      act(() => {
        if (first === "conversation link") emitConversation()
        else emitNotification()
        emitDesktopNavigation(desktopDeviceSettingsHref)
        if (first === "conversation link") emitNotification()
        else emitConversation()
      })
      onLocation.mockClear()

      update(pairingSession)
      await waitFor(() =>
        expect(onLocation.mock.calls).toEqual([[conversation], [notification]])
      )
      expect(screen.getByTestId("current-path")).toHaveTextContent(notification)
    }
  )

  it.each([
    { first: "conversation link", next: "fresh notification", owner: "f1" },
    { first: "notification", next: "fresh notification", owner: "f2" },
    { first: "conversation link", next: "unrelated navigation", owner: "f3" },
    { first: "notification", next: "wrong-owner notification", owner: "f4" },
    {
      first: "conversation link",
      next: "link to pending notification",
      owner: "f5",
    },
    {
      first: "notification",
      next: "replacement conversation link",
      owner: "f6",
    },
  ] as const)(
    "guards an unsaved draft with $first buffered first and $next afterward",
    async ({ first, next, owner }) => {
      await initializePairingTestHost()
      const pathname = "/settings/personalization"
      const linked = `/conversations/${pairingConversation}`
      const buffered = "71000000-0000-4000-8000-000000000924"
      const fresh = "71000000-0000-4000-8000-000000000925"
      const userId = `10000000-0000-4000-8000-0000000000${owner}`
      const unrelated = "/settings/general"
      const queryClient = new QueryClient()
      queryClient.setQueryData(personalizationQueryKey, {
        custom_instructions: "",
        memories_enabled: false,
        show_reasoning: false,
        task_auto_naming: "first_message",
      })
      const router = createMemoryRouter(
        [
          {
            element: createElement(BootstrapGate),
            children: [
              {
                element: createElement(ProtectedRoute),
                children: [
                  {
                    path: pathname,
                    element: createElement(SettingsPersonalizationPage),
                  },
                  {
                    path: "/conversations/:conversationId",
                    element: createElement(LocationProbe),
                  },
                  { path: unrelated, element: createElement(LocationProbe) },
                ],
              },
            ],
          },
        ],
        { initialEntries: [pathname] }
      )
      render(
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
              AuthContext.Provider,
              {
                value: {
                  status: "authenticated",
                  user: testSessionUser({ ...pairingSession, userId }),
                  acceptSession: vi.fn(),
                  refreshUser: vi.fn(),
                  signOut: vi.fn(),
                },
              },
              createElement(RouterProvider, { router })
            )
          )
        )
      )
      const draft = screen.getByRole("textbox", { name: "Custom instructions" })
      act(() => draft.focus())
      fireEvent.change(draft, { target: { value: "Unsaved instructions" } })
      const updateReadiness = (ready: boolean) =>
        updateDesktopLaunchContext({
          authenticated: true,
          ownerId: userId,
          ready,
          pathname,
          hash: "",
        })
      const click = (conversationId: string, ownerId = userId) =>
        emitNotificationClick({ userId: ownerId, conversationId })
      act(() => {
        // Exercise both arrival orders before the launch gate can route.
        updateReadiness(false)
        if (first === "conversation link") emitDesktopNavigation(linked)
        click(buffered)
        if (first === "notification") emitDesktopNavigation(linked)
        updateReadiness(true)
      })
      const title = "Discard Unsaved Changes?"
      expect(
        await screen.findByRole("alertdialog", { name: title })
      ).toBeVisible()
      expect(router.state.location.pathname).toBe(pathname)
      expect([...router.state.blockers.values()][0]?.location?.pathname).toBe(
        linked
      )

      if (next === "wrong-owner notification") {
        act(() => click(fresh, "10000000-0000-4000-8000-0000000000f9"))
        expect([...router.state.blockers.values()][0]?.location?.pathname).toBe(
          linked
        )
        fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }))
        await waitFor(() =>
          expect(screen.getByTestId("current-path")).toHaveTextContent(
            `/conversations/${buffered}`
          )
        )
        return
      }

      if (
        next === "link to pending notification" ||
        next === "replacement conversation link"
      ) {
        const replacement = `/conversations/${next === "link to pending notification" ? buffered : fresh}`
        act(() => emitDesktopNavigation(replacement))
        expect([...router.state.blockers.values()][0]?.location?.pathname).toBe(
          replacement
        )
      }

      fireEvent.click(screen.getByRole("button", { name: "Stay on Page" }))
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog", { name: title })).toBeNull()
        expect(draft).toHaveFocus()
      })
      expect(draft).toHaveValue("Unsaved instructions")
      expect(router.state.location.pathname).toBe(pathname)

      const destination =
        next === "unrelated navigation" ? unrelated : `/conversations/${fresh}`
      if (next === "unrelated navigation") {
        await act(async () => router.navigate(unrelated))
      } else if (next === "replacement conversation link") {
        // Re-opening the first declined target must not revive the old click.
        act(() => emitDesktopNavigation(linked))
      } else {
        act(() => click(fresh))
      }
      expect(
        await screen.findByRole("alertdialog", { name: title })
      ).toBeVisible()
      expect(draft).toHaveValue("Unsaved instructions")

      fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }))
      const expected =
        next === "replacement conversation link" ? linked : destination
      expect(await screen.findByTestId("current-path")).toHaveTextContent(
        expected
      )
      expect(router.state.location.pathname).toBe(expected)
    }
  )

  it("keeps a notification pending when the protected destination is lazy", async () => {
    await initializePairingTestHost()
    const conversation = `/conversations/${pairingConversation}`
    const notificationConversation = "71000000-0000-4000-8000-000000000923"
    const notification = `/conversations/${notificationConversation}`
    let reveal: () => void = () => undefined
    const loading = new Promise<void>((resolve) => {
      reveal = resolve
    })
    const LazyDetails = lazy(async () => {
      await loading
      return {
        default: () => createElement("p", null, "Conversation task"),
      }
    })
    function ConversationFixture() {
      const [showDetails, setShowDetails] = useState(false)
      return showDetails
        ? createElement(LazyDetails)
        : createElement(
            "button",
            { onClick: () => setShowDetails(true) },
            "Load details"
          )
    }
    const onLocation = vi.fn()
    renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: pairingSession,
      pathname: conversation,
      conversationPage: createElement(ConversationFixture),
      onLocation,
    })
    onLocation.mockClear()

    fireEvent.click(screen.getByRole("button", { name: "Load details" }))
    expect(screen.getByText("Loading destination")).toBeVisible()
    act(() => {
      emitNotificationClick({
        userId: pairingOwner,
        conversationId: notificationConversation,
      })
    })
    expect(onLocation).not.toHaveBeenCalled()

    // The original location and owner never changed; only the protected
    // guard's layout effect resumes when the lazy details become available.
    await act(async () => reveal())
    expect(onLocation.mock.calls).toEqual([[notification]])
    expect(screen.getByText("Conversation task")).toBeVisible()
  })

  it.each([
    {
      surface: "/conversations/new",
      sibling: "conversation",
      pairingFirst: true,
    },
    {
      surface: "/conversations/new",
      sibling: "conversation",
      pairingFirst: false,
    },
    {
      surface: "/forgot-password",
      sibling: "conversation",
      pairingFirst: true,
    },
    {
      surface: "/forgot-password",
      sibling: "conversation",
      pairingFirst: false,
    },
    {
      surface: "/conversations/new",
      sibling: "notification",
      pairingFirst: true,
    },
    {
      surface: "/conversations/new",
      sibling: "notification",
      pairingFirst: false,
    },
    {
      surface: "/forgot-password",
      sibling: "notification",
      pairingFirst: true,
    },
    {
      surface: "/forgot-password",
      sibling: "notification",
      pairingFirst: false,
    },
  ])(
    "handles $sibling and pairing (pairing first: $pairingFirst) from $surface",
    async ({ surface, sibling, pairingFirst }) => {
      await initializePairingTestHost()
      const onLocation = vi.fn()
      const update = renderDeepLinkHarness({
        bootstrap: activeBootstrap,
        session: { status: "loading" },
        pathname: surface,
        onLocation,
      })
      const conversation = `/conversations/${pairingConversation}`
      const emitSibling = () =>
        sibling === "conversation"
          ? emitDesktopNavigation(conversation)
          : emitNotificationClick({
              userId: pairingOwner,
              conversationId: pairingConversation,
            })
      act(() => {
        if (pairingFirst) emitDesktopNavigation(desktopDeviceSettingsHref)
        emitSibling()
        if (!pairingFirst) emitDesktopNavigation(desktopDeviceSettingsHref)
      })
      expect(screen.getByTestId("current-path")).toHaveTextContent(surface)
      onLocation.mockClear()

      update(pairingSession)
      expect(screen.getByTestId("current-path")).toHaveTextContent(conversation)
      if (surface === "/forgot-password" && sibling === "notification") {
        // A notification cannot navigate from a public route; it first becomes
        // eligible once the pairing link reaches Settings under ProtectedRoute.
        expect(onLocation.mock.calls).toEqual([
          [desktopDeviceSettingsHref],
          [conversation],
        ])
      } else {
        expect(onLocation.mock.calls).toEqual([[conversation]])
      }
    }
  )

  it("runs a buffered public-page conversation before its distinct notification and discards pairing", async () => {
    await initializePairingTestHost()
    const first = `/conversations/${pairingConversation}`
    const notification = "71000000-0000-4000-8000-000000000926"
    const onLocation = vi.fn()
    const update = renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: { ...pairingSession, status: "loading" },
      pathname: "/forgot-password",
      onLocation,
    })
    act(() => {
      emitNotificationClick({
        userId: pairingOwner,
        conversationId: notification,
      })
      emitDesktopNavigation(desktopDeviceSettingsHref)
      emitDesktopNavigation(first)
    })
    onLocation.mockClear()
    update(pairingSession)
    await waitFor(() =>
      expect(onLocation.mock.calls).toEqual([
        [first],
        [`/conversations/${notification}`],
      ])
    )
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
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: true,
      pathname: "/conversations/new",
      hash: "",
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
    const stop = subscribeDesktopLaunchNavigation(navigate)
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
    const stopFinal = subscribeDesktopLaunchNavigation(final)
    expect(final).toHaveBeenCalledOnce()
    expect(final).toHaveBeenCalledWith(after)
    stopFinal?.()
  })

  it("defers a conversation path until the index redirect settles", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const navigate = vi.fn()
    const stop = subscribeDesktopLaunchNavigation(navigate)
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })
    const target = "/conversations/71000000-0000-4000-8000-000000000905"
    emitDesktopNavigation(target)
    expect(navigate).not.toHaveBeenCalled()
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: true,
      pathname: "/conversations/new",
      hash: "",
    })
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(target)
    stop?.()
  })

  it("drops a waiting conversation when the signed-in owner signs out", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const navigate = vi.fn()
    const stop = subscribeDesktopLaunchNavigation(navigate)
    const target = "/conversations/71000000-0000-4000-8000-000000000906"
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })
    emitDesktopNavigation(target)
    expect(navigate).not.toHaveBeenCalled()

    updateDesktopLaunchContext({
      authenticated: false,
      ownerId: null,
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })
    updateDesktopLaunchContext({
      authenticated: false,
      ownerId: null,
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: "owner-b",
      ready: true,
      pathname: "/conversations/new",
      hash: "",
    })
    expect(navigate).not.toHaveBeenCalled()
    stop?.()
  })

  it("keeps a pre-auth conversation link across an anonymous sign-out", () => {
    native.isDesktop = true
    installDesktopNavigationBridge()
    const navigate = vi.fn()
    const stop = subscribeDesktopLaunchNavigation(navigate)
    const target = "/conversations/71000000-0000-4000-8000-000000000907"
    updateDesktopLaunchContext({
      authenticated: false,
      ownerId: null,
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })
    emitDesktopNavigation(target)
    // DesktopSignInPage Cancel signs out even though the browser is anonymous.
    updateDesktopLaunchContext({
      authenticated: false,
      ownerId: null,
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: "owner-a",
      ready: true,
      pathname: "/conversations/new",
      hash: "",
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

    native.showUpdateNotification.with.mockReturnValue(
      native.showUpdateNotification
    )
    native.showUpdateNotification.mockResolvedValueOnce(undefined)
    await expect(showDesktopUpdateNotification(7, signal)).resolves.toBe(
      "shown"
    )
    expect(native.showUpdateNotification).toHaveBeenCalledWith(7)
    native.showUpdateNotification.mockRejectedValueOnce(
      new Error("DESKTOP_UPDATE_STALE")
    )
    await expect(showDesktopUpdateNotification(8, signal)).resolves.toBe(
      "stale"
    )
    native.showUpdateNotification.mockRejectedValueOnce(
      new Error("DESKTOP_UPDATE_BUSY")
    )
    await expect(showDesktopUpdateNotification(11, signal)).resolves.toBe(
      "stale"
    )
    native.showUpdateNotification.mockRejectedValueOnce(
      new Error("AUTH_REQUIRED")
    )
    await expect(showDesktopUpdateNotification(12, signal)).resolves.toBe(
      "stale"
    )
    // A malformed or zero revision is rejected locally, without a native call
    // or an unhandled rejected promise.
    const nativeCalls = native.showUpdateNotification.mock.calls.length
    await expect(showDesktopUpdateNotification(0, signal)).resolves.toBe(
      "failed"
    )
    await expect(
      showDesktopUpdateNotification(Number.NaN, signal)
    ).resolves.toBe("failed")
    expect(native.showUpdateNotification).toHaveBeenCalledTimes(nativeCalls)
    // A mixed legacy host still exposes the generated `.with`; the host rejects
    // the unbound method with the exact Go reply. Only the update call maps
    // that reply to unsupported.
    native.showUpdateNotification.with.mockReturnValueOnce(() =>
      Promise.reject(
        new Error("method Desktop.ShowUpdateNotification is not bound")
      )
    )
    await expect(showDesktopUpdateNotification(10, signal)).resolves.toBe(
      "unsupported"
    )
    native.showCompletionNotification.with.mockReturnValueOnce(() =>
      Promise.reject(
        new Error("method Desktop.ShowUpdateNotification is not bound")
      )
    )
    await expect(
      showDesktopCompletionNotification(input, signal)
    ).resolves.toBe("failed")
    await expect(
      showDesktopUpdateNotification(9, AbortSignal.abort())
    ).resolves.toBe("cancelled")
  })

  it("opens only valid notification clicks for the current protected account", async () => {
    await initializePairingTestHost()
    const target = {
      userId: pairingOwner,
      conversationId: pairingConversation,
    }
    const otherOwner = "10000000-0000-4000-8000-000000000002"
    const update = renderDeepLinkHarness({
      bootstrap: activeBootstrap,
      session: { status: "loading" },
      pathname: "/conversations/new",
    })
    act(() => {
      emitNotificationClick(target)
      emitNotificationClick("https://outside.example.test")
      emitNotificationClick({ ...target, conversationId: "../../etc/passwd" })
    })
    update({ ...pairingSession, userId: otherOwner })
    expect(screen.getByText("New task")).toBeVisible()
    expect(screen.queryByText("Conversation task")).toBeNull()

    update(pairingSession)
    expect(screen.getByText("New task")).toBeVisible()
    act(() => emitNotificationClick(target))
    expect(screen.getByTestId("current-path")).toHaveTextContent(
      `/conversations/${target.conversationId}`
    )
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
