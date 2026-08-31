import { useCallback, useSyncExternalStore } from "react"

import {
  disableBrowserNotifications,
  persistBrowserNotificationPreference,
  readBrowserNotificationPreference,
  requestBrowserNotificationPermission,
  subscribeBrowserNotificationPreference,
  type BrowserNotificationEnableResult,
} from "@/features/browser-notifications/browser-notification-preference"

export function useBrowserNotificationPreference(userId: string | undefined) {
  const readPreference = useCallback(
    () =>
      userId
        ? readBrowserNotificationPreference(userId)
        : {
            enabled: false,
            effectiveEnabled: false,
            permission: "unsupported" as const,
            supported: false,
          },
    [userId]
  )
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      userId
        ? subscribeBrowserNotificationPreference(userId, onStoreChange)
        : () => undefined,
    [userId]
  )
  const getSnapshot = useCallback(() => {
    const preference = readPreference()
    return `${preference.enabled}:${preference.permission}:${preference.supported}`
  }, [readPreference])
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const preference = readPreference()

  const requestPermission =
    useCallback(async (): Promise<BrowserNotificationEnableResult> => {
      if (!userId) return "unsupported"
      return requestBrowserNotificationPermission()
    }, [userId])

  const activate = useCallback(() => {
    if (!userId) return false
    return persistBrowserNotificationPreference(userId, true)
  }, [userId])

  const disable = useCallback(() => {
    if (!userId) return false
    return disableBrowserNotifications(userId)
  }, [userId])

  return { ...preference, activate, disable, requestPermission }
}
