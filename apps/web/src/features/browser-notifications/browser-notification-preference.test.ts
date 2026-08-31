import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  browserNotificationDeliveryStorageKey,
  browserNotificationStorageKey,
  claimBrowserNotificationDelivery,
  disableBrowserNotifications,
  persistBrowserNotificationPreference,
  readBrowserNotificationPreference,
  requestBrowserNotificationPermission,
  showBrowserNotification,
} from "@/features/browser-notifications/browser-notification-preference"

type TestNotificationInstance = {
  title: string
  options: NotificationOptions | undefined
  onclick: (() => void) | null
  onerror: ((event: Event) => void) | null
  onshow: ((event: Event) => void) | null
  close: ReturnType<typeof vi.fn>
}

function installNotificationApi(options: {
  permission: NotificationPermission
  requestResult?: NotificationPermission
  constructorError?: Error
  displayError?: boolean
}) {
  let permission = options.permission
  const instances: TestNotificationInstance[] = []
  const requestPermission = vi.fn(async () => {
    permission = options.requestResult ?? permission
    return permission
  })

  class TestNotification {
    static get permission() {
      return permission
    }

    static requestPermission = requestPermission

    title: string
    options: NotificationOptions | undefined
    onclick: (() => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onshow: ((event: Event) => void) | null = null
    close = vi.fn()

    constructor(title: string, notificationOptions?: NotificationOptions) {
      if (options.constructorError) throw options.constructorError
      this.title = title
      this.options = notificationOptions
      instances.push(this)
      queueMicrotask(() => {
        if (options.displayError) this.onerror?.(new Event("error"))
        else this.onshow?.(new Event("show"))
      })
    }
  }

  vi.stubGlobal(
    "Notification",
    TestNotification as unknown as typeof Notification
  )

  return { instances, requestPermission }
}

describe("browser notification preferences", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it("defaults to disabled and isolates the preference by user", () => {
    installNotificationApi({ permission: "granted" })

    expect(readBrowserNotificationPreference("user-a")).toEqual({
      enabled: false,
      effectiveEnabled: false,
      permission: "granted",
      supported: true,
    })

    persistBrowserNotificationPreference("user-a", true)

    expect(readBrowserNotificationPreference("user-a")).toMatchObject({
      enabled: true,
      effectiveEnabled: true,
    })
    expect(readBrowserNotificationPreference("user-b")).toMatchObject({
      enabled: false,
      effectiveEnabled: false,
    })
    expect(
      window.localStorage.getItem(browserNotificationStorageKey("user-a"))
    ).toBe("true")
    expect(
      window.localStorage.getItem(browserNotificationStorageKey("user-b"))
    ).toBeNull()
  })

  it("requests permission without persisting before delivery is verified", async () => {
    const notificationApi = installNotificationApi({
      permission: "default",
      requestResult: "granted",
    })

    await expect(requestBrowserNotificationPermission()).resolves.toBe(
      "granted"
    )
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1)
    expect(readBrowserNotificationPreference("user-a")).toMatchObject({
      enabled: false,
      effectiveEnabled: false,
      permission: "granted",
    })

    await expect(requestBrowserNotificationPermission()).resolves.toBe(
      "granted"
    )
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1)
  })

  it("does not enable the preference when permission is denied", async () => {
    const notificationApi = installNotificationApi({
      permission: "default",
      requestResult: "denied",
    })

    await expect(requestBrowserNotificationPermission()).resolves.toBe("denied")
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1)
    expect(readBrowserNotificationPreference("user-a")).toMatchObject({
      enabled: false,
      effectiveEnabled: false,
      permission: "denied",
    })
    expect(
      window.localStorage.getItem(browserNotificationStorageKey("user-a"))
    ).toBeNull()
  })

  it("fails closed when the enabled preference cannot be persisted", () => {
    installNotificationApi({ permission: "granted" })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError")
    })

    expect(
      persistBrowserNotificationPreference("storage-failure-user", true)
    ).toBe(false)
    expect(
      readBrowserNotificationPreference("storage-failure-user")
    ).toMatchObject({
      enabled: false,
      effectiveEnabled: false,
      permission: "granted",
    })
  })

  it("fails closed when storage silently drops the enabled preference", () => {
    installNotificationApi({ permission: "granted" })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => undefined)

    expect(
      persistBrowserNotificationPreference("silent-storage-user", true)
    ).toBe(false)
    expect(
      readBrowserNotificationPreference("silent-storage-user")
    ).toMatchObject({
      enabled: false,
      effectiveEnabled: false,
      permission: "granted",
    })
  })

  it("disables locally without requesting browser permission again", () => {
    const notificationApi = installNotificationApi({ permission: "default" })
    persistBrowserNotificationPreference("user-a", true)

    disableBrowserNotifications("user-a")

    expect(notificationApi.requestPermission).not.toHaveBeenCalled()
    expect(readBrowserNotificationPreference("user-a")).toMatchObject({
      enabled: false,
      effectiveEnabled: false,
    })
    expect(
      window.localStorage.getItem(browserNotificationStorageKey("user-a"))
    ).toBe("false")
  })

  it("removes a stale enabled preference when writing false fails", () => {
    installNotificationApi({ permission: "granted" })
    window.localStorage.setItem(
      browserNotificationStorageKey("remove-fallback-user"),
      "true"
    )
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError")
    })

    expect(disableBrowserNotifications("remove-fallback-user")).toBe(true)
    expect(
      window.localStorage.getItem(
        browserNotificationStorageKey("remove-fallback-user")
      )
    ).toBeNull()
    expect(
      readBrowserNotificationPreference("remove-fallback-user")
    ).toMatchObject({ enabled: false, effectiveEnabled: false })
  })

  it("focuses the window, invokes the callback, and closes on notification click", async () => {
    const notificationApi = installNotificationApi({ permission: "granted" })
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined)
    const onClick = vi.fn()

    const notification = await showBrowserNotification({
      title: "LinkSense",
      body: "Task completed",
      tag: "task:turn-a",
      onClick,
    })

    expect(notification).not.toBeNull()
    expect(notificationApi.instances).toHaveLength(1)
    expect(notificationApi.instances[0]).toMatchObject({
      title: "LinkSense",
      options: {
        body: "Task completed",
        icon: "/linksense-appicon.svg",
        tag: "task:turn-a",
      },
    })

    notificationApi.instances[0]?.onclick?.()

    expect(focus).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(notificationApi.instances[0]?.close).toHaveBeenCalledTimes(1)
  })

  it("returns null instead of throwing when notification construction fails", async () => {
    installNotificationApi({
      permission: "granted",
      constructorError: new TypeError("notifications unavailable"),
    })
    await expect(
      showBrowserNotification({
        title: "LinkSense",
        body: "Task completed",
        tag: "task:turn-a",
        onClick: vi.fn(),
      })
    ).resolves.toBeNull()
  })

  it("returns null and closes when the browser reports an asynchronous display error", async () => {
    const notificationApi = installNotificationApi({
      permission: "granted",
      displayError: true,
    })

    await expect(
      showBrowserNotification({
        title: "LinkSense",
        body: "Task completed",
        tag: "task:turn-a",
        onClick: vi.fn(),
      })
    ).resolves.toBeNull()
    expect(notificationApi.instances[0]?.close).toHaveBeenCalledTimes(1)
  })

  it("claims each delivery once per user", () => {
    expect(claimBrowserNotificationDelivery("user-a", "turn-a")).toBe(true)
    expect(claimBrowserNotificationDelivery("user-a", "turn-a")).toBe(false)
    expect(claimBrowserNotificationDelivery("user-a", "turn-b")).toBe(true)
    expect(claimBrowserNotificationDelivery("user-b", "turn-a")).toBe(true)

    expect(
      JSON.parse(
        window.localStorage.getItem(
          browserNotificationDeliveryStorageKey("user-a")
        ) ?? "[]"
      )
    ).toEqual(["turn-a", "turn-b"])
  })
})
