import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"

import { apiRequest } from "@/api/client"
import { userSchema } from "@/api/contracts"
import { AuthContext } from "@/app/auth-state"
import { initializeDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { BrowserNotificationCenter } from "@/features/browser-notifications/browser-notification-center"
import {
  browserNotificationDeliveryStorageKey,
  clearBrowserNotificationFeedCursor,
  disableBrowserNotifications,
  persistBrowserNotificationPreference,
  readBrowserNotificationPreference,
} from "@/features/browser-notifications/browser-notification-preference"
import i18n from "@/i18n"

const native = vi.hoisted(() => ({
  info: vi.fn(),
  notificationsSupported: vi.fn(),
  showCompletionNotification: Object.assign(vi.fn(), { with: vi.fn() }),
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
    showTestNotification: native.showTestNotification,
  },
  events: {
    desktopNotificationClick: { on: native.onNotificationClick },
    desktopNavigate: { on: vi.fn() },
  },
}))
vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))

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

function renderCenter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            status: "authenticated",
            user,
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
