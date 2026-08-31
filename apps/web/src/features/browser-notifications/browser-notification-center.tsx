import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { ApiError, apiRequest } from "@/api/client"
import { completionNotificationFeedSchema } from "@/api/contracts"
import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import {
  claimBrowserNotificationDelivery,
  clearBrowserNotificationFeedCursor,
  hasBrowserNotificationDelivery,
  readBrowserNotificationFeedCursor,
  saveBrowserNotificationFeedCursor,
  showBrowserNotification,
} from "@/features/browser-notifications/browser-notification-preference"
import { useBrowserNotificationPreference } from "@/features/browser-notifications/use-browser-notification-preference"

export const completionNotificationRefetchIntervalMs = 5_000
let nextBrowserNotificationQueryInstanceId = 0

export function BrowserNotificationCenter() {
  const { status, user } = useAuth()
  const preference = useBrowserNotificationPreference(user?.id)
  if (status !== "authenticated" || !user || !preference.effectiveEnabled) {
    return null
  }

  return <ActiveBrowserNotificationCenter key={user.id} userId={user.id} />
}

function ActiveBrowserNotificationCenter({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const productName = useProductName()
  const navigate = useNavigate()
  const [queryInstanceId] = useState(
    () => ++nextBrowserNotificationQueryInstanceId
  )
  const cursorRef = useRef<string | null>(
    readBrowserNotificationFeedCursor(userId)
  )
  const deliveredInThisTabRef = useRef(new Set<string>())
  const activeNotificationsRef = useRef(new Set<Notification>())

  const completionQuery = useQuery({
    queryKey: ["completion-notifications", userId, queryInstanceId],
    queryFn: async ({ signal }) => {
      const requestedCursor = cursorRef.current
      try {
        const feed = await apiRequest("/completion-notifications", {
          schema: completionNotificationFeedSchema,
          query: {
            ...(requestedCursor ? { cursor: requestedCursor } : {}),
            limit: 100,
          },
          signal,
        })
        cursorRef.current = feed.next_cursor
        saveBrowserNotificationFeedCursor(userId, feed.next_cursor)
        return { feed, requestedCursor }
      } catch (error) {
        if (
          requestedCursor &&
          error instanceof ApiError &&
          error.status === 400
        ) {
          cursorRef.current = null
          clearBrowserNotificationFeedCursor(userId)
        }
        throw error
      }
    },
    gcTime: 0,
    refetchInterval: completionNotificationRefetchIntervalMs,
    refetchIntervalInBackground: true,
  })
  const { data: completionData, refetch } = completionQuery

  useEffect(() => {
    const activeNotifications = activeNotificationsRef.current
    return () => {
      for (const notification of activeNotifications) notification.close()
      activeNotifications.clear()
    }
  }, [])

  useEffect(() => {
    if (!completionData) return
    let cancelled = false

    const deliverNotifications = async () => {
      for (const item of completionData.feed.items) {
        if (cancelled) return
        const notificationId = `${item.source}:${item.turn_id}`
        if (deliveredInThisTabRef.current.has(notificationId)) continue
        if (hasBrowserNotificationDelivery(userId, notificationId)) continue
        if (isLinkSenseActivelyUsed()) {
          claimBrowserNotificationDelivery(userId, notificationId)
          deliveredInThisTabRef.current.add(notificationId)
          continue
        }

        const target = `/conversations/${item.conversation_id}`
        const body =
          item.status === "completed"
            ? t("browserNotifications.statusCompletedBody")
            : item.status === "failed"
              ? t("browserNotifications.statusFailedBody")
              : t("browserNotifications.statusInterruptedBody")
        const notification = await createClaimedBrowserNotification({
          userId,
          notificationId,
          title: t("browserNotifications.notificationTitle", {
            productName,
            taskTitle: item.task_title,
          }),
          body,
          onClick: () => navigate(target),
        })
        if (!notification) continue
        if (cancelled) {
          notification.close()
          return
        }

        deliveredInThisTabRef.current.add(notificationId)
        activeNotificationsRef.current.add(notification)
        notification.onclose = () => {
          activeNotificationsRef.current.delete(notification)
        }
      }

      if (!cancelled && completionData.requestedCursor === null) {
        void refetch()
      }
    }

    void deliverNotifications()
    return () => {
      cancelled = true
    }
  }, [completionData, navigate, productName, refetch, t, userId])

  return null
}

function isLinkSenseActivelyUsed(): boolean {
  return document.visibilityState === "visible" && document.hasFocus()
}

async function createClaimedBrowserNotification(input: {
  userId: string
  notificationId: string
  title: string
  body: string
  onClick: () => void
}): Promise<Notification | null> {
  const deliver = async () => {
    if (hasBrowserNotificationDelivery(input.userId, input.notificationId)) {
      return null
    }
    const notification = await showBrowserNotification({
      title: input.title,
      body: input.body,
      tag: `${input.userId}:${input.notificationId}`,
      onClick: input.onClick,
    })
    if (!notification) return null
    claimBrowserNotificationDelivery(input.userId, input.notificationId)
    return notification
  }

  try {
    if (!navigator.locks) return deliver()
    return await navigator.locks.request(
      `linksense-browser-notification:${input.userId}:${input.notificationId}`,
      deliver
    )
  } catch {
    return deliver()
  }
}
