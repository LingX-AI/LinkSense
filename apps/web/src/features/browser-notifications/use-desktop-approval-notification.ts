import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react"
import dayjs from "dayjs"

import { apiRequest } from "@/api/client"
import { desktopApprovalNotificationSnapshotSchema } from "@/api/contracts"
import {
  getLoginSessionBoundary,
  getLoginSessionChange,
  isLoginSessionCurrent,
  subscribeToLoginSession,
} from "@/api/session"
import {
  isMacDesktopHost,
  registerDesktopApprovalClickVerifier,
  cancelPendingApprovalNotificationClick,
} from "@/adapters/desktop/desktop-adapter"
import { useAuth } from "@/app/auth-state"
import {
  persistDesktopApprovalReminder,
  readDesktopApprovalReminderEnabled,
  subscribeBrowserNotificationPreference,
} from "@/features/browser-notifications/browser-notification-preference"

export function useDesktopApprovalReminder(userId: string | undefined) {
  const readPreference = useCallback(
    () => (userId ? readDesktopApprovalReminderEnabled(userId) : false),
    [userId]
  )
  const subscribe = useCallback(
    (onChange: () => void) =>
      userId
        ? subscribeBrowserNotificationPreference(userId, onChange)
        : () => undefined,
    [userId]
  )
  const snapshot = useSyncExternalStore(
    subscribe,
    readPreference,
    readPreference
  )
  const persist = useCallback(
    (enabled: boolean) =>
      userId ? persistDesktopApprovalReminder(userId, enabled) : false,
    [userId]
  )
  return { enabled: snapshot, persist }
}

/** Re-render when an explicit login replacement advances the boundary. */
export function useLoginSessionBoundary(): number {
  return useSyncExternalStore(
    subscribeToLoginSession,
    getLoginSessionBoundary,
    getLoginSessionBoundary
  )
}

/**
 * Inject the exact-pair GET into the native click buffer. This keeps the
 * desktop adapter free of the authenticated API client. The click routes only
 * when the server still returns this live pair for the current login; it never
 * answers the approval.
 */
export function useDesktopApprovalNotificationClickVerifier(): void {
  const { status, user } = useAuth()
  const authRef = useRef<{
    status: typeof status
    userId: string | null
  }>({ status, userId: user?.id ?? null })
  const boundary = useLoginSessionBoundary()
  const previousBoundaryRef = useRef(boundary)
  const previousAuthRef = useRef<{
    status: typeof status
    userId: string | null
  } | null>(null)

  useLayoutEffect(() => {
    if (previousBoundaryRef.current === boundary) return
    previousBoundaryRef.current = boundary
    // The first anonymous-to-authenticated sign-in advances the boundary
    // before the protected surface exists. Keep a click that belongs to the
    // owner who is signing in; a sign-out or an authenticated replacement
    // still cancels it.
    if (
      getLoginSessionChange() !== "sign-in" ||
      authRef.current.status !== "anonymous"
    ) {
      cancelPendingApprovalNotificationClick()
    }
  }, [boundary])

  useLayoutEffect(() => {
    const previous = previousAuthRef.current
    const current = { status, userId: user?.id ?? null }
    previousAuthRef.current = current
    authRef.current = current
    if (
      previous?.status === "authenticated" &&
      (current.status !== "authenticated" || previous.userId !== current.userId)
    ) {
      cancelPendingApprovalNotificationClick()
    }
  }, [status, user?.id])

  useLayoutEffect(() => {
    return registerDesktopApprovalClickVerifier(
      async ({ userId, conversationId, requestId, signal }) => {
        const current = authRef.current
        if (!isMacDesktopHost() || current.status !== "authenticated") {
          return false
        }
        if (current.userId !== userId) return false
        const requestBoundary = getLoginSessionBoundary()
        try {
          const snapshot = await apiRequest(
            "/conversations/desktop-approval-notifications",
            {
              schema: desktopApprovalNotificationSnapshotSchema,
              query: {
                conversation_id: conversationId,
                request_id: requestId,
              },
              signal,
              loginSessionBoundary: requestBoundary,
            }
          )
          if (!isLoginSessionCurrent(requestBoundary)) return false
          const now = dayjs()
          return snapshot.items.some(
            (item) =>
              item.conversation_id === conversationId &&
              item.request_id === requestId &&
              dayjs(item.expires_at).isAfter(now)
          )
        } catch {
          return false
        }
      }
    )
  }, [])
}
