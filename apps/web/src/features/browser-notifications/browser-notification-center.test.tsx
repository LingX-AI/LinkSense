import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { apiRequest } from "@/api/client"
import { userSchema } from "@/api/contracts"
import { AuthContext } from "@/app/auth-state"
import { BrowserNotificationCenter } from "@/features/browser-notifications/browser-notification-center"
import {
  browserNotificationDeliveryStorageKey,
  clearBrowserNotificationFeedCursor,
  persistBrowserNotificationPreference,
} from "@/features/browser-notifications/browser-notification-preference"
import i18n from "@/i18n"

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))
vi.mock("@/app/product-branding", () => ({
  useProductName: () => "LinkSense",
}))

const USER_ID = "10000000-0000-4000-8000-000000000001"
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const TURN_ID = "30000000-0000-4000-8000-000000000001"
const FIRST_CURSOR =
  "2026-08-09T10:00:00.000Z|00000000-0000-4000-8000-000000000000"
const NEXT_CURSOR = `2026-08-09T10:00:01.000Z|${TURN_ID}`
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

type TestNotificationInstance = {
  title: string
  options: NotificationOptions | undefined
  onclick: (() => void) | null
  onerror: ((event: Event) => void) | null
  onshow: ((event: Event) => void) | null
  close: ReturnType<typeof vi.fn>
}

function installNotificationApi(
  failConstructionCount = 0,
  failDisplayCount = 0
) {
  const instances: TestNotificationInstance[] = []
  let remainingConstructionFailures = failConstructionCount
  let remainingDisplayFailures = failDisplayCount
  class TestNotification {
    static permission: NotificationPermission = "granted"
    static requestPermission = vi.fn(async () => "granted" as const)
    title: string
    options: NotificationOptions | undefined
    onclick: (() => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onshow: ((event: Event) => void) | null = null
    close = vi.fn()

    constructor(title: string, options?: NotificationOptions) {
      if (remainingConstructionFailures > 0) {
        remainingConstructionFailures -= 1
        throw new TypeError("notification unavailable")
      }
      this.title = title
      this.options = options
      instances.push(this)
      queueMicrotask(() => {
        if (remainingDisplayFailures > 0) {
          remainingDisplayFailures -= 1
          this.onerror?.(new Event("error"))
        } else {
          this.onshow?.(new Event("show"))
        }
      })
    }
  }
  vi.stubGlobal(
    "Notification",
    TestNotification as unknown as typeof Notification
  )
  return instances
}

function renderCenter(initialEntry = "/conversations/new") {
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
          <MemoryRouter initialEntries={[initialEntry]}>
            <BrowserNotificationCenter />
            <Routes>
              <Route
                path="/conversations/:id"
                element={<div>Conversation opened</div>}
              />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function installCompletionFeed(
  source: "task" | "automation" = "task",
  turnId = TURN_ID,
  status: "completed" | "failed" | "interrupted" = "completed",
  taskTitle = "季度经营分析"
) {
  vi.mocked(apiRequest).mockImplementation(async (_path, options) => {
    const cursor = options.query?.cursor
    if (!cursor) return { items: [], next_cursor: FIRST_CURSOR }
    if (cursor === FIRST_CURSOR) {
      const item = {
        turn_id: turnId,
        conversation_id: CONVERSATION_ID,
        source,
        task_title: taskTitle,
        status,
        terminal_at: "2026-08-09T10:00:01.000Z",
      }
      return { items: [item, item], next_cursor: NEXT_CURSOR }
    }
    return { items: [], next_cursor: NEXT_CURSOR }
  })
}

function setDocumentActivity(
  visibilityState: DocumentVisibilityState,
  focused: boolean
) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  })
  vi.spyOn(document, "hasFocus").mockReturnValue(focused)
}

describe("BrowserNotificationCenter", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    clearBrowserNotificationFeedCursor(USER_ID)
    vi.clearAllMocks()
    setDocumentActivity("hidden", false)
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, "visibilityState")
    window.localStorage.clear()
  })

  it("baselines first, notifies a completion once, and opens its task", async () => {
    const instances = installNotificationApi()
    installCompletionFeed("task")
    persistBrowserNotificationPreference(USER_ID, true)
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined)
    setDocumentActivity("hidden", true)

    renderCenter()

    await waitFor(() => expect(instances).toHaveLength(1))
    expect(instances[0]).toMatchObject({
      title: "LinkSense · 季度经营分析",
      options: {
        body: "处理成功",
        tag: `${USER_ID}:task:${TURN_ID}`,
      },
    })
    expect(vi.mocked(apiRequest).mock.calls[0]?.[1].query).toEqual({
      limit: 100,
    })

    instances[0]?.onclick?.()

    expect(focus).toHaveBeenCalledTimes(1)
    expect(instances[0]?.close).toHaveBeenCalledTimes(1)
    expect(await screen.findByText("Conversation opened")).toBeVisible()
  })

  it("does not notify when LinkSense is visible and focused", async () => {
    const instances = installNotificationApi()
    installCompletionFeed("automation", TURN_ID, "failed", "每日经营日报")
    persistBrowserNotificationPreference(USER_ID, true)
    setDocumentActivity("visible", true)

    renderCenter(`/conversations/${CONVERSATION_ID}`)

    await waitFor(() =>
      expect(
        window.localStorage.getItem(
          browserNotificationDeliveryStorageKey(USER_ID)
        )
      ).toContain(`automation:${TURN_ID}`)
    )
    expect(instances).toHaveLength(0)
  })

  it("notifies when LinkSense is visible but the browser is not focused", async () => {
    const unfocusedTurnId = "30000000-0000-4000-8000-000000000005"
    const instances = installNotificationApi()
    installCompletionFeed(
      "automation",
      unfocusedTurnId,
      "failed",
      "每日经营日报"
    )
    persistBrowserNotificationPreference(USER_ID, true)
    setDocumentActivity("visible", false)

    renderCenter(`/conversations/${CONVERSATION_ID}`)

    await waitFor(() => expect(instances).toHaveLength(1))
    expect(instances[0]).toMatchObject({
      title: "LinkSense · 每日经营日报",
      options: {
        body: "处理失败",
        tag: `${USER_ID}:automation:${unfocusedTurnId}`,
      },
    })
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(USER_ID)
      )
    ).toContain(`automation:${unfocusedTurnId}`)
  })

  it("does not mark a failed notification construction as delivered", async () => {
    const retryTurnId = "30000000-0000-4000-8000-000000000009"
    const instances = installNotificationApi(1)
    installCompletionFeed("task", retryTurnId)
    persistBrowserNotificationPreference(USER_ID, true)

    renderCenter()

    await waitFor(() => expect(instances).toHaveLength(1))
    expect(instances[0]?.title).toBe("LinkSense · 季度经营分析")
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(USER_ID)
      )
    ).toContain(`task:${retryTurnId}`)
  })

  it("falls back to delivery when the Web Locks request fails", async () => {
    const locksFallbackTurnId = "30000000-0000-4000-8000-000000000008"
    const instances = installNotificationApi()
    const request = vi.fn().mockRejectedValue(new Error("locks unavailable"))
    vi.stubGlobal("navigator", {
      locks: { request },
    })
    installCompletionFeed("task", locksFallbackTurnId)
    persistBrowserNotificationPreference(USER_ID, true)

    renderCenter()

    await waitFor(() => expect(instances).toHaveLength(1))
    expect(request).toHaveBeenCalled()
    expect(instances[0]?.title).toBe("LinkSense · 季度经营分析")
  })

  it("localizes an interrupted task status in English", async () => {
    await i18n.changeLanguage("en-US")
    const interruptedTurnId = "30000000-0000-4000-8000-000000000006"
    const instances = installNotificationApi()
    installCompletionFeed(
      "task",
      interruptedTurnId,
      "interrupted",
      "Quarterly review"
    )
    persistBrowserNotificationPreference(USER_ID, true)

    renderCenter()

    await waitFor(() => expect(instances).toHaveLength(1))
    expect(instances[0]).toMatchObject({
      title: "LinkSense · Quarterly review",
      options: {
        body: "Processing interrupted",
      },
    })
  })

  it("does not claim an asynchronous display failure and retries the duplicate item", async () => {
    const displayRetryTurnId = "30000000-0000-4000-8000-000000000007"
    const instances = installNotificationApi(0, 1)
    installCompletionFeed("task", displayRetryTurnId)
    persistBrowserNotificationPreference(USER_ID, true)

    renderCenter()

    await waitFor(() => expect(instances).toHaveLength(2))
    expect(instances[0]?.close).toHaveBeenCalledTimes(1)
    expect(
      window.localStorage.getItem(
        browserNotificationDeliveryStorageKey(USER_ID)
      )
    ).toContain(`task:${displayRetryTurnId}`)
  })
})
