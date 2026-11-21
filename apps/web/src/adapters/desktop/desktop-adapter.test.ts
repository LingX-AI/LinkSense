import { afterEach, describe, expect, it, vi } from "vitest"

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
  },
  events: {
    desktopNavigate: { on: native.onNavigate },
    desktopNotificationClick: { on: native.onNotificationClick },
  },
}))

import {
  cleanupDesktopWorkspaces,
  desktopNotificationRouteForUser,
  getDesktopPlatform,
  getDesktopServerUrl,
  hostFetch,
  initializeDesktopHost,
  openDesktopExternal,
  readDesktopWorkspaceNotice,
  readDesktopWorkspaceUsage,
  showDesktopCompletionNotification,
  showDesktopTestNotification,
  subscribeDesktopNavigation,
  subscribeDesktopNotificationClick,
  supportsNativeDesktopNotifications,
} from "./desktop-adapter"

let emitNotificationClick: (value: unknown) => void = () => undefined
native.onNotificationClick.mockImplementation(
  (callback: (value: unknown) => void) => {
    emitNotificationClick = callback
    return vi.fn()
  }
)

describe("desktop host boundary", () => {
  afterEach(() => {
    native.isDesktop = false
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.desktopPlatform
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
        callback("https://outside.example.test")
        callback({ path: "/settings/general" })
        callback("/settings/general")
        return unsubscribe
      }
    )
    expect(subscribeDesktopNavigation(navigate)).toBeUndefined()
    expect(navigate).not.toHaveBeenCalled()

    native.isDesktop = true
    expect(subscribeDesktopNavigation(navigate)).toBe(unsubscribe)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith("/settings/general")
  })

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
