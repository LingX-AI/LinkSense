import { useState } from "react"
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
  | null

export function useBrowserNotificationActivation(userId: string | undefined) {
  const { t } = useTranslation()
  const productName = useProductName()
  const preference = useBrowserNotificationPreference(userId)
  const [requestPending, setRequestPending] = useState(false)
  const [feedback, setFeedback] =
    useState<BrowserNotificationActivationFeedback>(null)
  const feedbackMessage =
    feedback === "storageError"
      ? t("browserNotifications.storageError")
      : feedback === "deliveryError"
        ? t("browserNotifications.deliveryError")
        : feedback === "feedError"
          ? t("browserNotifications.feedError")
          : feedback === "error"
            ? t("browserNotifications.permissionError")
            : feedback === "dismissed"
              ? t("browserNotifications.permissionDismissed")
              : feedback === "testSent"
                ? t("browserNotifications.testSent")
                : null

  const createTestNotification = async () => {
    if (!userId) return null
    return showBrowserNotification({
      title: t("browserNotifications.testTitle", { productName }),
      body: t("browserNotifications.testBody"),
      tag: `browser-notification-test:${userId}:${Date.now()}`,
      onClick: () => undefined,
    })
  }

  const reportDeliveryFailure = () => {
    setFeedback(
      !preference.enabled || preference.disable()
        ? "deliveryError"
        : "storageError"
    )
  }

  const requestPermissionAndActivate = () => {
    if (!userId) return
    setFeedback(null)
    setRequestPending(true)
    void (async () => {
      const result = await preference.requestPermission()
      if (result === "default") {
        setFeedback("dismissed")
        return
      }
      if (result === "error") {
        setFeedback("error")
        return
      }
      if (result !== "granted") return

      const notification = await createTestNotification()
      if (!notification) {
        reportDeliveryFailure()
        return
      }

      try {
        const feed = await apiRequest("/completion-notifications", {
          schema: completionNotificationFeedSchema,
          query: { limit: 100 },
        })
        saveBrowserNotificationFeedCursor(userId, feed.next_cursor)
      } catch {
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
    })().finally(() => setRequestPending(false))
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
