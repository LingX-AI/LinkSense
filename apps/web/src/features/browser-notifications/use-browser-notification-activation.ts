import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import { completionNotificationFeedSchema } from "@/api/contracts"
import { useProductName } from "@/app/product-branding"
import {
  clearBrowserNotificationFeedCursor,
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
      deliveryError: "browserNotifications.deliveryError",
      feedError: "browserNotifications.feedError",
      error: "browserNotifications.permissionError",
      dismissed: "browserNotifications.permissionDismissed",
      denied: "browserNotifications.permissionDenied",
      unsupported: "browserNotifications.unsupported",
      testSent: "browserNotifications.testSent",
    }[feedback]
  const feedbackMessage = feedbackKey
    ? t(feedbackKey, { productName })
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

      const body = t("browserNotifications.testBody")
      const delivered = await showBrowserNotification({
        title: t("browserNotifications.testTitle", { productName }),
        body,
        tag: `browser-notification-test:${userId}:${Date.now()}`,
        onClick: () => undefined,
      })
      if (signal.aborted) return
      if (!delivered) {
        reportDeliveryFailure()
        return
      }

      try {
        const feed = await apiRequest("/completion-notifications", {
          schema: completionNotificationFeedSchema,
          query: { limit: 100 },
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
