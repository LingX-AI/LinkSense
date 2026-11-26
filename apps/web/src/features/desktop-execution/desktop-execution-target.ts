import type { ConversationExecutionTarget } from "@linksense/shared"

import type { DesktopDeviceStatus } from "@/adapters/desktop/desktop-device-adapter"
import type { BootstrapStatus } from "@/api/contracts"

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
        | "local_computer_disabled"
        | "status_unavailable"
    }>

export type DesktopExecutionAvailabilityMessageKey =
  | "desktopExecution.deviceChecking"
  | "desktopExecution.deviceConnecting"
  | "desktopExecution.deviceOffline"
  | "desktopExecution.deviceUnpaired"
  | "desktopExecution.deviceRevoked"
  | "desktopExecution.deviceNotReady"
  | "desktopExecution.localComputerUnavailable"
  | "desktopExecution.deviceStatusUnavailable"

/**
 * Deployment-wide rollout policy discovered through the existing bootstrap
 * payload. Both fields keep legacy behavior when absent: cloud stays the
 * default, and local availability is decided by the native device status.
 */
export type DesktopExecutionTargetPolicy = Readonly<{
  /** New local tasks need this rollout flag and an existing ready device. */
  localComputer: boolean
  /** Mac new-task cloud entry only; not a server-side cloud kill switch. */
  cloudTarget: boolean
}>

export function desktopExecutionTargetPolicy(
  bootstrap: Pick<BootstrapStatus, "desktop"> | undefined
): DesktopExecutionTargetPolicy {
  return {
    localComputer: bootstrap?.desktop?.local_computer ?? true,
    cloudTarget: bootstrap?.desktop?.cloud_target ?? true,
  }
}

// The device-settings lane owns the section behind this anchor; only Mac
// clients render it, and local execution is unavailable anywhere else.
export const desktopDeviceSettingsHeadingId = "desktop-devices-heading"
export const desktopDeviceSettingsHref =
  `/settings/general#${desktopDeviceSettingsHeadingId}` as const

// The default-run-location row shares the device-settings card, so it needs its
// own hash target to stay a distinct first-run destination.
export const desktopExecutionDefaultTargetAnchorId = "desktop-default-target"
export const desktopExecutionDefaultTargetHref =
  `/settings/general#${desktopExecutionDefaultTargetAnchorId}` as const

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

/**
 * A rollout flag off hides local for new tasks even while the device is ready;
 * the flag-on path keeps the existing native readiness rules untouched.
 */
export function desktopExecutionGatedDeviceAvailability(
  availability: DesktopExecutionDeviceAvailability,
  localComputerEnabled: boolean
): DesktopExecutionDeviceAvailability {
  return localComputerEnabled
    ? availability
    : { kind: "unavailable", reason: "local_computer_disabled" }
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

export type DesktopExecutionContinuationDeviceCheck =
  | Readonly<{ kind: "ready"; deviceId: string }>
  | Readonly<{
      kind: "unavailable" | "changed" | "reference_unavailable"
    }>

/**
 * Starting a new local task from a cloud task additionally needs the exact
 * negotiated reference read. Execution readiness alone cannot seed the source
 * reference, so an old Mac fails closed here. The first read supplies the
 * expected device; a retry must still see the same device.
 */
export function desktopExecutionContinuationDeviceCheck(
  expectedDeviceId: string | undefined,
  status: DesktopDeviceStatus
): DesktopExecutionContinuationDeviceCheck {
  if (
    status.state !== "online" ||
    status.executionReady !== true ||
    !status.deviceId
  ) {
    return { kind: "unavailable" }
  }
  if (status.conversationReferenceReadReady !== true) {
    return { kind: "reference_unavailable" }
  }
  return expectedDeviceId && status.deviceId !== expectedDeviceId
    ? { kind: "changed" }
    : { kind: "ready", deviceId: status.deviceId }
}

export function desktopContinuationDestination(
  sourceTarget: ConversationExecutionTarget
): ConversationExecutionTarget {
  return sourceTarget === "local" ? "cloud" : "local"
}

/** The continuation entry belongs only to a normal main Mac task view. */
export function shouldOfferDesktopContinuation(input: {
  isNew: boolean
  showConversationActions: boolean
  hasUser: boolean
  isMacDesktopHost: boolean
  embedded: boolean
  development: boolean
  readOnly: boolean
  archived: boolean
  application: boolean
}): boolean {
  return (
    !input.isNew &&
    input.showConversationActions &&
    input.hasUser &&
    input.isMacDesktopHost &&
    !input.embedded &&
    !input.development &&
    !input.readOnly &&
    !input.archived &&
    !input.application
  )
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
  local_computer_disabled: "desktopExecution.localComputerUnavailable",
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
