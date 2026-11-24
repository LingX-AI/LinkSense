import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { ApiError, apiRequest } from "@/api/client"
import {
  isMacDesktopHost,
  showDesktopCompletionNotification,
} from "@/adapters/desktop/desktop-adapter"
import { completionNotificationFeedSchema } from "@/api/contracts"
import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import {
  claimBrowserNotificationDelivery,
  clearBrowserNotificationFeedCursor,
  hasBrowserNotificationDelivery,
  isLinkSenseActivelyUsed,
  readBrowserNotificationFeedCursor,
  readBrowserNotificationPreference,
  recordMacNotificationDenial,
  saveBrowserNotificationFeedCursor,
  BROWSER_NOTIFICATION_REFETCH_INTERVAL_MS,
  showBrowserNotification,
  withBrowserNotificationLock,
} from "@/features/browser-notifications/browser-notification-preference"
import { DesktopApprovalNotificationCenter } from "@/features/browser-notifications/desktop-approval-notification-center"
import { useDesktopApprovalNotificationClickVerifier } from "@/features/browser-notifications/use-desktop-approval-notification"
import { useBrowserNotificationPreference } from "@/features/browser-notifications/use-browser-notification-preference"

let nextBrowserNotificationQueryInstanceId = 0

export function BrowserNotificationCenter() {
  const { status, user } = useAuth()
  const preference = useBrowserNotificationPreference(user?.id)
  // Register the exact-pair approval click recheck before any auth-ready launch
  // flush can consume a cold-start notification.
  useDesktopApprovalNotificationClickVerifier()
  const authenticated = status === "authenticated" && user !== null

  return (
    <>
      {authenticated && preference.effectiveEnabled && (
        <ActiveBrowserNotificationCenter key={user.id} userId={user.id} />
      )}
      {authenticated && <DesktopApprovalNotificationCenter />}
    </>
  )
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
  const nativeNotifications = isMacDesktopHost()

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
        signal.throwIfAborted()
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
    refetchInterval: BROWSER_NOTIFICATION_REFETCH_INTERVAL_MS,
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
    const delivery = new AbortController()
    const { signal } = delivery

    const deliverNotifications = async () => {
      for (const item of completionData.feed.items) {
        if (signal.aborted) return
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
        if (nativeNotifications) {
          // Native text stays generic: the task title and content must not
          // reach the lock screen or Notification Center.
          const result = await withBrowserNotificationLock(
            userId,
            notificationId,
            async () => {
              if (
                signal.aborted ||
                !readBrowserNotificationPreference(userId).effectiveEnabled ||
                hasBrowserNotificationDelivery(userId, notificationId)
              )
                return
              const result = await showDesktopCompletionNotification(
                {
                  userId,
                  conversationId: item.conversation_id,
                  turnId: item.turn_id,
                  body,
                },
                signal
              )
              if (!signal.aborted && result === "shown") {
                claimBrowserNotificationDelivery(userId, notificationId)
                deliveredInThisTabRef.current.add(notificationId)
              }
              return result
            }
          )
          if (!signal.aborted && result === "denied") {
            recordMacNotificationDenial(userId)
            return
          }
          continue
        }
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
        if (signal.aborted) {
          notification.close()
          return
        }

        deliveredInThisTabRef.current.add(notificationId)
        activeNotificationsRef.current.add(notification)
        notification.onclose = () => {
          activeNotificationsRef.current.delete(notification)
        }
      }

      if (!signal.aborted && completionData.requestedCursor === null) {
        void refetch()
      }
    }

    void deliverNotifications()
    return () => delivery.abort()
  }, [
    completionData,
    nativeNotifications,
    navigate,
    productName,
    refetch,
    t,
    userId,
  ])

  return null
}

async function createClaimedBrowserNotification(input: {
  userId: string
  notificationId: string
  title: string
  body: string
  onClick: () => void
}): Promise<Notification | null> {
  return withBrowserNotificationLock(
    input.userId,
    input.notificationId,
    async () => {
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
  )
}
