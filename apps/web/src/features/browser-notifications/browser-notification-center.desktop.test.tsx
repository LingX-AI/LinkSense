import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"
import {
  MemoryRouter,
  createMemoryRouter,
  RouterProvider,
} from "react-router-dom"

import { ApiError, apiRequest } from "@/api/client"
import { beginLoginSession, getLoginSessionBoundary } from "@/api/session"
import { bootstrapSchema, userSchema } from "@/api/contracts"
import { AuthContext, type AuthContextValue } from "@/app/auth-state"
import { BootstrapContext } from "@/app/bootstrap-state"
import {
  BootstrapGate,
  ProtectedRoute,
  PublicAuthRoute,
} from "@/app/route-guards"
import {
  cancelPendingApprovalNotificationClick,
  initializeDesktopHost,
  scopeDesktopNotificationNavigation,
  subscribeDesktopLaunchNavigation,
  updateDesktopLaunchContext,
} from "@/adapters/desktop/desktop-adapter"
import { BrowserNotificationCenter } from "@/features/browser-notifications/browser-notification-center"
import {
  browserNotificationDeliveryStorageKey,
  clearBrowserNotificationFeedCursor,
  disableBrowserNotifications,
  persistBrowserNotificationPreference,
  persistDesktopApprovalReminder,
  readBrowserNotificationPreference,
} from "@/features/browser-notifications/browser-notification-preference"
import { useDesktopApprovalNotificationClickVerifier } from "@/features/browser-notifications/use-desktop-approval-notification"
import i18n from "@/i18n"

const native = vi.hoisted(() => ({
  info: vi.fn(),
  notificationsSupported: vi.fn(),
  showCompletionNotification: Object.assign(vi.fn(), { with: vi.fn() }),
  showApprovalNotification: Object.assign(vi.fn(), { with: vi.fn() }),
  showTestNotification: vi.fn(),
  onNotificationClick: vi.fn(),
}))
vi.mock("mygo-runtime", () => ({ isMyGo: () => true }))
vi.mock("@mygo-plugins/fetch", () => ({ fetch: vi.fn() }))
vi.mock("@/adapters/desktop/mygo", () => ({
  Desktop: {
    info: native.info,
    notificationsSupported: native.notificationsSupported,
    showCompletionNotification: native.showCompletionNotification,
    showApprovalNotification: native.showApprovalNotification,
    showTestNotification: native.showTestNotification,
  },
  events: {
    desktopNotificationClick: { on: native.onNotificationClick },
    desktopNavigate: { on: vi.fn() },
  },
}))
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>()
  return { ...actual, apiRequest: vi.fn() }
})

let emitNotificationClick: (value: unknown) => void = () => undefined
native.onNotificationClick.mockImplementation(
  (callback: (value: unknown) => void) => {
    emitNotificationClick = callback
    return vi.fn()
  }
)

const USER_ID = "10000000-0000-4000-8000-000000000001"
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const TURN_ID = "30000000-0000-4000-8000-000000000001"
const FIRST_CURSOR =
  "2026-08-09T10:00:00.000Z|00000000-0000-4000-8000-000000000000"
const TASK_TITLE = "Quarterly review"

const user = userSchema.parse({
  id: USER_ID,
  name: "Member",
  email: "member@example.test",
  role: "user",
  status: "active",
  avatar_url: null,
  language: "zh-CN",
  login_method: "password",
  running_message_action: "queue",
  registration_source: "organization_invitation",
  user_groups: [],
})

function installCompletionFeed(turnId = TURN_ID) {
  vi.mocked(apiRequest).mockImplementation(async (_path, options) => {
    const cursor = options.query?.cursor
    if (!cursor) return { items: [], next_cursor: FIRST_CURSOR }
    if (cursor === FIRST_CURSOR) {
      const item = {
        turn_id: turnId,
        conversation_id: CONVERSATION_ID,
        source: "task" as const,
        task_title: TASK_TITLE,
        status: "completed" as const,
        terminal_at: "2026-08-09T10:00:01.000Z",
      }
      return {
        items: [item, item],
        next_cursor: `2026-08-09T10:00:01.000Z|${turnId}`,
      }
    }
    return { items: [], next_cursor: `2026-08-09T10:00:01.000Z|${turnId}` }
  })
}

function renderCenter(userId = USER_ID) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            status: "authenticated",
            user:
              userId === USER_ID
                ? user
                : userSchema.parse({ ...user, id: userId }),
            acceptSession: vi.fn(),
            refreshUser: vi.fn(),
            signOut: vi.fn(),
          }}
        >
          <MemoryRouter initialEntries={["/conversations/new"]}>
            <BrowserNotificationCenter />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

describe("BrowserNotificationCenter on macOS", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    clearBrowserNotificationFeedCursor(USER_ID)
    vi.clearAllMocks()
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    native.notificationsSupported.mockResolvedValue(true)
    native.showCompletionNotification.mockResolvedValue(undefined)
    native.showCompletionNotification.with.mockReturnValue(
      native.showCompletionNotification
    )
    native.showApprovalNotification.mockResolvedValue(undefined)
    native.showApprovalNotification.with.mockReturnValue(
      native.showApprovalNotification
    )
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    })
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    await initializeDesktopHost()
    await i18n.changeLanguage("en-US")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, "visibilityState")
    window.localStorage.clear()
  })

  it("shows a generic native notification once without task content", async () => {
    installCompletionFeed()
    persistBrowserNotificationPreference(USER_ID, true)

    renderCenter()

    await vi.waitFor(() =>
      expect(native.showCompletionNotification).toHaveBeenCalledOnce()
    )
    const input = native.showCompletionNotification.mock.calls[0]?.[0]
    expect(input).toEqual({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      body: "Processed successfully",
    })
    expect(JSON.stringify(input)).not.toContain(TASK_TITLE)
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(USER_ID)
      )
    ).toContain(`task:${TURN_ID}`)
  })

  it("turns off delivery and does not claim a notification that macOS denied", async () => {
    const deniedTurnId = "30000000-0000-4000-8000-000000000002"
    installCompletionFeed(deniedTurnId)
    native.showCompletionNotification.mockRejectedValue(
      new Error("DESKTOP_NOTIFICATIONS_DENIED")
    )
    persistBrowserNotificationPreference(USER_ID, true)

    renderCenter()

    await vi.waitFor(() =>
      expect(readBrowserNotificationPreference(USER_ID)).toMatchObject({
        enabled: false,
        permission: "denied",
      })
    )
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(USER_ID)
      ) ?? ""
    ).not.toContain(`task:${deniedTurnId}`)
  })

  it("cancels native delivery on opt-out before the system answers", async () => {
    installCompletionFeed("30000000-0000-4000-8000-000000000003")
    native.showCompletionNotification.with.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        () =>
          new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true })
          })
    )
    persistBrowserNotificationPreference(USER_ID, true)
    renderCenter()

    await vi.waitFor(() =>
      expect(native.showCompletionNotification.with).toHaveBeenCalledOnce()
    )
    const signal =
      native.showCompletionNotification.with.mock.calls[0]?.[0].signal
    disableBrowserNotifications(USER_ID)
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(USER_ID)
      ) ?? ""
    ).not.toContain("30000000-0000-4000-8000-000000000003")
  })

  it("does not treat a saved browser preference as consent to native notifications", () => {
    window.localStorage.setItem(
      `linksense.browserNotifications.enabled:${USER_ID}`,
      "true"
    )
    expect(readBrowserNotificationPreference(USER_ID).enabled).toBe(false)
  })
})

const APPROVAL_REQUEST_ID = "40000000-0000-4000-8000-000000000001"
const APPROVAL_USER_ID = "10000000-0000-4000-8000-000000000004"
const APPROVAL_FEED_PATH = "/conversations/desktop-approval-notifications"

function approvalItem(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: CONVERSATION_ID,
    request_id: APPROVAL_REQUEST_ID,
    expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
    ...overrides,
  }
}

function approvalRequestCalls() {
  return vi
    .mocked(apiRequest)
    .mock.calls.filter(([path]) => path === APPROVAL_FEED_PATH)
}

function installApprovalFeed(
  items: unknown[],
  completionItems: unknown[] = []
) {
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (path === APPROVAL_FEED_PATH) {
      if (options.query) throw new Error("approval snapshot must not query")
      return { items }
    }
    const cursor = options.query?.cursor
    if (!cursor) return { items: [], next_cursor: FIRST_CURSOR }
    if (cursor === FIRST_CURSOR && completionItems.length) {
      return {
        items: completionItems,
        next_cursor: `2026-08-09T10:00:01.000Z|${TURN_ID}`,
      }
    }
    return { items: [], next_cursor: `2026-08-09T10:00:01.000Z|${TURN_ID}` }
  })
}

function hideWindow() {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  })
  vi.spyOn(document, "hasFocus").mockReturnValue(false)
  document.dispatchEvent(new Event("visibilitychange"))
  window.dispatchEvent(new Event("blur"))
}

function showWindow() {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
  vi.spyOn(document, "hasFocus").mockReturnValue(true)
  document.dispatchEvent(new Event("visibilitychange"))
  window.dispatchEvent(new Event("focus"))
}

describe("DesktopApprovalNotificationCenter on macOS", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    clearBrowserNotificationFeedCursor(APPROVAL_USER_ID)
    vi.clearAllMocks()
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    native.notificationsSupported.mockResolvedValue(true)
    native.showCompletionNotification.mockResolvedValue(undefined)
    native.showCompletionNotification.with.mockReturnValue(
      native.showCompletionNotification
    )
    native.showApprovalNotification.mockResolvedValue(undefined)
    native.showApprovalNotification.with.mockReturnValue(
      native.showApprovalNotification
    )
    hideWindow()
    await initializeDesktopHost()
    await i18n.changeLanguage("en-US")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, "visibilityState")
    window.localStorage.clear()
  })

  it("stays inert until the master and the approval choice are both on", async () => {
    const completion = {
      turn_id: TURN_ID,
      conversation_id: CONVERSATION_ID,
      source: "task",
      task_title: TASK_TITLE,
      status: "completed",
      terminal_at: "2026-08-09T10:00:01.000Z",
    }
    installApprovalFeed([approvalItem()], [completion])
    persistBrowserNotificationPreference(APPROVAL_USER_ID, true)

    renderCenter(APPROVAL_USER_ID)

    await vi.waitFor(() =>
      expect(native.showCompletionNotification).toHaveBeenCalledOnce()
    )
    expect(native.showApprovalNotification).not.toHaveBeenCalled()
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.some(([path]) => path === APPROVAL_FEED_PATH)
    ).toBe(false)
  })

  it("shows one generic approval reminder while hidden and dedupes across remounts", async () => {
    installApprovalFeed([approvalItem(), approvalItem()])
    persistBrowserNotificationPreference(APPROVAL_USER_ID, true)
    persistDesktopApprovalReminder(APPROVAL_USER_ID, true)

    const first = renderCenter(APPROVAL_USER_ID)

    await vi.waitFor(() =>
      expect(native.showApprovalNotification).toHaveBeenCalledOnce()
    )
    expect(native.showApprovalNotification).toHaveBeenCalledWith({
      userId: APPROVAL_USER_ID,
      conversationId: CONVERSATION_ID,
      requestId: APPROVAL_REQUEST_ID,
      expiresAt: expect.any(String),
    })
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(APPROVAL_USER_ID)
      )
    ).toContain(`approval:${APPROVAL_REQUEST_ID}`)

    first.unmount()
    renderCenter(APPROVAL_USER_ID)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(native.showApprovalNotification).toHaveBeenCalledOnce()
  })

  it("uses a fresh background snapshot when the pending bytes are unchanged", async () => {
    const freshUser = "10000000-0000-4000-8000-000000000009"
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    installApprovalFeed([approvalItem({ expires_at: expiresAt })])
    persistBrowserNotificationPreference(freshUser, true)
    persistDesktopApprovalReminder(freshUser, true)
    showWindow()

    const first = renderCenter(freshUser)

    // A visible, focused app does not need the approval snapshot at all.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(approvalRequestCalls()).toHaveLength(0)
    expect(native.showApprovalNotification).not.toHaveBeenCalled()

    // Moving to the background starts a fresh snapshot. The item is identical
    // to what the previous, foreground-skipped scan would have returned, so a
    // delivery effect keyed only on the shared data object never reruns.
    hideWindow()
    await vi.waitFor(() =>
      expect(native.showApprovalNotification).toHaveBeenCalledOnce()
    )
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(freshUser)
      )
    ).toContain(`approval:${APPROVAL_REQUEST_ID}`)

    first.unmount()
    renderCenter(freshUser)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(native.showApprovalNotification).toHaveBeenCalledOnce()
  })

  it("cancels an in-flight background snapshot when the app returns to the foreground", async () => {
    const pendingUser = "10000000-0000-4000-8000-000000000006"
    let approvalSignal: AbortSignal | undefined
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === APPROVAL_FEED_PATH) {
        approvalSignal = options.signal
        return await new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Request aborted", "AbortError")),
            { once: true }
          )
        })
      }
      const cursor = options.query?.cursor
      if (!cursor) return { items: [], next_cursor: FIRST_CURSOR }
      return { items: [], next_cursor: FIRST_CURSOR }
    })
    persistBrowserNotificationPreference(pendingUser, true)
    persistDesktopApprovalReminder(pendingUser, true)

    const view = renderCenter(pendingUser)

    await vi.waitFor(() => expect(approvalSignal).toBeDefined())
    expect(approvalSignal?.aborted).toBe(false)
    showWindow()
    await vi.waitFor(() => expect(approvalSignal?.aborted).toBe(true))

    view.unmount()
    expect(native.showApprovalNotification).not.toHaveBeenCalled()
  })

  it("cancels the approval snapshot when the login boundary changes", async () => {
    const boundaryUser = "10000000-0000-4000-8000-00000000000b"
    const approvalSignals: AbortSignal[] = []
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === APPROVAL_FEED_PATH) {
        if (options.signal) approvalSignals.push(options.signal)
        return await new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Request aborted", "AbortError")),
            { once: true }
          )
        })
      }
      const cursor = options.query?.cursor
      if (!cursor) return { items: [], next_cursor: FIRST_CURSOR }
      return { items: [], next_cursor: FIRST_CURSOR }
    })
    persistBrowserNotificationPreference(boundaryUser, true)
    persistDesktopApprovalReminder(boundaryUser, true)

    renderCenter(boundaryUser)
    await vi.waitFor(() => expect(approvalSignals).toHaveLength(1))
    const firstSignal = approvalSignals[0]
    expect(firstSignal?.aborted).toBe(false)

    act(() => {
      beginLoginSession()
    })
    await vi.waitFor(() => expect(firstSignal?.aborted).toBe(true))
  })

  it("does not abort or duplicate an in-flight delivery on an identical refetch", async () => {
    const cadenceUser = "10000000-0000-4000-8000-00000000000a"
    let deliverySignal: AbortSignal | undefined
    let resolveShow: (() => void) | undefined
    native.showApprovalNotification.with.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        () => {
          deliverySignal = signal
          return new Promise<void>((resolve) => {
            resolveShow = resolve
          })
        }
    )
    installApprovalFeed([approvalItem()])
    persistBrowserNotificationPreference(cadenceUser, true)
    persistDesktopApprovalReminder(cadenceUser, true)

    vi.useFakeTimers()
    try {
      renderCenter(cadenceUser)
      await vi.waitFor(() => expect(deliverySignal).toBeDefined())
      expect(deliverySignal?.aborted).toBe(false)
      expect(native.showApprovalNotification.with).toHaveBeenCalledOnce()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      // The 5 s poll returned the same pending pair. Its new dataUpdatedAt
      // triggers another delivery pass, but the existing background session
      // keeps the first system call alive and does not start a duplicate.
      expect(deliverySignal?.aborted).toBe(false)
      expect(native.showApprovalNotification.with).toHaveBeenCalledOnce()
      expect(approvalRequestCalls()).toHaveLength(2)

      await act(async () => {
        resolveShow?.()
        await Promise.resolve()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(native.showApprovalNotification.with).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("never claims an expired reminder", async () => {
    installApprovalFeed([
      approvalItem({ expires_at: new Date(Date.now() - 1_000).toISOString() }),
    ])
    persistBrowserNotificationPreference(APPROVAL_USER_ID, true)
    persistDesktopApprovalReminder(APPROVAL_USER_ID, true)

    renderCenter(APPROVAL_USER_ID)

    await vi.waitFor(() =>
      expect(
        vi
          .mocked(apiRequest)
          .mock.calls.some(([path]) => path === APPROVAL_FEED_PATH)
      ).toBe(true)
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(native.showApprovalNotification).not.toHaveBeenCalled()
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(APPROVAL_USER_ID)
      ) ?? ""
    ).not.toContain(APPROVAL_REQUEST_ID)
  })

  it("does not claim a denied reminder and turns the master choice off", async () => {
    const deniedUser = "10000000-0000-4000-8000-000000000008"
    installApprovalFeed([approvalItem()])
    native.showApprovalNotification.mockRejectedValue(
      new Error("DESKTOP_NOTIFICATIONS_DENIED")
    )
    persistBrowserNotificationPreference(deniedUser, true)
    persistDesktopApprovalReminder(deniedUser, true)

    renderCenter(deniedUser)

    await vi.waitFor(() =>
      expect(readBrowserNotificationPreference(deniedUser)).toMatchObject({
        enabled: false,
        permission: "denied",
      })
    )
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(deniedUser)
      ) ?? ""
    ).not.toContain(APPROVAL_REQUEST_ID)
  })

  it("keeps completion delivery when an old API lacks the approval route", async () => {
    const oldApiUser = "10000000-0000-4000-8000-000000000002"
    const completion = {
      turn_id: TURN_ID,
      conversation_id: CONVERSATION_ID,
      source: "task",
      task_title: TASK_TITLE,
      status: "completed",
      terminal_at: "2026-08-09T10:00:01.000Z",
    }
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === APPROVAL_FEED_PATH) {
        throw new ApiError({
          status: 404,
          errorCode: "NOT_FOUND",
          message: "Not found",
        })
      }
      const cursor = options.query?.cursor
      if (!cursor) return { items: [], next_cursor: FIRST_CURSOR }
      if (cursor === FIRST_CURSOR) {
        return {
          items: [completion],
          next_cursor: `2026-08-09T10:00:01.000Z|${TURN_ID}`,
        }
      }
      return { items: [], next_cursor: `2026-08-09T10:00:01.000Z|${TURN_ID}` }
    })
    persistBrowserNotificationPreference(oldApiUser, true)
    persistDesktopApprovalReminder(oldApiUser, true)

    const first = renderCenter(oldApiUser)

    await vi.waitFor(() =>
      expect(native.showCompletionNotification).toHaveBeenCalledOnce()
    )
    expect(native.showApprovalNotification).not.toHaveBeenCalled()
    const approvalCalls = () =>
      vi
        .mocked(apiRequest)
        .mock.calls.filter(([path]) => path === APPROVAL_FEED_PATH)
    expect(approvalCalls()).toHaveLength(1)

    // The settled missing route is not asked again by a later mount in the
    // same app session.
    first.unmount()
    renderCenter(oldApiUser)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(approvalCalls()).toHaveLength(1)
  })

  it("settles the old UUID-route 400 per login while completion still works", async () => {
    const oldApi400User = "10000000-0000-4000-8000-000000000005"
    const completion = {
      turn_id: TURN_ID,
      conversation_id: CONVERSATION_ID,
      source: "task",
      task_title: TASK_TITLE,
      status: "completed",
      terminal_at: "2026-08-09T10:00:01.000Z",
    }
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === APPROVAL_FEED_PATH) {
        throw new ApiError({
          status: 400,
          errorCode: "VALIDATION_ERROR",
          message: "Invalid request",
        })
      }
      const cursor = options.query?.cursor
      if (!cursor) return { items: [], next_cursor: FIRST_CURSOR }
      if (cursor === FIRST_CURSOR) {
        return {
          items: [completion],
          next_cursor: `2026-08-09T10:00:01.000Z|${TURN_ID}`,
        }
      }
      return { items: [], next_cursor: `2026-08-09T10:00:01.000Z|${TURN_ID}` }
    })
    persistBrowserNotificationPreference(oldApi400User, true)
    persistDesktopApprovalReminder(oldApi400User, true)

    const first = renderCenter(oldApi400User)

    await vi.waitFor(() =>
      expect(native.showCompletionNotification).toHaveBeenCalledOnce()
    )
    expect(native.showApprovalNotification).not.toHaveBeenCalled()
    expect(approvalRequestCalls()).toHaveLength(1)

    // Toggling approval off and back on does not re-ask on the same login.
    first.unmount()
    persistDesktopApprovalReminder(oldApi400User, false)
    persistDesktopApprovalReminder(oldApi400User, true)
    const second = renderCenter(oldApi400User)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(approvalRequestCalls()).toHaveLength(1)

    // An explicit login replacement may ask a possibly upgraded server again.
    second.unmount()
    act(() => {
      beginLoginSession("sign-in")
    })
    renderCenter(oldApi400User)
    await vi.waitFor(() => expect(approvalRequestCalls()).toHaveLength(2))
  })

  it("keeps retrying an arbitrary 400 instead of treating it as an old server", async () => {
    const invalidUser = "10000000-0000-4000-8000-000000000007"
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === APPROVAL_FEED_PATH) {
        throw new ApiError({
          status: 400,
          errorCode: "INVALID_REQUEST",
          message: "Invalid request",
        })
      }
      const cursor = options.query?.cursor
      if (!cursor) return { items: [], next_cursor: FIRST_CURSOR }
      return { items: [], next_cursor: FIRST_CURSOR }
    })
    persistBrowserNotificationPreference(invalidUser, true)
    persistDesktopApprovalReminder(invalidUser, true)

    const first = renderCenter(invalidUser)

    await vi.waitFor(() => expect(approvalRequestCalls()).toHaveLength(1))
    first.unmount()
    renderCenter(invalidUser)
    await vi.waitFor(() => expect(approvalRequestCalls()).toHaveLength(2))
  })

  it("stops asking when the native approval method is not bound", async () => {
    const oldHostUser = "10000000-0000-4000-8000-000000000003"
    installApprovalFeed([approvalItem()])
    native.showApprovalNotification.with.mockReturnValue(() =>
      Promise.reject(
        new Error("method Desktop.ShowApprovalNotification is not bound")
      )
    )
    persistBrowserNotificationPreference(oldHostUser, true)
    persistDesktopApprovalReminder(oldHostUser, true)

    const first = renderCenter(oldHostUser)

    await vi.waitFor(() =>
      expect(native.showApprovalNotification.with).toHaveBeenCalledOnce()
    )
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(oldHostUser)
      ) ?? ""
    ).not.toContain(APPROVAL_REQUEST_ID)

    first.unmount()
    renderCenter(oldHostUser)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(native.showApprovalNotification.with).toHaveBeenCalledOnce()
  })
})

function ApprovalClickVerifierProbe() {
  useDesktopApprovalNotificationClickVerifier()
  return null
}

const verifierRouteBootstrap = bootstrapSchema.parse({ initialized: true })
type VerifierRouteSession = {
  status: Extract<AuthContextValue["status"], "anonymous" | "authenticated">
  userId?: string
}

function verifierRouteUser(session: VerifierRouteSession) {
  return session.status === "authenticated"
    ? userSchema.parse({ ...user, id: session.userId ?? APPROVAL_USER_ID })
    : null
}

// The real auth/bootstrap gate, protected scope, and launch navigation, with
// the production verifier hook at the same level as the app root.
function renderVerifierRoutes(
  initialPath: string,
  initialSession: VerifierRouteSession
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createMemoryRouter(
    [
      {
        element: <BootstrapGate />,
        children: [
          {
            element: <PublicAuthRoute />,
            children: [{ path: "/login", element: <p>Sign in</p> }],
          },
          {
            element: <ProtectedRoute />,
            children: [
              { path: "/conversations/new", element: <p>New task</p> },
              {
                path: "/conversations/:conversationId",
                element: <p>Approval conversation</p>,
              },
              { path: "/settings/general", element: <p>Settings</p> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [initialPath] }
  )
  const tree = (session: VerifierRouteSession) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <BootstrapContext.Provider
          value={{
            bootstrap: verifierRouteBootstrap,
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          }}
        >
          <AuthContext.Provider
            value={{
              status: session.status,
              user: verifierRouteUser(session),
              acceptSession: vi.fn(),
              refreshUser: vi.fn(),
              signOut: vi.fn(),
            }}
          >
            <ApprovalClickVerifierProbe />
            <RouterProvider router={router} />
          </AuthContext.Provider>
        </BootstrapContext.Provider>
      </QueryClientProvider>
    </I18nextProvider>
  )
  const view = render(tree(initialSession))
  return {
    router,
    update: (session: VerifierRouteSession) => view.rerender(tree(session)),
  }
}

describe("Desktop approval click verifier on macOS", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    vi.clearAllMocks()
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    native.notificationsSupported.mockResolvedValue(true)
    await initializeDesktopHost()
    await i18n.changeLanguage("en-US")
  })

  afterEach(() => {
    cleanup()
    cancelPendingApprovalNotificationClick()
    updateDesktopLaunchContext({
      authenticated: false,
      ownerId: null,
      ready: false,
      pathname: "/conversations/new",
      hash: "",
    })
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it("reads the exact pair and rejects a live item after the login changes while awaiting", async () => {
    const startBoundary = getLoginSessionBoundary()
    const pairCalls: Array<{
      query: Record<string, string | number | boolean | null | undefined>
      loginSessionBoundary: number | undefined
    }> = []
    let resolvePair: (() => void) | undefined
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path !== APPROVAL_FEED_PATH || !options.query) {
        throw new Error("unexpected approval request")
      }
      pairCalls.push({
        query: options.query,
        loginSessionBoundary: options.loginSessionBoundary,
      })
      return await new Promise((resolve) => {
        resolvePair = () => {
          beginLoginSession("sign-in")
          resolve({ items: [approvalItem()] })
        }
      })
    })

    const navigate = vi.fn()
    const stopLaunch = subscribeDesktopLaunchNavigation(navigate)
    const stopScope = scopeDesktopNotificationNavigation(
      APPROVAL_USER_ID,
      "/conversations/new"
    )
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: APPROVAL_USER_ID,
      ready: true,
      pathname: "/conversations/new",
      hash: "",
    })
    render(
      <AuthContext.Provider
        value={{
          status: "authenticated",
          user: userSchema.parse({ ...user, id: APPROVAL_USER_ID }),
          acceptSession: vi.fn(),
          refreshUser: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <ApprovalClickVerifierProbe />
      </AuthContext.Provider>
    )

    act(() =>
      emitNotificationClick({
        userId: APPROVAL_USER_ID,
        conversationId: CONVERSATION_ID,
        requestId: APPROVAL_REQUEST_ID,
      })
    )
    await vi.waitFor(() => expect(pairCalls).toHaveLength(1))
    expect(vi.mocked(apiRequest).mock.calls[0]?.[0]).toBe(APPROVAL_FEED_PATH)
    expect(pairCalls[0]?.query).toEqual({
      conversation_id: CONVERSATION_ID,
      request_id: APPROVAL_REQUEST_ID,
    })
    expect(pairCalls[0]?.loginSessionBoundary).toBe(startBoundary)

    // The GET answers with the exact live pair, but a replacement login landed
    // first. The post-await fence must discard it instead of navigating.
    resolvePair?.()
    await act(async () => {
      await Promise.resolve()
    })
    expect(navigate).not.toHaveBeenCalled()
    stopScope?.()
    stopLaunch?.()
  })

  it("keeps an anonymous approval click through the first matched sign-in", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [approvalItem()] })
    const { router, update } = renderVerifierRoutes("/login", {
      status: "anonymous",
    })

    act(() =>
      emitNotificationClick({
        userId: APPROVAL_USER_ID,
        conversationId: CONVERSATION_ID,
        requestId: APPROVAL_REQUEST_ID,
      })
    )
    expect(approvalRequestCalls()).toHaveLength(0)

    // Sign-in advances the login boundary before the protected surface is
    // ready. The click belongs to this owner, so it stays buffered.
    act(() => {
      beginLoginSession("sign-in")
    })
    update({ status: "authenticated", userId: APPROVAL_USER_ID })

    await vi.waitFor(() => expect(approvalRequestCalls()).toHaveLength(1))
    expect(approvalRequestCalls()[0]?.[1]?.query).toEqual({
      conversation_id: CONVERSATION_ID,
      request_id: APPROVAL_REQUEST_ID,
    })
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/conversations/${CONVERSATION_ID}`
      )
    )
  })

  it("does not let a different owner consume an anonymous approval click", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [approvalItem()] })
    const otherOwner = "10000000-0000-4000-8000-000000000005"
    const { router, update } = renderVerifierRoutes("/login", {
      status: "anonymous",
    })

    act(() =>
      emitNotificationClick({
        userId: APPROVAL_USER_ID,
        conversationId: CONVERSATION_ID,
        requestId: APPROVAL_REQUEST_ID,
      })
    )
    act(() => {
      beginLoginSession("sign-in")
    })
    update({ status: "authenticated", userId: otherOwner })

    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe("/conversations/new")
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(approvalRequestCalls()).toHaveLength(0)
    expect(router.state.location.pathname).toBe("/conversations/new")
  })

  it("cancels a buffered approval click on a same-id replacement before its check starts", async () => {
    const navigate = vi.fn()
    const stopLaunch = subscribeDesktopLaunchNavigation(navigate)
    render(
      <AuthContext.Provider
        value={{
          status: "authenticated",
          user: userSchema.parse({ ...user, id: APPROVAL_USER_ID }),
          acceptSession: vi.fn(),
          refreshUser: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <ApprovalClickVerifierProbe />
      </AuthContext.Provider>
    )

    // No protected scope or ready launch context yet, so the click cannot be
    // checked when the same owner signs in again.
    act(() =>
      emitNotificationClick({
        userId: APPROVAL_USER_ID,
        conversationId: CONVERSATION_ID,
        requestId: APPROVAL_REQUEST_ID,
      })
    )
    act(() => {
      beginLoginSession("sign-in")
    })

    const stopScope = scopeDesktopNotificationNavigation(
      APPROVAL_USER_ID,
      "/conversations/new"
    )
    updateDesktopLaunchContext({
      authenticated: true,
      ownerId: APPROVAL_USER_ID,
      ready: true,
      pathname: "/conversations/new",
      hash: "",
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(approvalRequestCalls()).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
    stopScope?.()
    stopLaunch?.()
  })

  it("cancels a buffered anonymous approval click when sign-in is abandoned", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [approvalItem()] })
    const { router, update } = renderVerifierRoutes("/login", {
      status: "anonymous",
    })

    act(() =>
      emitNotificationClick({
        userId: APPROVAL_USER_ID,
        conversationId: CONVERSATION_ID,
        requestId: APPROVAL_REQUEST_ID,
      })
    )
    // The desktop sign-in Cancel path calls signOut while still anonymous.
    act(() => {
      beginLoginSession("sign-out")
    })
    update({ status: "authenticated", userId: APPROVAL_USER_ID })

    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe("/conversations/new")
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(approvalRequestCalls()).toHaveLength(0)
    expect(router.state.location.pathname).toBe("/conversations/new")
  })

  it.each([
    {
      intent: "query",
      target: "/conversations/new?tab=manual",
      location: (router: ReturnType<typeof createMemoryRouter>) =>
        router.state.location.search,
      expected: "?tab=manual",
    },
    {
      intent: "hash",
      target: "/conversations/new#manual",
      location: (router: ReturnType<typeof createMemoryRouter>) =>
        router.state.location.hash,
      expected: "#manual",
    },
  ])(
    "does not route a deferred approval check over a newer $intent navigation",
    async ({ target, location, expected }) => {
      let resolvePair: (() => void) | undefined
      vi.mocked(apiRequest).mockImplementation(async (path) => {
        if (path !== APPROVAL_FEED_PATH) throw new Error("unexpected request")
        return await new Promise((resolve) => {
          resolvePair = () => resolve({ items: [approvalItem()] })
        })
      })
      const { router } = renderVerifierRoutes("/conversations/new", {
        status: "authenticated",
        userId: APPROVAL_USER_ID,
      })

      act(() =>
        emitNotificationClick({
          userId: APPROVAL_USER_ID,
          conversationId: CONVERSATION_ID,
          requestId: APPROVAL_REQUEST_ID,
        })
      )
      await vi.waitFor(() => expect(approvalRequestCalls()).toHaveLength(1))

      // A real router transition, not a direct launch-context update.
      await act(async () => {
        await router.navigate(target)
      })
      expect(location(router)).toBe(expected)

      await act(async () => {
        resolvePair?.()
        await Promise.resolve()
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(router.state.location.pathname).toBe("/conversations/new")
      expect(location(router)).toBe(expected)
      expect(approvalRequestCalls()).toHaveLength(1)
    }
  )
})
