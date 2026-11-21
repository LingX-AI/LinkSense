import { onWindowActive } from "mygo-runtime"
import { z } from "zod"

import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { Desktop } from "@/adapters/desktop/mygo"

export const computerPermissionKindSchema = z.enum([
  "accessibility",
  "screenRecording",
])

export type ComputerPermissionKind = z.infer<
  typeof computerPermissionKindSchema
>

const computerPermissionStatusSchema = z.enum([
  "granted",
  "notGranted",
  "notDetermined",
  "unknown",
])

const computerPermissionReasonSchema = z.enum([
  "checked",
  "granted",
  "closed",
  "canceled",
  "timedOut",
  "unknown",
  "failed",
  "unsupported",
  "notPackaged",
  "invalidKind",
])

// The native bridge returns only stable fields. An unexpected field, a kind
// that differs from the request, or an impossible status/reason pair is
// treated as a failure, never as a grant.
const nativeComputerPermissionResultSchema = z.strictObject({
  kind: computerPermissionKindSchema,
  status: computerPermissionStatusSchema,
  reason: computerPermissionReasonSchema,
})

export type ComputerPermissionReason = z.infer<
  typeof computerPermissionReasonSchema
>
export type ComputerPermissionResult = z.infer<
  typeof nativeComputerPermissionResultSchema
>

type ResultMode = "check" | "guide"

function unavailable(
  kind: ComputerPermissionKind,
  reason: ComputerPermissionReason
): ComputerPermissionResult {
  return { kind, status: "unknown", reason }
}

// The pinned Go bridge produces these exact status/reason pairs. Check reports
// a read only as "checked"; its gate and transport failures are notPackaged,
// unsupported, failed or invalidKind with unknown status. A Guide never reports
// "checked". Unavailable reasons always carry an unknown status. Anything else
// fails closed.
function isCheckResult(result: ComputerPermissionResult): boolean {
  switch (result.reason) {
    case "checked":
      return true
    case "notPackaged":
    case "unsupported":
    case "failed":
    case "invalidKind":
      return result.status === "unknown"
    default:
      return false
  }
}

function isGuideResult(result: ComputerPermissionResult): boolean {
  switch (result.reason) {
    case "granted":
      return result.status === "granted"
    case "closed":
      return (
        result.status === "notGranted" || result.status === "notDetermined"
      )
    case "canceled":
    case "timedOut":
      // The pinned macOS Guide ends a canceled wait with a final Check, so
      // Granted here is a real OS read; Windows Wait only reports its poll.
      return true
    case "unknown":
    case "failed":
    case "unsupported":
    case "notPackaged":
    case "invalidKind":
      return result.status === "unknown"
    default:
      return false
  }
}

function parseNativeResult(
  kind: ComputerPermissionKind,
  value: unknown,
  mode: ResultMode
): ComputerPermissionResult {
  const parsed = nativeComputerPermissionResultSchema.safeParse(value)
  if (!parsed.success || parsed.data.kind !== kind) {
    return unavailable(kind, "failed")
  }
  const valid =
    mode === "check"
      ? isCheckResult(parsed.data)
      : isGuideResult(parsed.data)
  return valid ? parsed.data : unavailable(kind, "failed")
}

function transportFailureReason(
  error: unknown,
  signal: AbortSignal
): ComputerPermissionReason {
  if (signal.aborted) return "canceled"
  // An older host rejects an unbound generated method with a CallError. It
  // cannot check or guide this permission, so the UI fails closed instead of
  // calling any System Settings path.
  const message = error instanceof Error ? error.message : ""
  return /\bis not bound\b/u.test(message) ? "unsupported" : "failed"
}

export async function checkComputerPermission(
  kind: ComputerPermissionKind,
  signal: AbortSignal
): Promise<ComputerPermissionResult> {
  if (!isMacDesktopHost()) return unavailable(kind, "unsupported")
  try {
    const value: unknown = await Desktop.checkComputerPermission.with({
      signal,
    })(kind)
    return parseNativeResult(kind, value, "check")
  } catch (error) {
    return unavailable(kind, transportFailureReason(error, signal))
  }
}

/**
 * Runs MyGo's native permission guide for the one required permission. The
 * caller aborts through the generated binding's `.with({ signal })`, which
 * cancels the native wait. The result is still a closed status/reason pair;
 * a guide that ends without a grant never becomes a grant here.
 */
export async function guideComputerPermission(
  kind: ComputerPermissionKind,
  signal: AbortSignal
): Promise<ComputerPermissionResult> {
  if (!isMacDesktopHost()) return unavailable(kind, "unsupported")
  try {
    const value: unknown = await Desktop.guideComputerPermission.with({
      signal,
    })(kind)
    return parseNativeResult(kind, value, "guide")
  } catch (error) {
    return unavailable(kind, transportFailureReason(error, signal))
  }
}

/**
 * Subscribes to MyGo's native window-active event on a macOS host. The runtime
 * returns its own unsubscribe function; outside the host, or on an older
 * runtime, the UI keeps only the visible DOM refresh and gets a no-op cleanup.
 */
export function subscribeDesktopWindowActive(
  listener: (active: boolean) => void
): () => void {
  if (!isMacDesktopHost()) return () => undefined
  try {
    return onWindowActive(listener)
  } catch {
    return () => undefined
  }
}

/**
 * Opens the matching System Settings page without the plugin panel. This is
 * the manual add fallback after the native guide reports a failure.
 */
export async function openComputerPermissionSettings(
  kind: ComputerPermissionKind
): Promise<boolean> {
  if (!isMacDesktopHost()) return false
  try {
    await Desktop.openComputerPermissionSettings(kind)
    return true
  } catch {
    return false
  }
}
