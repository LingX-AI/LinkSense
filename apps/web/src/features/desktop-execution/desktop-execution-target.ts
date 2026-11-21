import type { ConversationExecutionTarget } from "@linksense/shared"

import type { DesktopDeviceStatus } from "@/adapters/desktop/desktop-device-adapter"

export type DesktopExecutionDeviceAvailability =
  | Readonly<{ kind: "ready"; deviceId: string }>
  | Readonly<{ kind: "checking" }>
  | Readonly<{
      kind: "unavailable"
      reason:
        | "connecting"
        | "offline"
        | "unpaired"
        | "revoked"
        | "not_ready"
        | "status_unavailable"
    }>

export type DesktopExecutionAvailabilityMessageKey =
  | "desktopExecution.deviceChecking"
  | "desktopExecution.deviceConnecting"
  | "desktopExecution.deviceOffline"
  | "desktopExecution.deviceUnpaired"
  | "desktopExecution.deviceRevoked"
  | "desktopExecution.deviceNotReady"
  | "desktopExecution.deviceStatusUnavailable"

// The device-settings lane owns the section behind this anchor; only Mac
// clients render it, and local execution is unavailable anywhere else.
export const desktopDeviceSettingsHref =
  "/settings/general#desktop-devices-heading"

export function desktopExecutionDeviceAvailability(
  status: DesktopDeviceStatus | undefined
): DesktopExecutionDeviceAvailability {
  if (!status) return { kind: "checking" }
  if (status.state === "online") {
    // A missing executionReady comes from an older host and must fail closed.
    return status.deviceId && status.executionReady === true
      ? { kind: "ready", deviceId: status.deviceId }
      : { kind: "unavailable", reason: "not_ready" }
  }
  return { kind: "unavailable", reason: status.state }
}

/**
 * Query-aware availability. TanStack keeps the last successful data through a
 * failed background refetch, so an error must fail closed instead of trusting
 * a stale ready value. A first failure must not look like loading forever.
 */
export function desktopExecutionDeviceQueryAvailability(query: {
  data: DesktopDeviceStatus | undefined
  isError: boolean
}): DesktopExecutionDeviceAvailability {
  return query.isError
    ? { kind: "unavailable", reason: "status_unavailable" }
    : desktopExecutionDeviceAvailability(query.data)
}

export function desktopExecutionLocalDeviceId(
  target: ConversationExecutionTarget,
  availability: DesktopExecutionDeviceAvailability
): string | undefined {
  return target === "local" && availability.kind === "ready"
    ? availability.deviceId
    : undefined
}

export type DesktopExecutionFreshDeviceCheck =
  "ready" | "unavailable" | "changed"

/** Validate a fresh native read against the device selected for this task. */
export function desktopExecutionFreshDeviceCheck(
  expectedDeviceId: string,
  status: DesktopDeviceStatus
): DesktopExecutionFreshDeviceCheck {
  if (status.state !== "online" || status.executionReady !== true) {
    return "unavailable"
  }
  return status.deviceId === expectedDeviceId ? "ready" : "changed"
}

/** The picker belongs only to a fresh task in the main macOS window. */
export function shouldOfferDesktopExecutionTarget(input: {
  isNew: boolean
  showComposer: boolean
  hasUser: boolean
  isMacDesktopHost: boolean
  embedded: boolean
  development: boolean
  isApplicationConversation: boolean
}): boolean {
  return (
    input.isNew &&
    input.showComposer &&
    input.hasUser &&
    input.isMacDesktopHost &&
    !input.embedded &&
    !input.development &&
    !input.isApplicationConversation
  )
}

type UnavailableReason = Extract<
  DesktopExecutionDeviceAvailability,
  { kind: "unavailable" }
>["reason"]

const availabilityMessages: Record<
  UnavailableReason,
  DesktopExecutionAvailabilityMessageKey
> = {
  connecting: "desktopExecution.deviceConnecting",
  offline: "desktopExecution.deviceOffline",
  unpaired: "desktopExecution.deviceUnpaired",
  revoked: "desktopExecution.deviceRevoked",
  not_ready: "desktopExecution.deviceNotReady",
  status_unavailable: "desktopExecution.deviceStatusUnavailable",
}

export function desktopExecutionAvailabilityMessageKey(
  availability: DesktopExecutionDeviceAvailability
): DesktopExecutionAvailabilityMessageKey | null {
  if (availability.kind === "ready") return null
  return availability.kind === "checking"
    ? "desktopExecution.deviceChecking"
    : availabilityMessages[availability.reason]
}
