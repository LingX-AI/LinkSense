import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import dayjs from "dayjs"

import { ApiError, apiRequest } from "@/api/client"
import {
  desktopApprovalNotificationSnapshotSchema,
  type DesktopApprovalNotificationSnapshot,
} from "@/api/contracts"
import { isLoginSessionCurrent } from "@/api/session"
import {
  isMacDesktopHost,
  showDesktopApprovalNotification,
} from "@/adapters/desktop/desktop-adapter"
import { useAuth } from "@/app/auth-state"
import {
  BROWSER_NOTIFICATION_REFETCH_INTERVAL_MS,
  claimBrowserNotificationDelivery,
  desktopApprovalNotificationStorageKey,
  hasBrowserNotificationDelivery,
  isLinkSenseActivelyUsed,
  readBrowserNotificationPreference,
  readDesktopApprovalReminderEnabled,
  recordMacNotificationDenial,
  withBrowserNotificationLock,
} from "@/features/browser-notifications/browser-notification-preference"
import {
  useDesktopApprovalReminder,
  useLoginSessionBoundary,
} from "@/features/browser-notifications/use-desktop-approval-notification"
import { useBrowserNotificationPreference } from "@/features/browser-notifications/use-browser-notification-preference"

// An old API without the route is a definitive answer for this server,
// account, and login: stop asking for that login and keep completion
// notifications working. A replacement login may reach an upgraded server.
let approvalEndpointUnavailableFor: {
  accountKey: string
  loginBoundary: number
} | null = null
let approvalNativeUnsupportedFor: string | null = null

type ApprovalDeliverySession = {
  controller: AbortController
  enteredAt: number
  latest: DesktopApprovalNotificationSnapshot | null
  running: boolean
  rerun: boolean
}

/**
 * The old conversations router captured `/conversations/:id` for this list
 * path and answered 400 VALIDATION_ERROR. Only that exact argumentless list
 * response is a legacy fallback; any other 400 remains a real error.
 */
function isUnsupportedApprovalSnapshotError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 ||
      error.status === 405 ||
      (error.status === 400 && error.errorCode === "VALIDATION_ERROR"))
  )
}

function approvalNotificationQueryKey(userId: string, loginBoundary: number) {
  return ["desktop-approval-notifications", userId, loginBoundary] as const
}

function isApprovalEndpointUnavailable(
  accountKey: string,
  loginBoundary: number
): boolean {
  return (
    approvalEndpointUnavailableFor?.accountKey === accountKey &&
    approvalEndpointUnavailableFor.loginBoundary === loginBoundary
  )
}

function subscribeToLinkSenseActivity(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange)
  window.addEventListener("focus", onChange)
  window.addEventListener("blur", onChange)
  return () => {
    document.removeEventListener("visibilitychange", onChange)
    window.removeEventListener("focus", onChange)
    window.removeEventListener("blur", onChange)
  }
}

function useIsLinkSenseActivelyUsed(): boolean {
  return useSyncExternalStore(
    subscribeToLinkSenseActivity,
    isLinkSenseActivelyUsed,
    isLinkSenseActivelyUsed
  )
}

/**
 * Poll the approval snapshot only for an authenticated Mac with both the
 * master macOS notification choice and the separate approval reminder choice
 * on. Every other surface, including the ordinary browser, stays inert.
 */
export function DesktopApprovalNotificationCenter() {
  const { status, user } = useAuth()
  const master = useBrowserNotificationPreference(user?.id)
  const approval = useDesktopApprovalReminder(user?.id)
  const loginBoundary = useLoginSessionBoundary()
  if (!isMacDesktopHost() || status !== "authenticated" || !user) return null
  if (!master.effectiveEnabled || !approval.enabled) return null
  const accountKey = desktopApprovalNotificationStorageKey(user.id)
  if (
    isApprovalEndpointUnavailable(accountKey, loginBoundary) ||
    approvalNativeUnsupportedFor === accountKey
  ) {
    return null
  }
  return (
    <ActiveDesktopApprovalNotificationCenter
      key={`${user.id}:${loginBoundary}`}
      userId={user.id}
      loginBoundary={loginBoundary}
    />
  )
}

function ActiveDesktopApprovalNotificationCenter({
  userId,
  loginBoundary,
}: {
  userId: string
  loginBoundary: number
}) {
  const accountKey = desktopApprovalNotificationStorageKey(userId)
  const queryClient = useQueryClient()
  const background = !useIsLinkSenseActivelyUsed()
  const [endpointUnavailable, setEndpointUnavailable] = useState(false)
  const [nativeUnsupported, setNativeUnsupported] = useState(false)
  const deliverySessionRef = useRef<ApprovalDeliverySession | null>(null)
  const queryKey = approvalNotificationQueryKey(userId, loginBoundary)

  const markNativeUnsupported = useCallback(() => {
    approvalNativeUnsupportedFor = accountKey
    setNativeUnsupported(true)
  }, [accountKey])

  const approvalQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        const snapshot = await apiRequest(
          "/conversations/desktop-approval-notifications",
          {
            schema: desktopApprovalNotificationSnapshotSchema,
            signal,
            loginSessionBoundary: loginBoundary,
          }
        )
        signal.throwIfAborted()
        if (!isLoginSessionCurrent(loginBoundary)) {
          throw new DOMException(
            "Request superseded by a newer login session",
            "AbortError"
          )
        }
        return snapshot
      } catch (error) {
        if (isUnsupportedApprovalSnapshotError(error)) {
          // Discard a late answer from a canceled or replaced login before it
          // can settle anything for the next one.
          if (signal.aborted) signal.throwIfAborted()
          if (!isLoginSessionCurrent(loginBoundary)) {
            throw new DOMException(
              "Request superseded by a newer login session",
              "AbortError"
            )
          }
          approvalEndpointUnavailableFor = { accountKey, loginBoundary }
          setEndpointUnavailable(true)
          return { items: [] }
        }
        throw error
      }
    },
    enabled: background && !endpointUnavailable && !nativeUnsupported,
    gcTime: 0,
    refetchInterval: BROWSER_NOTIFICATION_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    // A missing route is settled above. A transient failure keeps its own
    // bounded poll; it never becomes an unbounded retry loop.
    retry: false,
  })
  const { data, dataUpdatedAt } = approvalQuery

  // Foreground use needs neither the poll nor an in-flight snapshot. Disabling
  // the query alone does not abort the native request, so cancel it explicitly.
  useEffect(() => {
    if (background) return
    void queryClient.cancelQueries({
      queryKey: approvalNotificationQueryKey(userId, loginBoundary),
    })
  }, [background, loginBoundary, queryClient, userId])

  useEffect(() => {
    return () => {
      void queryClient.cancelQueries({
        queryKey: approvalNotificationQueryKey(userId, loginBoundary),
      })
    }
  }, [loginBoundary, queryClient, userId])

  // A background session lives across the 5 s refetches so an identical
  // snapshot never aborts a delivery that is already waiting for the system.
  useEffect(() => {
    if (!background) return
    const session: ApprovalDeliverySession = {
      controller: new AbortController(),
      enteredAt: Date.now(),
      latest: null,
      running: false,
      rerun: false,
    }
    deliverySessionRef.current = session
    return () => {
      session.controller.abort()
      if (deliverySessionRef.current === session) {
        deliverySessionRef.current = null
      }
    }
  }, [accountKey, background, loginBoundary])

  useEffect(() => {
    if (!background || !data) return
    const session = deliverySessionRef.current
    if (!session || session.controller.signal.aborted) return
    // Cached data from an earlier background period is not a fresh snapshot
    // for this entry. Wait until the poll after the transition succeeds.
    if (dataUpdatedAt < session.enteredAt) return
    void runApprovalDelivery(session, data, (snapshot, signal) =>
      deliverApprovalSnapshot({
        snapshot,
        signal,
        userId,
        loginBoundary,
        onNativeUnsupported: markNativeUnsupported,
      })
    )
  }, [
    accountKey,
    background,
    data,
    dataUpdatedAt,
    loginBoundary,
    markNativeUnsupported,
    userId,
  ])

  return null
}

async function runApprovalDelivery(
  session: ApprovalDeliverySession,
  snapshot: DesktopApprovalNotificationSnapshot,
  deliver: (
    snapshot: DesktopApprovalNotificationSnapshot,
    signal: AbortSignal
  ) => Promise<void>
): Promise<void> {
  session.latest = snapshot
  if (session.running) {
    session.rerun = true
    return
  }
  session.running = true
  try {
    do {
      session.rerun = false
      const current = session.latest
      if (!current || session.controller.signal.aborted) return
      await deliver(current, session.controller.signal)
    } while (session.rerun && !session.controller.signal.aborted)
  } finally {
    session.running = false
  }
}

async function deliverApprovalSnapshot({
  snapshot,
  signal,
  userId,
  loginBoundary,
  onNativeUnsupported,
}: {
  snapshot: DesktopApprovalNotificationSnapshot
  signal: AbortSignal
  userId: string
  loginBoundary: number
  onNativeUnsupported: () => void
}): Promise<void> {
  for (const item of snapshot.items) {
    if (signal.aborted || !isLoginSessionCurrent(loginBoundary)) return
    if (
      !readBrowserNotificationPreference(userId).effectiveEnabled ||
      !readDesktopApprovalReminderEnabled(userId)
    )
      return
    const notificationId = `approval:${item.request_id}`
    if (hasBrowserNotificationDelivery(userId, notificationId)) continue
    if (isLinkSenseActivelyUsed()) return
    if (!dayjs(item.expires_at).isAfter(dayjs())) continue

    const result = await withBrowserNotificationLock(
      userId,
      notificationId,
      async () => {
        if (signal.aborted || !isLoginSessionCurrent(loginBoundary))
          return "cancelled" as const
        if (
          !readBrowserNotificationPreference(userId).effectiveEnabled ||
          !readDesktopApprovalReminderEnabled(userId) ||
          hasBrowserNotificationDelivery(userId, notificationId) ||
          isLinkSenseActivelyUsed() ||
          !dayjs(item.expires_at).isAfter(dayjs())
        )
          return "cancelled" as const
        const result = await showDesktopApprovalNotification(
          {
            userId,
            conversationId: item.conversation_id,
            requestId: item.request_id,
            expiresAt: item.expires_at,
          },
          signal
        )
        // Claim while the cross-window lock is still held, immediately after
        // the current system response, so a competing delivery that acquires
        // the lock next sees the existing bounded history. A login or opt-out
        // that changed while the system answered is not current.
        if (
          !signal.aborted &&
          result === "shown" &&
          isLoginSessionCurrent(loginBoundary) &&
          readBrowserNotificationPreference(userId).effectiveEnabled &&
          readDesktopApprovalReminderEnabled(userId)
        ) {
          claimBrowserNotificationDelivery(userId, notificationId)
        }
        return result
      }
    )
    if (signal.aborted || !isLoginSessionCurrent(loginBoundary)) return
    if (result === "denied") {
      recordMacNotificationDenial(userId)
      return
    }
    if (result === "unsupported") {
      onNativeUnsupported()
      return
    }
  }
}
