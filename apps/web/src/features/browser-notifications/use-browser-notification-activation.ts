import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { DEFAULT_ORGANIZATION_DISPLAY_NAME } from "@linksense/shared"

import { apiRequest } from "@/api/client"
import {
  isMacDesktopHost,
  showDesktopTestNotification,
} from "@/adapters/desktop/desktop-adapter"
import { completionNotificationFeedSchema } from "@/api/contracts"
import { useProductName } from "@/app/product-branding"
import {
  clearBrowserNotificationFeedCursor,
  recordMacNotificationDenial,
  saveBrowserNotificationFeedCursor,
  showBrowserNotification,
} from "@/features/browser-notifications/browser-notification-preference"
import { useBrowserNotificationPreference } from "@/features/browser-notifications/use-browser-notification-preference"

export type BrowserNotificationActivationFeedback =
  | "dismissed"
  | "error"
  | "storageError"
  | "deliveryError"
  | "feedError"
  | "testSent"
  | "denied"
  | "unsupported"
  | null

export function useBrowserNotificationActivation(userId: string | undefined) {
  const { t } = useTranslation()
  const productName = useProductName()
  const desktop = isMacDesktopHost()
  const preference = useBrowserNotificationPreference(userId)
  const request = useRef<AbortController | null>(null)
  const [requestPending, setRequestPending] = useState(false)
  const [feedback, setFeedback] =
    useState<BrowserNotificationActivationFeedback>(null)
  useEffect(() => () => request.current?.abort(), [userId])
  const feedbackKey =
    feedback &&
    {
      storageError: "browserNotifications.storageError",
      deliveryError: desktop
        ? "browserNotifications.desktopDeliveryError"
        : "browserNotifications.deliveryError",
      feedError: "browserNotifications.feedError",
      error: "browserNotifications.permissionError",
      dismissed: "browserNotifications.permissionDismissed",
      denied: "browserNotifications.desktopPermissionDenied",
      unsupported: desktop
        ? "browserNotifications.desktopUnsupported"
        : "browserNotifications.unsupported",
      testSent: desktop
        ? "browserNotifications.desktopTestSent"
        : "browserNotifications.testSent",
    }[feedback]
  const feedbackMessage = feedbackKey
    ? t(feedbackKey, {
        productName: desktop ? DEFAULT_ORGANIZATION_DISPLAY_NAME : productName,
      })
    : null

  const reportDeliveryFailure = () => {
    setFeedback(
      !preference.enabled || preference.disable()
        ? "deliveryError"
        : "storageError"
    )
  }

  const requestPermissionAndActivate = () => {
    if (!userId || request.current) return
    const attempt = new AbortController()
    request.current = attempt
    const { signal } = attempt
    setFeedback(null)
    setRequestPending(true)
    void (async () => {
      if (!desktop) {
        const result = await preference.requestPermission()
        if (signal.aborted) return
        if (result === "default") {
          setFeedback("dismissed")
          return
        }
        if (result === "error") {
          setFeedback("error")
          return
        }
        if (result === "unsupported") {
          setFeedback("unsupported")
          return
        }
        if (result !== "granted") return
      }

      const body = t("browserNotifications.testBody")
      const delivery = desktop
        ? await showDesktopTestNotification(body, signal)
        : (await showBrowserNotification({
              title: t("browserNotifications.testTitle", { productName }),
              body,
              tag: `browser-notification-test:${userId}:${Date.now()}`,
              onClick: () => undefined,
            }))
          ? "shown"
          : "failed"
      if (signal.aborted || delivery === "cancelled") return
      if (delivery === "denied") {
        recordMacNotificationDenial(userId)
        setFeedback("denied")
        return
      }
      if (delivery === "unsupported") {
        setFeedback("unsupported")
        return
      }
      if (delivery !== "shown") {
        reportDeliveryFailure()
        return
      }

      try {
        const feed = await apiRequest("/completion-notifications", {
          schema: completionNotificationFeedSchema,
          query: { limit: 100 },
          ...(desktop ? { signal } : {}),
        })
        if (signal.aborted) return
        saveBrowserNotificationFeedCursor(userId, feed.next_cursor)
      } catch {
        if (signal.aborted) return
        clearBrowserNotificationFeedCursor(userId)
        setFeedback(
          !preference.enabled || preference.disable()
            ? "feedError"
            : "storageError"
        )
        return
      }

      if (!preference.activate()) {
        clearBrowserNotificationFeedCursor(userId)
        setFeedback("storageError")
        return
      }
      setFeedback("testSent")
    })().finally(() => {
      request.current = null
      setRequestPending(false)
    })
  }

  const disable = () => {
    setFeedback(null)
    if (!preference.disable()) setFeedback("storageError")
  }

  return {
    preference,
    requestPending,
    feedback,
    feedbackMessage,
    clearFeedback: () => setFeedback(null),
    disable,
    requestPermissionAndActivate,
  }
}
