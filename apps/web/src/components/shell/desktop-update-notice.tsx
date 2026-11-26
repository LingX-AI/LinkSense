import { useEffect, useRef, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import {
  getDesktopUpdateRequired,
  isMacDesktopHost,
  showDesktopUpdateNotification,
  subscribeDesktopUpdate,
} from "@/adapters/desktop/desktop-adapter"
import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  claimBrowserNotificationDelivery,
  hasBrowserNotificationDelivery,
  isLinkSenseActivelyUsed,
  readBrowserNotificationPreference,
  recordMacNotificationDenial,
} from "@/features/browser-notifications/browser-notification-preference"
import { useBrowserNotificationPreference } from "@/features/browser-notifications/use-browser-notification-preference"
import { DesktopUpdateControl } from "@/features/desktop-update/desktop-update-control"
import { useDesktopUpdateState } from "@/features/desktop-update/desktop-update-state"
import { SystemNoticeDialogContent } from "./system-notice-dialog-content"

const desktopUpdateToastId = "desktop-update-available"

export function DesktopUpdateNotice() {
  const required = useSyncExternalStore(
    subscribeDesktopUpdate,
    getDesktopUpdateRequired,
    () => false
  )
  if (required) return <RequiredDesktopUpdateNotice />
  if (!isMacDesktopHost()) return null
  return <AvailableDesktopUpdateToast />
}

function RequiredDesktopUpdateNotice() {
  const { t } = useTranslation()
  const productName = useProductName()
  // The blocking compatibility dialog replaces any background availability
  // notice instead of stacking another update surface.
  useEffect(() => {
    notify.dismiss(desktopUpdateToastId)
  }, [])
  return (
    <Dialog open>
      <SystemNoticeDialogContent
        title={t("bootstrap.unavailableTitle", { productName })}
        description={t("errors.desktopUpdateRequired")}
        footer={
          <div className="w-full min-w-0">
            <DesktopUpdateControl
              trailingAction={
                <Button onClick={() => window.location.reload()}>
                  {t("common.retry")}
                </Button>
              }
            />
          </div>
        }
      />
    </Dialog>
  )
}

type SystemNotificationOutcome =
  "eligible" | "pending" | "stalled" | "seen" | "shown" | "failed"

type SystemNotificationCandidate = {
  version: string
  revision: number
  userId: string | null
  outcome: SystemNotificationOutcome
}

type SystemNotificationAttempt = {
  controller: AbortController
  version: string
  revision: number
  userId: string
}

function updateNotificationDeliveryId(version: string) {
  return `desktop-update:${version}`
}

// Background availability uses the existing toast surface so it never covers
// content, steals focus, or grows a second dialog. Settings remains the place
// to see staged/progress state. A separately opted-in background account also
// gets one quiet native notice for the current signed candidate.
function AvailableDesktopUpdateToast() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { status, user } = useAuth()
  const preference = useBrowserNotificationPreference(user?.id)
  const state = useDesktopUpdateState()
  const notifiedVersion = useRef<string | null>(null)
  const systemCandidate = useRef<SystemNotificationCandidate | null>(null)
  const systemAttempt = useRef<SystemNotificationAttempt | null>(null)
  // One bounded marker each keeps a seen or failed version quiet across the
  // transient checking snapshots of a background cadence. A foreground version
  // stays globally seen; delivery history and a failed delivery belong to the
  // account that produced them.
  const systemSeenVersion = useRef<string | null>(null)
  const systemFailedVersion = useRef<{
    version: string
    userId: string
  } | null>(null)
  const systemUnsupported = useRef(false)
  const revision = state?.revision
  const userId = user?.id
  const availableVersion =
    state?.state === "available" ? (state.version ?? null) : null
  const stateKind = state?.state

  useEffect(() => {
    if (availableVersion) {
      if (notifiedVersion.current === availableVersion) return
      notifiedVersion.current = availableVersion
      notify.info(t("desktopUpdate.noticeAction"), {
        id: desktopUpdateToastId,
        description: t("desktopUpdate.updateAvailable", {
          version: availableVersion,
        }),
        action: {
          label: t("common.view"),
          onClick: () => {
            notify.dismiss(desktopUpdateToastId)
            navigate("/settings/general")
          },
        },
      })
      return
    }
    // A background cadence may briefly report checking. Keep the same notice
    // and its version dedupe instead of stacking another toast.
    if (stateKind === "checking") return
    if (notifiedVersion.current !== null) {
      notifiedVersion.current = null
      notify.dismiss(desktopUpdateToastId)
    }
  }, [availableVersion, navigate, stateKind, t])

  useEffect(() => {
    const abortAttempt = () => {
      const attempt = systemAttempt.current
      if (!attempt) return
      systemAttempt.current = null
      attempt.controller.abort()
    }

    if (!availableVersion) {
      abortAttempt()
      systemCandidate.current = null
      return
    }
    const candidateVersion = availableVersion
    const notificationId = updateNotificationDeliveryId(candidateVersion)
    let candidate = systemCandidate.current
    if (candidate?.version !== candidateVersion) {
      abortAttempt()
      candidate = {
        version: candidateVersion,
        revision: revision ?? 0,
        userId: userId ?? null,
        outcome:
          systemSeenVersion.current === candidateVersion
            ? "seen"
            : systemFailedVersion.current?.version === candidateVersion &&
                systemFailedVersion.current.userId === userId
              ? "failed"
              : userId && hasBrowserNotificationDelivery(userId, notificationId)
                ? "shown"
                : "eligible",
      }
      systemCandidate.current = candidate
    } else if (revision !== undefined && revision !== candidate.revision) {
      // A new revision invalidates an in-flight request. A failed, seen, or
      // shown version stays put; only the live pending/stalled attempt is
      // eligible again, and it is pinned to the new revision below.
      if (candidate.outcome === "pending" || candidate.outcome === "stalled") {
        abortAttempt()
        candidate.outcome = "eligible"
      }
      candidate.revision = revision
    }
    const candidateUserId = userId ?? null
    if (candidate.userId !== candidateUserId) {
      if (candidate.outcome === "pending" || candidate.outcome === "stalled") {
        abortAttempt()
        candidate.outcome = "eligible"
      } else if (
        candidateUserId !== null &&
        (candidate.outcome === "shown" || candidate.outcome === "failed")
      ) {
        // Delivery and failure belong to the account that produced them. A
        // different account starts from its own history for the same version;
        // signing out keeps the failed marker until that late transition clears
        // it below, matching the existing opt-out retry behavior.
        candidate.outcome = "eligible"
      }
      candidate.userId = candidateUserId
      if (
        candidate.outcome === "eligible" &&
        candidateUserId !== null &&
        systemFailedVersion.current?.version === candidateVersion &&
        systemFailedVersion.current.userId === candidateUserId
      ) {
        candidate.outcome = "failed"
      }
    } else if (
      candidate.outcome === "pending" &&
      systemAttempt.current &&
      systemAttempt.current.userId !== candidateUserId
    ) {
      abortAttempt()
      candidate.outcome = "eligible"
    }
    if (isLinkSenseActivelyUsed()) {
      // The user already has the in-app toast. Moving the window to the
      // background later must not turn that into a second notice.
      if (
        candidate.outcome === "eligible" ||
        candidate.outcome === "pending" ||
        candidate.outcome === "stalled"
      ) {
        abortAttempt()
        candidate.outcome = "seen"
        systemSeenVersion.current = candidateVersion
      }
      return
    }
    if (status !== "authenticated" || !userId || !preference.effectiveEnabled) {
      if (candidate.outcome === "pending" || candidate.outcome === "stalled") {
        abortAttempt()
        candidate.outcome = "eligible"
      } else if (candidate.outcome === "failed") {
        // Turning notifications off and on again is a new eligible user
        // action; it may retry a failed notice for the same candidate. Signing
        // out keeps the previous behavior of clearing that transient marker.
        candidate.outcome = "eligible"
        if (
          systemFailedVersion.current?.version === candidateVersion &&
          (candidateUserId === null ||
            systemFailedVersion.current.userId === candidateUserId)
        )
          systemFailedVersion.current = null
      }
      return
    }
    if (!candidateUserId) return
    if (hasBrowserNotificationDelivery(candidateUserId, notificationId)) {
      candidate.outcome = "shown"
      return
    }
    if (candidate.outcome !== "eligible") return
    if (systemUnsupported.current) {
      candidate.outcome = "failed"
      systemFailedVersion.current = {
        version: candidateVersion,
        userId: candidateUserId,
      }
      return
    }
    if (candidate.revision <= 0) return
    // The hook snapshot can be older than storage when a sign-out or opt-out
    // is dispatched together with this update event. Recheck at the point of
    // the native call rather than notifying an account that already opted out.
    if (!readBrowserNotificationPreference(candidateUserId).effectiveEnabled)
      return
    candidate.outcome = "pending"
    const attempt: SystemNotificationAttempt = {
      controller: new AbortController(),
      version: candidateVersion,
      revision: candidate.revision,
      userId: candidateUserId,
    }
    systemAttempt.current = attempt
    void (async () => {
      const result = await showDesktopUpdateNotification(
        attempt.revision,
        attempt.controller.signal
      )
      if (systemAttempt.current === attempt) systemAttempt.current = null
      if (attempt.controller.signal.aborted) return
      const current = systemCandidate.current
      // A late result from an older revision may not claim, fail, or mark the
      // newer candidate shown.
      if (
        !current ||
        current.version !== attempt.version ||
        current.revision !== attempt.revision ||
        current.outcome !== "pending"
      )
        return
      if (result === "shown") {
        claimBrowserNotificationDelivery(candidateUserId, notificationId)
        current.outcome = "shown"
      } else if (result === "denied") {
        recordMacNotificationDenial(candidateUserId)
        current.outcome = "failed"
        systemFailedVersion.current = {
          version: candidateVersion,
          userId: candidateUserId,
        }
      } else if (result === "stale") {
        // Native dropped this revision (a check, account, or candidate change
        // raced the call). A later revision may retry; this version is not
        // marked failed.
        current.outcome = "stalled"
      } else if (result === "unsupported") {
        systemUnsupported.current = true
        current.outcome = "failed"
        systemFailedVersion.current = {
          version: candidateVersion,
          userId: candidateUserId,
        }
      } else {
        current.outcome = "failed"
        systemFailedVersion.current = {
          version: candidateVersion,
          userId: candidateUserId,
        }
      }
    })()
  }, [availableVersion, preference.effectiveEnabled, revision, status, userId])

  useEffect(
    () => () => {
      systemAttempt.current?.controller.abort()
      systemAttempt.current = null
    },
    []
  )

  return null
}
