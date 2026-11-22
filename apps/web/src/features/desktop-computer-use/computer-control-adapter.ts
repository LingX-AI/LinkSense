import { uuidSchema } from "@linksense/shared"
import { z } from "zod"

import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { Desktop } from "@/adapters/desktop/mygo"

/**
 * The closed set of actions the Mac lane accepts. `select` opens MyGo's native
 * window picker; `renew` extends only the current active selection after an
 * explicit click, without reopening the picker or changing the target. The
 * WebView never receives a window list, a target, a screenshot, or an
 * Allow/Cancel choice. The existing native `requestUserInput` card remains the
 * only approval presentation.
 */
export const computerControlActions = [
  "select",
  "pause",
  "resume",
  "renew",
  "stop",
  "status",
] as const
export const computerControlActionSchema = z.enum(computerControlActions)
export type ComputerControlAction = z.infer<typeof computerControlActionSchema>

export const computerControlStates = [
  "unavailable",
  "idle",
  "active",
  "paused",
  "retiring",
  "stopped",
] as const
export const computerControlStateSchema = z.enum(computerControlStates)
export type ComputerControlState = z.infer<typeof computerControlStateSchema>

// The native result is exactly `{state, expiresAt?}`. An unexpected field, an
// unknown state, a non-ISO expiry, a retirement outside a status read, or an
// active/paused state without an expiry is a bounded failure, never an active
// grant.
const computerControlResultSchema = z.strictObject({
  state: computerControlStateSchema,
  expiresAt: z.iso.datetime({ offset: true }).optional(),
})

/**
 * The only failure shapes the card may render. Go errors cross the bridge as
 * `CallError` messages, so the closed native mapping below is the complete
 * input; unknown text never reaches the user.
 */
export type ComputerControlFailureCode =
  | "unavailable"
  | "busy"
  | "canceled"
  | "timeout"
  | "forbidden"
  | "target_changed"
  | "stale_scope"
  | "unsupported"
  | "invalid_response"
  | "invalid_scope"
  | "failed"

// The public errors of computer_control.go and computer_control_darwin.go in
// the Mac lane. The bridge rejects with the Go error text unchanged, so the
// match is exact. COMPUTER_INVALID means the requested scope no longer matches
// the native selection; DESKTOP_UPDATE_REQUIRED and an unbound method both
// need an app update. COMPUTER_CANCELED is quiet in the UI.
const nativeFailureMessages: ReadonlyMap<string, ComputerControlFailureCode> =
  new Map([
    ["COMPUTER_UNAVAILABLE", "unavailable"],
    ["COMPUTER_INVALID", "stale_scope"],
    ["COMPUTER_BUSY", "busy"],
    ["COMPUTER_CANCELED", "canceled"],
    ["COMPUTER_TIMEOUT", "timeout"],
    ["FORBIDDEN", "forbidden"],
    ["DEVICE_BUSY", "busy"],
    ["COMPUTER_TARGET_CHANGED", "target_changed"],
    ["DESKTOP_UPDATE_REQUIRED", "unsupported"],
  ])

export type ComputerControlOutcome =
  | Readonly<{
      kind: "state"
      state: ComputerControlState
      expiresAt?: string
    }>
  | Readonly<{ kind: "failure"; code: ComputerControlFailureCode }>

export type ComputerControlScope = Readonly<{
  conversationId: string
  turnId: string
  /**
   * The persisted local device id. The native lane resolves the current device
   * from the running task and does not receive this id; it is required here so
   * a card without the conversation's device can never call the bridge or
   * reuse another device's control state.
   */
  deviceId: string
}>

function failure(code: ComputerControlFailureCode): ComputerControlOutcome {
  return { kind: "failure", code }
}

function parseNativeResult(
  value: unknown,
  action: ComputerControlAction
): ComputerControlOutcome {
  const parsed = computerControlResultSchema.safeParse(value)
  if (!parsed.success) return failure("invalid_response")
  const { state, expiresAt } = parsed.data
  // A status read of the exact live scope may report that input is closed
  // while the exact executor retires. It is not a grant: it has no expiry and
  // no action may treat it as a positive acknowledgement.
  if (state === "retiring") {
    if (action !== "status" || expiresAt !== undefined) {
      return failure("invalid_response")
    }
    return { kind: "state", state }
  }
  // An active or paused grant is bounded by the server's expiry. A result
  // without one cannot show a countdown or prove the grant is live, so it
  // fails closed instead of activating controls.
  if ((state === "active" || state === "paused") && expiresAt === undefined) {
    return failure("invalid_response")
  }
  return {
    kind: "state",
    state,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }
}

function transportFailure(
  error: unknown,
  signal: AbortSignal
): ComputerControlFailureCode {
  if (signal.aborted) return "canceled"
  const message = error instanceof Error ? error.message : ""
  if (/\bis not bound\b/u.test(message)) return "unsupported"
  return nativeFailureMessages.get(message) ?? "failed"
}

/**
 * Calls the Mac lane's single Computer Control method. Scope ids are validated
 * before the bridge call; an older host without the generated method reports
 * `unsupported`. The caller decides whether a late result still belongs to the
 * current conversation, turn, and device.
 */
export async function requestComputerControl(
  scope: ComputerControlScope,
  action: ComputerControlAction,
  signal: AbortSignal
): Promise<ComputerControlOutcome> {
  if (signal.aborted) return failure("canceled")
  if (!isMacDesktopHost()) return failure("unsupported")
  const conversationId = uuidSchema.safeParse(scope.conversationId)
  const turnId = uuidSchema.safeParse(scope.turnId)
  if (!conversationId.success || !turnId.success) {
    return failure("invalid_scope")
  }
  const parsedAction = computerControlActionSchema.safeParse(action)
  if (!parsedAction.success) return failure("invalid_response")
  try {
    const value: unknown = await Desktop.computerControl.with({ signal })(
      conversationId.data,
      turnId.data,
      parsedAction.data
    )
    // A canceled call may resolve before its abort reaches the bridge. Its
    // state is no longer wanted and must not overwrite a newer status.
    if (signal.aborted) return failure("canceled")
    return parseNativeResult(value, parsedAction.data)
  } catch (error) {
    return failure(transportFailure(error, signal))
  }
}
