export const BROWSER_NOTIFICATION_STORAGE_KEY_PREFIX =
  "linksense.browserNotifications.enabled"
export const BROWSER_NOTIFICATION_DELIVERY_STORAGE_KEY_PREFIX =
  "linksense.browserNotifications.delivered"
export const BROWSER_NOTIFICATION_DELIVERY_HISTORY_LIMIT = 5_000
export const BROWSER_NOTIFICATION_DISPLAY_CONFIRMATION_TIMEOUT_MS = 500

const BROWSER_NOTIFICATION_PREFERENCE_CHANGED_EVENT =
  "linksense:browser-notification-preference-changed"
const transientDisabledPreferences = new Set<string>()
const transientDeliveryHistory = new Map<string, string[]>()
const transientFeedCursors = new Map<string, string>()

export type BrowserNotificationPermission =
  NotificationPermission | "unsupported"

export type BrowserNotificationEnableResult =
  NotificationPermission | "unsupported" | "error"

export type BrowserNotificationPreference = Readonly<{
  enabled: boolean
  effectiveEnabled: boolean
  permission: BrowserNotificationPermission
  supported: boolean
}>

export function browserNotificationStorageKey(userId: string) {
  return `${BROWSER_NOTIFICATION_STORAGE_KEY_PREFIX}:${userId}`
}

export function browserNotificationDeliveryStorageKey(userId: string) {
  return `${BROWSER_NOTIFICATION_DELIVERY_STORAGE_KEY_PREFIX}:${userId}`
}

function resolveNotificationApi(): typeof Notification | null {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return null
  }
  return typeof globalThis.Notification === "function"
    ? globalThis.Notification
    : null
}

function resolveLocalStorage(): Storage | null {
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function readEnabled(userId: string): boolean {
  if (transientDisabledPreferences.has(userId)) return false
  try {
    const stored = resolveLocalStorage()?.getItem(
      browserNotificationStorageKey(userId)
    )
    if (stored === "true") return true
    if (stored === "false") return false
  } catch {
    return false
  }
  return false
}

export function readBrowserNotificationPreference(
  userId: string
): BrowserNotificationPreference {
  const notificationApi = resolveNotificationApi()
  const permission = notificationApi?.permission ?? "unsupported"
  const enabled = readEnabled(userId)

  return {
    enabled,
    effectiveEnabled: enabled && permission === "granted",
    permission,
    supported: notificationApi !== null,
  }
}

function dispatchPreferenceChanged(userId: string) {
  window.dispatchEvent(
    new CustomEvent(BROWSER_NOTIFICATION_PREFERENCE_CHANGED_EVENT, {
      detail: { userId },
    })
  )
}

export function persistBrowserNotificationPreference(
  userId: string,
  enabled: boolean
): boolean {
  const storageKey = browserNotificationStorageKey(userId)
  const storage = resolveLocalStorage()
  try {
    if (!storage) throw new Error("browser notification storage unavailable")
    storage.setItem(storageKey, String(enabled))
    if (storage.getItem(storageKey) !== String(enabled)) {
      throw new Error("browser notification preference was not persisted")
    }
    transientDisabledPreferences.delete(userId)
  } catch {
    const removed = removeBrowserNotificationPreference(storage, storageKey)
    if (!enabled && removed) {
      transientDisabledPreferences.delete(userId)
      dispatchPreferenceChanged(userId)
      return true
    }
    transientDisabledPreferences.add(userId)
    dispatchPreferenceChanged(userId)
    return false
  }
  dispatchPreferenceChanged(userId)
  return true
}

function removeBrowserNotificationPreference(
  storage: Storage | null,
  storageKey: string
): boolean {
  if (!storage) return false
  try {
    storage.removeItem(storageKey)
    return storage.getItem(storageKey) === null
  } catch {
    return false
  }
}

export function disableBrowserNotifications(userId: string) {
  transientFeedCursors.delete(userId)
  return persistBrowserNotificationPreference(userId, false)
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationEnableResult> {
  const notificationApi = resolveNotificationApi()
  if (!notificationApi) return "unsupported"
  if (notificationApi.permission === "denied") return "denied"

  try {
    const permission =
      notificationApi.permission === "granted"
        ? "granted"
        : await notificationApi.requestPermission()
    return permission
  } catch {
    return "error"
  }
}

export function readBrowserNotificationFeedCursor(userId: string) {
  return transientFeedCursors.get(userId) ?? null
}

export function saveBrowserNotificationFeedCursor(
  userId: string,
  cursor: string
) {
  transientFeedCursors.set(userId, cursor)
}

export function clearBrowserNotificationFeedCursor(userId: string) {
  transientFeedCursors.delete(userId)
}

export function subscribeBrowserNotificationPreference(
  userId: string,
  onChange: () => void
) {
  const handlePreferenceChanged = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as { userId?: unknown } | undefined
    if (detail?.userId === userId) onChange()
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === browserNotificationStorageKey(userId)) onChange()
  }
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") onChange()
  }

  window.addEventListener(
    BROWSER_NOTIFICATION_PREFERENCE_CHANGED_EVENT,
    handlePreferenceChanged
  )
  window.addEventListener("storage", handleStorage)
  window.addEventListener("focus", onChange)
  document.addEventListener("visibilitychange", handleVisibilityChange)

  return () => {
    window.removeEventListener(
      BROWSER_NOTIFICATION_PREFERENCE_CHANGED_EVENT,
      handlePreferenceChanged
    )
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener("focus", onChange)
    document.removeEventListener("visibilitychange", handleVisibilityChange)
  }
}

export async function showBrowserNotification(input: {
  title: string
  body: string
  tag: string
  onClick: () => void
}): Promise<Notification | null> {
  const notificationApi = resolveNotificationApi()
  if (!notificationApi || notificationApi.permission !== "granted") return null

  try {
    const notification = new notificationApi(input.title, {
      body: input.body,
      icon: "/linksense-appicon.svg",
      tag: input.tag,
    })
    notification.onclick = () => {
      window.focus()
      input.onClick()
      notification.close()
    }
    return await waitForBrowserNotificationDisplay(notification)
  } catch {
    return null
  }
}

function waitForBrowserNotificationDisplay(
  notification: Notification
): Promise<Notification | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: Notification | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      notification.onshow = null
      notification.onerror = null
      if (!result) notification.close()
      resolve(result)
    }
    const timeout = window.setTimeout(
      () => finish(notification),
      BROWSER_NOTIFICATION_DISPLAY_CONFIRMATION_TIMEOUT_MS
    )
    notification.onshow = () => finish(notification)
    notification.onerror = () => finish(null)
  })
}

export function claimBrowserNotificationDelivery(
  userId: string,
  notificationId: string
): boolean {
  const delivered = readBrowserNotificationDeliveryHistory(userId)
  if (delivered.includes(notificationId)) return false
  writeBrowserNotificationDeliveryHistory(userId, [
    ...delivered.slice(-(BROWSER_NOTIFICATION_DELIVERY_HISTORY_LIMIT - 1)),
    notificationId,
  ])
  return true
}

export function hasBrowserNotificationDelivery(
  userId: string,
  notificationId: string
): boolean {
  return readBrowserNotificationDeliveryHistory(userId).includes(notificationId)
}

function readBrowserNotificationDeliveryHistory(userId: string): string[] {
  const storageKey = browserNotificationDeliveryStorageKey(userId)
  const fallback = transientDeliveryHistory.get(userId) ?? []
  try {
    const stored = window.localStorage?.getItem(storageKey)
    let parsed: unknown = []
    try {
      parsed = stored ? JSON.parse(stored) : []
    } catch {
      window.localStorage?.removeItem(storageKey)
    }
    const delivered = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : []
    const merged = [...new Set([...delivered, ...fallback])].slice(
      -BROWSER_NOTIFICATION_DELIVERY_HISTORY_LIMIT
    )
    transientDeliveryHistory.set(userId, merged)
    return merged
  } catch {
    return fallback
  }
}

function writeBrowserNotificationDeliveryHistory(
  userId: string,
  delivered: string[]
) {
  const bounded = delivered.slice(-BROWSER_NOTIFICATION_DELIVERY_HISTORY_LIMIT)
  transientDeliveryHistory.set(userId, bounded)
  try {
    window.localStorage?.setItem(
      browserNotificationDeliveryStorageKey(userId),
      JSON.stringify(bounded)
    )
  } catch {
    // The bounded in-memory history still prevents duplicate delivery in-page.
  }
}
