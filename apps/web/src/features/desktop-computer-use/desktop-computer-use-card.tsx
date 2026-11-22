import {
  CircleAlertIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  CircleStopIcon,
  Clock3Icon,
  LoaderCircleIcon,
  MonitorIcon,
} from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { uuidSchema, type ConversationExecutionTarget } from "@linksense/shared"

import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
  checkComputerPermission,
  type ComputerPermissionReason,
} from "@/features/desktop-computer-permissions/computer-permission-adapter"
import { DesktopComputerPermissionGuide } from "@/features/desktop-computer-permissions/desktop-computer-permission-guide"
import { useDesktopDeviceStatus } from "@/features/desktop-devices/use-desktop-device-status"
import { cn } from "@/lib/utils"

import type {
  ComputerControlFailureCode,
  ComputerControlState,
} from "./computer-control-adapter"
import { useDesktopComputerControl } from "./use-desktop-computer-control"

export type DesktopComputerUseCardProps = Readonly<{
  /** The signed-in account that owns the native device status. */
  ownerId?: string
  conversationId: string
  /** Only the persisted running turn is passed; optimistic ids never are. */
  turnId: string
  /** The device persisted on the local conversation; controls need it to show. */
  deviceId?: string | null
  executionTarget?: ConversationExecutionTarget
}>

type DisplayState = ComputerControlState | "expired" | null

type PermissionFailure = Extract<
  ComputerPermissionReason,
  "failed" | "unsupported" | "notPackaged" | "invalidKind"
>

const countdownTickMs = 1_000

/**
 * The in-chat Computer Use card for the current local running turn. The outer
 * component withholds every control until the native device negotiated
 * `computerReady`; it never reads TCC. The panel is keyed by conversation,
 * turn, and device so a stale bridge reply cannot leak into another turn.
 */
export function DesktopComputerUseCard({
  ownerId,
  conversationId,
  turnId,
  deviceId,
  executionTarget,
}: DesktopComputerUseCardProps) {
  if (executionTarget !== "local") return null
  return (
    <DesktopComputerUseCardHost
      ownerId={ownerId}
      conversationId={conversationId}
      turnId={turnId}
      deviceId={deviceId}
    />
  )
}

function DesktopComputerUseCardHost({
  ownerId,
  conversationId,
  turnId,
  deviceId,
}: DesktopComputerUseCardProps) {
  const macHost = isMacDesktopHost()
  const parsedOwnerId = ownerId ? uuidSchema.safeParse(ownerId) : null
  const owner = parsedOwnerId?.success ? parsedOwnerId.data : undefined
  const deviceStatus = useDesktopDeviceStatus(macHost ? owner : undefined)
  const scopeValid =
    uuidSchema.safeParse(conversationId).success &&
    uuidSchema.safeParse(turnId).success
  const persistedDevice = deviceId ? uuidSchema.safeParse(deviceId) : null
  const status = deviceStatus.data
  const currentDeviceId = status?.deviceId

  if (!macHost || !owner || !scopeValid) return null
  // The conversation's persisted device is required. Without it the card cannot
  // prove that this Mac owns the local turn, so no control is shown.
  if (!persistedDevice?.success) return null
  if (!status || deviceStatus.isError) return null
  if (status.state !== "online" || status.computerReady !== true) return null
  if (
    !currentDeviceId ||
    currentDeviceId.toLowerCase() !== persistedDevice.data.toLowerCase()
  ) {
    return null
  }

  return (
    <DesktopComputerUsePanel
      key={`${owner}:${conversationId}:${turnId}:${currentDeviceId}`}
      ownerId={owner}
      conversationId={conversationId}
      turnId={turnId}
      deviceId={currentDeviceId}
    />
  )
}

function DesktopComputerUsePanel({
  ownerId,
  conversationId,
  turnId,
  deviceId,
}: Readonly<{
  ownerId: string
  conversationId: string
  turnId: string
  deviceId: string
}>) {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [permissionPending, setPermissionPending] = useState(false)
  const [permissionFailure, setPermissionFailure] =
    useState<PermissionFailure | null>(null)
  const activeRef = useRef(true)
  const permissionControllerRef = useRef<AbortController | null>(null)
  const selectionPendingRef = useRef(false)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      permissionControllerRef.current?.abort()
      permissionControllerRef.current = null
    }
  }, [])

  const control = useDesktopComputerControl({
    ownerId,
    conversationId,
    turnId,
    deviceId,
  })
  const outcome = control.status.data
  const stateResult = outcome?.kind === "state" ? outcome : null
  const statusFailure =
    outcome?.kind === "failure" && outcome.code !== "canceled"
      ? outcome.code
      : null
  const expiresAt =
    stateResult?.state === "active" || stateResult?.state === "paused"
      ? stateResult.expiresAt
      : undefined
  const remainingMs = useRemainingMs(expiresAt)
  const expired = remainingMs === 0
  const displayState: DisplayState = expired
    ? "expired"
    : (stateResult?.state ?? null)
  const queryFailed = control.status.isError
  const failureCode = control.feedback ?? statusFailure
  const needsFreshStatus = failureCode === "stale_scope"
  const busy = permissionPending || control.pendingAction !== null
  const checking = displayState === null && !statusFailure && !queryFailed
  const canSelect =
    !needsFreshStatus &&
    (displayState === "idle" ||
      displayState === "stopped" ||
      displayState === "expired")
  const canPause = !needsFreshStatus && displayState === "active"
  const canResume = !needsFreshStatus && displayState === "paused"
  // Renewal extends only the live grant; paused, expired, stopped, and idle
  // states must use their own explicit action instead.
  const canRenew = !needsFreshStatus && displayState === "active"
  const canStop =
    !needsFreshStatus &&
    (displayState === "active" || displayState === "paused")

  async function startSelection() {
    if (selectionPendingRef.current || control.pendingAction !== null) {
      return
    }
    selectionPendingRef.current = true
    setPermissionPending(true)
    setPermissionFailure(null)
    const controller = new AbortController()
    permissionControllerRef.current?.abort()
    permissionControllerRef.current = controller
    try {
      // Read-only: Check never prompts. Only the permission guide's explicit
      // action opens System Settings, and Screen Recording is never requested
      // because this card never captures the screen.
      const result = await checkComputerPermission(
        "accessibility",
        controller.signal
      )
      if (!activeRef.current || controller.signal.aborted) return
      if (result.status === "granted") {
        control.run("select")
        return
      }
      if (result.reason === "checked") {
        // MyGo's native guide presents the approval and System Settings steps.
        // React never renders Allow/Cancel options or lists windows.
        setPermissionOpen(true)
        return
      }
      if (
        result.reason === "failed" ||
        result.reason === "unsupported" ||
        result.reason === "notPackaged" ||
        result.reason === "invalidKind"
      ) {
        setPermissionFailure(result.reason)
      }
    } finally {
      if (activeRef.current) setPermissionPending(false)
      selectionPendingRef.current = false
    }
  }

  const statusLabel = checking
    ? t("desktopComputerUse.statusChecking")
    : displayState === "active"
      ? t("desktopComputerUse.statusActive")
      : displayState === "paused"
        ? t("desktopComputerUse.statusPaused")
        : displayState === "retiring"
          ? t("desktopComputerUse.statusRetiring")
          : displayState === "stopped"
            ? t("desktopComputerUse.statusStopped")
            : displayState === "expired"
              ? t("desktopComputerUse.statusExpired")
              : displayState === "idle"
                ? t("desktopComputerUse.statusIdle")
                : t("desktopComputerUse.statusUnavailable")
  const description = checking
    ? t("desktopComputerUse.checking")
    : displayState === "active"
      ? t("desktopComputerUse.descriptionActive")
      : displayState === "paused"
        ? t("desktopComputerUse.descriptionPaused")
        : displayState === "retiring"
          ? t("desktopComputerUse.descriptionRetiring")
          : displayState === "stopped"
            ? t("desktopComputerUse.descriptionStopped")
            : displayState === "expired"
              ? t("desktopComputerUse.descriptionExpired")
              : displayState === "idle"
                ? t("desktopComputerUse.descriptionIdle")
                : t("desktopComputerUse.descriptionUnavailable")
  const errorMessage = permissionFailure
    ? permissionFailureMessage(permissionFailure, t)
    : failureCode
      ? failureMessage(failureCode, t)
      : queryFailed
        ? t("desktopComputerUse.errorFailed")
        : null
  const showCountdown =
    (displayState === "active" || displayState === "paused") &&
    remainingMs !== null &&
    remainingMs > 0 &&
    expiresAt !== undefined
  const StatusIcon = checking
    ? LoaderCircleIcon
    : displayState === "active"
      ? CircleCheckIcon
      : displayState === "paused"
        ? CirclePauseIcon
        : displayState === "retiring"
          ? LoaderCircleIcon
          : displayState === "stopped"
            ? CircleStopIcon
            : displayState === "expired"
              ? Clock3Icon
              : displayState === "idle"
                ? MonitorIcon
                : CircleAlertIcon
  const showActions =
    canSelect ||
    canPause ||
    canResume ||
    canRenew ||
    canStop ||
    Boolean(statusFailure || queryFailed || needsFreshStatus)

  return (
    <>
      <Card
        size="sm"
        role="region"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        data-testid="desktop-computer-use-card"
        data-state={displayState ?? "checking"}
        className="mr-auto w-full max-w-xl data-[size=sm]:[--card-spacing:--spacing(3)]"
      >
        <CardHeader className="shrink-0">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <CardTitle
              id={titleId}
              role="heading"
              aria-level={3}
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              <MonitorIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {t("desktopComputerUse.title")}
            </CardTitle>
            <Badge
              variant="secondary"
              className="shrink-0 rounded-full"
              role="status"
              aria-atomic="true"
              data-testid="desktop-computer-use-status"
            >
              <StatusIcon
                data-icon="inline-start"
                className={cn(
                  (checking || displayState === "retiring") &&
                    "animate-spin motion-reduce:animate-none"
                )}
                aria-hidden="true"
              />
              {statusLabel}
            </Badge>
          </div>
          <CardDescription className="min-w-0 text-xs leading-4">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {showCountdown && expiresAt !== undefined && remainingMs !== null && (
            <p className="text-xs text-muted-foreground">
              <time
                dateTime={expiresAt}
                data-testid="desktop-computer-use-countdown"
              >
                {t("desktopComputerUse.expiresIn", {
                  time: formatRemaining(remainingMs, i18n.language),
                })}
              </time>
            </p>
          )}
          {(displayState === "idle" ||
            displayState === "stopped" ||
            displayState === "expired") && (
            <p className="text-xs leading-4 text-muted-foreground">
              {t("desktopComputerUse.windowHint")}
            </p>
          )}
          {(displayState === "active" || displayState === "paused") && (
            <p className="text-xs leading-4 text-muted-foreground">
              {t("desktopComputerUse.controlHint")}
            </p>
          )}
          {(permissionPending || control.pendingAction === "select") && (
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="text-xs leading-4 text-muted-foreground"
            >
              {permissionPending
                ? t("desktopComputerUse.permissionChecking")
                : t("desktopComputerUse.selecting")}
            </p>
          )}
          {errorMessage && (
            <p
              role="alert"
              aria-atomic="true"
              className="text-sm text-destructive"
              data-testid="desktop-computer-use-error"
            >
              {errorMessage}
            </p>
          )}
        </CardContent>
        {showActions && (
          <CardFooter className="flex-wrap justify-end gap-1.5">
            {canSelect && (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void startSelection()}
              >
                {(permissionPending || control.pendingAction === "select") && (
                  <Spinner
                    data-icon="inline-start"
                    className="motion-reduce:animate-none"
                  />
                )}
                {t("desktopComputerUse.selectAction")}
              </Button>
            )}
            {canPause && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => control.run("pause")}
              >
                {control.pendingAction === "pause" ? (
                  <>
                    <Spinner
                      data-icon="inline-start"
                      className="motion-reduce:animate-none"
                    />
                    {t("desktopComputerUse.pausing")}
                  </>
                ) : (
                  t("desktopComputerUse.pauseAction")
                )}
              </Button>
            )}
            {canResume && (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => control.run("resume")}
              >
                {control.pendingAction === "resume" ? (
                  <>
                    <Spinner
                      data-icon="inline-start"
                      className="motion-reduce:animate-none"
                    />
                    {t("desktopComputerUse.resuming")}
                  </>
                ) : (
                  t("desktopComputerUse.resumeAction")
                )}
              </Button>
            )}
            {canRenew && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => control.run("renew")}
              >
                {control.pendingAction === "renew" ? (
                  <>
                    <Spinner
                      data-icon="inline-start"
                      className="motion-reduce:animate-none"
                    />
                    {t("desktopComputerUse.renewing")}
                  </>
                ) : (
                  t("desktopComputerUse.renewAction")
                )}
              </Button>
            )}
            {canStop && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                // Native Stop cancels the exact-scope renewal wait and closes
                // input synchronously, so it stays available while that one
                // renewal is pending. Every other pending action blocks it.
                disabled={busy && control.pendingAction !== "renew"}
                onClick={() => control.run("stop")}
              >
                {control.pendingAction === "stop" ? (
                  <>
                    <Spinner
                      data-icon="inline-start"
                      className="motion-reduce:animate-none"
                    />
                    {t("desktopComputerUse.stopping")}
                  </>
                ) : (
                  t("desktopComputerUse.stopAction")
                )}
              </Button>
            )}
            {(statusFailure || queryFailed || needsFreshStatus) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={control.status.isFetching}
                onClick={() => {
                  control.clearFeedback()
                  void control.status.refetch()
                }}
              >
                {t("desktopComputerUse.retry")}
              </Button>
            )}
          </CardFooter>
        )}
      </Card>
      <DesktopComputerPermissionGuide
        kind="accessibility"
        open={permissionOpen}
        onOpenChange={setPermissionOpen}
        onContinueWithoutGui={() => setPermissionOpen(false)}
      />
    </>
  )
}

/**
 * The grant still expires while paused, so the remaining time is passive text
 * that updates once per second rather than a live region. `now` begins at
 * mount and is refreshed only by the interval to avoid a synchronous state
 * write inside the effect.
 */
function useRemainingMs(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const interval = window.setInterval(
      () => setNow(Date.now()),
      countdownTickMs
    )
    return () => window.clearInterval(interval)
  }, [expiresAt])
  if (!expiresAt) return null
  const expiresAtMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresAtMs)) return null
  return Math.max(0, expiresAtMs - now)
}

function formatRemaining(remainingMs: number, locale: string): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const format = new Intl.NumberFormat(locale, {
    minimumIntegerDigits: 2,
    useGrouping: false,
  })
  return `${format.format(minutes)}:${format.format(seconds)}`
}

function permissionFailureMessage(
  failure: PermissionFailure,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  if (failure === "unsupported") {
    return t("desktopComputerUse.permissionUnsupported")
  }
  if (failure === "notPackaged") {
    return t("desktopComputerUse.permissionNotPackaged")
  }
  return t("desktopComputerUse.permissionFailed")
}

function failureMessage(
  code: ComputerControlFailureCode,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  switch (code) {
    case "busy":
      return t("desktopComputerUse.errorBusy")
    case "timeout":
      return t("desktopComputerUse.errorTimeout")
    case "forbidden":
      return t("desktopComputerUse.errorForbidden")
    case "target_changed":
      return t("desktopComputerUse.errorTargetChanged")
    case "stale_scope":
      return t("desktopComputerUse.errorStaleScope")
    case "unavailable":
      return t("desktopComputerUse.errorUnavailable")
    case "unsupported":
      return t("desktopComputerUse.errorUnsupported")
    case "invalid_response":
      return t("desktopComputerUse.errorInvalidResponse")
    case "invalid_scope":
    case "failed":
    case "canceled":
      return t("desktopComputerUse.errorFailed")
  }
}
