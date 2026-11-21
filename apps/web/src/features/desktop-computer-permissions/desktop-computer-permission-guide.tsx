import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

import {
  checkComputerPermission,
  guideComputerPermission,
  openComputerPermissionSettings,
  subscribeDesktopWindowActive,
  type ComputerPermissionKind,
  type ComputerPermissionReason,
  type ComputerPermissionResult,
} from "./computer-permission-adapter"

export type DesktopComputerPermissionGuideProps = Readonly<{
  /**
   * The one permission the task that opened this dialog needs. The native
   * bridge accepts no other kind.
   */
  kind: ComputerPermissionKind
  /**
   * The dialog is opened only by an explicit user action in a GUI task. No
   * check or guide runs while this is false, at startup, or on ordinary tasks.
   */
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Continues the task without GUI control. The guidance dialog never falls
   * back to a different execution mode by itself.
   */
  onContinueWithoutGui?: () => void
}>

// One read after returning from System Settings even when the native active
// event, window focus and visibility all report the return.
const windowActiveRefreshDelay = 150

function statusMessage(
  result: ComputerPermissionResult,
  permission: string,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  if (result.status === "granted") {
    return t("desktopComputerPermissions.statusGranted", { permission })
  }
  if (
    result.status === "notGranted" ||
    result.status === "notDetermined"
  ) {
    return t("desktopComputerPermissions.statusNotGranted", { permission })
  }
  switch (result.reason) {
    case "unsupported":
      return t("desktopComputerPermissions.statusUnsupported")
    case "notPackaged":
      return t("desktopComputerPermissions.statusNotPackaged")
    case "failed":
      return t("desktopComputerPermissions.statusFailed", { permission })
    default:
      return t("desktopComputerPermissions.statusUnknown", { permission })
  }
}

function guideMessage(
  reason: ComputerPermissionReason,
  permission: string,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  switch (reason) {
    case "canceled":
      return t("desktopComputerPermissions.guideCanceled")
    case "closed":
      return t("desktopComputerPermissions.guideClosed")
    case "timedOut":
      return t("desktopComputerPermissions.guideTimedOut")
    case "unknown":
      return t("desktopComputerPermissions.guideUnknown")
    case "failed":
      return t("desktopComputerPermissions.guideFailed")
    case "unsupported":
      return t("desktopComputerPermissions.statusUnsupported")
    case "notPackaged":
      return t("desktopComputerPermissions.statusNotPackaged")
    default:
      return t("desktopComputerPermissions.statusUnknown", { permission })
  }
}

/**
 * The permission step of a GUI task. It checks the one required macOS
 * permission on demand, offers a separately labelled action that runs MyGo's
 * native guide, and always reports only the native status. It is not mounted
 * at startup, login, ordinary tasks, or general Settings.
 */
export function DesktopComputerPermissionGuide({
  kind,
  open,
  onOpenChange,
  onContinueWithoutGui,
}: DesktopComputerPermissionGuideProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DesktopComputerPermissionDialog
          key={kind}
          kind={kind}
          onOpenChange={onOpenChange}
          onContinueWithoutGui={onContinueWithoutGui}
        />
      ) : null}
    </Dialog>
  )
}

type DesktopComputerPermissionDialogProps = Readonly<{
  kind: ComputerPermissionKind
  onOpenChange: (open: boolean) => void
  onContinueWithoutGui?: () => void
}>

// Mounted only while the dialog is open and keyed by the required permission.
// Closing or changing the permission unmounts it, which aborts the native
// waits and resets every per-opening value without an effect that resets
// state.
function DesktopComputerPermissionDialog({
  kind,
  onOpenChange,
  onContinueWithoutGui,
}: DesktopComputerPermissionDialogProps) {
  const { t } = useTranslation()
  const [checkGeneration, setCheckGeneration] = useState(0)
  const [guiding, setGuiding] = useState(false)
  const [manualState, setManualState] = useState<
    "idle" | "pending" | "failed"
  >("idle")
  const [restartConfirmed, setRestartConfirmed] = useState(false)
  const [view, setView] = useState<{
    result: ComputerPermissionResult
    // The last authoritative Check permits the two settings actions. A later
    // failed or malformed Check clears it; a Guide outcome never sets it.
    check: ComputerPermissionResult | null
    guideOutcome: ComputerPermissionReason | null
  } | null>(null)
  const guideController = useRef<AbortController | null>(null)
  const requestSequence = useRef(0)
  const mounted = useRef(true)
  const refreshTimer = useRef<number | null>(null)

  const permission = t(`desktopComputerPermissions.${kind}`)
  const result = view?.result ?? null
  const lastCheck = view?.check ?? null
  const guideOutcome = view?.guideOutcome ?? null
  const granted = result?.status === "granted"
  const unavailable =
    result?.reason === "unsupported" ||
    result?.reason === "notPackaged" ||
    guideOutcome === "unsupported" ||
    guideOutcome === "notPackaged"
  // Only a successful read-only Check for this opening, with a running layout
  // that Guide and manual Settings can act on, admits either action.
  const admitted =
    lastCheck !== null &&
    lastCheck.status !== "granted" &&
    !granted &&
    !unavailable
  const showActions = admitted && !guiding
  const manualPending = manualState === "pending"
  const manualError = manualState === "failed"

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      guideController.current?.abort()
      guideController.current = null
    }
  }, [])

  // Check is read-only and never prompts. Only the latest started request may
  // update the status, for both this Check and the Guide below.
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const sequence = ++requestSequence.current
    void checkComputerPermission(kind, controller.signal).then((next) => {
      if (!active || sequence !== requestSequence.current) return
      // A newer confirmed grant ends a pending guide wait immediately.
      if (next.status === "granted") {
        const pendingGuide = guideController.current
        if (pendingGuide) {
          guideController.current = null
          pendingGuide.abort()
          setGuiding(false)
        }
      }
      setView((previous) => ({
        result: next,
        check: next.reason === "checked" ? next : null,
        // Keep a guide closure/failure only while this Check still confirms
        // the permission is not granted. A failure or grant clears it.
        guideOutcome:
          next.status === "granted" || next.reason !== "checked"
            ? null
            : (previous?.guideOutcome ?? null),
      }))
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [checkGeneration, kind])

  // Refresh after returning from System Settings. Native window activity,
  // window focus and visibility can all report the same return; one timer
  // coalesces them into a single read. It never reopens the guide.
  useEffect(() => {
    const scheduleRefresh = () => {
      if (
        document.visibilityState !== "visible" ||
        refreshTimer.current !== null
      ) {
        return
      }
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null
        if (mounted.current) {
          setCheckGeneration((value) => value + 1)
        }
      }, windowActiveRefreshDelay)
    }
    const unsubscribeWindowActive = subscribeDesktopWindowActive((active) => {
      if (active) scheduleRefresh()
    })
    const onFocus = () => scheduleRefresh()
    const onVisibilityChange = () => scheduleRefresh()
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      unsubscribeWindowActive()
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current)
        refreshTimer.current = null
      }
    }
  }, [])

  async function startGuide() {
    if (!admitted || guiding || manualPending) return
    const sequence = ++requestSequence.current
    const controller = new AbortController()
    guideController.current = controller
    setGuiding(true)
    setView((previous) =>
      previous ? { ...previous, guideOutcome: null } : previous
    )
    setManualState("idle")
    try {
      const next = await guideComputerPermission(kind, controller.signal)
      if (
        !mounted.current ||
        controller.signal.aborted ||
        sequence !== requestSequence.current
      ) {
        return
      }
      setView((previous) => ({
        result: next,
        check: previous?.check ?? null,
        guideOutcome: next.status === "granted" ? null : next.reason,
      }))
    } finally {
      if (mounted.current && guideController.current === controller) {
        guideController.current = null
        setGuiding(false)
      }
    }
  }

  function cancelGuide() {
    if (!guiding) return
    // Aborting the guide already invalidates its own reply. Do not advance the
    // shared sequence: a newer focus Check must keep its authority.
    const controller = guideController.current
    guideController.current = null
    controller?.abort()
    setGuiding(false)
    setView((previous) =>
      previous ? { ...previous, guideOutcome: "canceled" } : previous
    )
  }

  async function openSettings() {
    if (!admitted || guiding || manualPending) return
    setManualState("pending")
    const opened = await openComputerPermissionSettings(kind)
    if (!mounted.current) return
    setManualState(opened ? "idle" : "failed")
  }

  const checking = view === null
  const showRestart =
    admitted &&
    !guiding &&
    kind === "screenRecording" &&
    result !== null &&
    (result.status === "notGranted" || result.status === "notDetermined")
  const message = granted
    ? statusMessage(result, permission, t)
    : guideOutcome !== null
      ? guideMessage(guideOutcome, permission, t)
      : result !== null
        ? statusMessage(result, permission, t)
        : t("desktopComputerPermissions.checking", { permission })

  return (
    <DialogContent closeLabel={t("desktopComputerPermissions.close")}>
      <DialogHeader>
        <DialogTitle>
          {t("desktopComputerPermissions.title", { permission })}
        </DialogTitle>
        <DialogDescription>
          {t(`desktopComputerPermissions.${kind}Description`)}
        </DialogDescription>
      </DialogHeader>

      <div className="grid min-w-0 gap-4">
        <p
          role="status"
          aria-atomic="true"
          data-slot="desktop-computer-permission-status"
          data-status={result?.status ?? "unknown"}
          className="flex min-w-0 items-center gap-2 text-sm text-foreground"
        >
          {checking && !guiding ? (
            <Spinner className="shrink-0 motion-reduce:animate-none" />
          ) : null}
          <span>{message}</span>
        </p>

        {guiding ? (
          <div className="grid min-w-0 gap-2">
            <p className="form-hint">
              {t("desktopComputerPermissions.waiting")}
            </p>
            <Button type="button" variant="outline" onClick={cancelGuide}>
              {t("desktopComputerPermissions.cancelGuide")}
            </Button>
          </div>
        ) : showActions ? (
          <div className="grid min-w-0 gap-2">
            <Button
              type="button"
              disabled={manualPending}
              onClick={() => void startGuide()}
            >
              {t("desktopComputerPermissions.guideAction")}
            </Button>
            <p className="form-hint">
              {t("desktopComputerPermissions.guideHint")}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={manualPending}
              onClick={() => void openSettings()}
            >
              {t("desktopComputerPermissions.manualAction")}
            </Button>
            <p className="form-hint">
              {t("desktopComputerPermissions.manualHint")}
            </p>
            {manualError ? (
              <p className="text-sm text-destructive">
                {t("desktopComputerPermissions.manualFailed")}
              </p>
            ) : null}
          </div>
        ) : null}

        {showRestart ? (
          <div
            className="grid min-w-0 gap-2 rounded-xl border border-border p-3"
            data-slot="desktop-computer-permission-restart"
          >
            {restartConfirmed ? (
              <p className="text-sm text-muted-foreground">
                {t("desktopComputerPermissions.restartHint")}
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => setRestartConfirmed(true)}
              >
                {t("desktopComputerPermissions.restartConfirm")}
              </Button>
            )}
          </div>
        ) : null}

        {!guiding ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setCheckGeneration((value) => value + 1)}
          >
            {t("desktopComputerPermissions.checkAgain")}
          </Button>
        ) : null}
      </div>

      <DialogFooter>
        {onContinueWithoutGui ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onContinueWithoutGui()
              onOpenChange(false)
            }}
          >
            {t("desktopComputerPermissions.continueWithoutGui")}
          </Button>
        ) : null}
        <DialogClose render={<Button variant="secondary" />}>
          {t("desktopComputerPermissions.close")}
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  )
}
