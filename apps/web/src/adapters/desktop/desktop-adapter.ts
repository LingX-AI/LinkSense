import { fetch as nativeFetch } from "@mygo-plugins/fetch"
import { isMyGo } from "mygo-runtime"
import { z } from "zod"

import {
  Desktop,
  events,
  type CompletionNotificationInput,
  type DesktopNotificationClick,
} from "./mygo"

const hostInfoSchema = z.strictObject({
  bridgeVersion: z.literal(1),
  serverUrl: z.url(),
  platform: z.enum(["darwin", "windows"]),
  version: z.string().min(1),
})

const desktopUpdateSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("available"),
    version: z.string().min(1).max(80),
  }),
  z.strictObject({ state: z.enum(["current", "unavailable", "failed"]) }),
])

const desktopNotificationClickSchema = z.strictObject({
  userId: z.uuid(),
  conversationId: z.uuid(),
})

const desktopWorkspaceUsageSchema = z.strictObject({
  bytes: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  retentionDays: z.number().int().positive(),
  budgetBytes: z.number().int().positive(),
})

const desktopWorkspaceCleanupSchema = z.strictObject({
  status: z.enum(["completed", "busy"]),
  deletedSessions: z.number().int().nonnegative(),
  freedBytes: z.number().int().nonnegative(),
  retainedBytes: z.number().int().nonnegative(),
})

const desktopWorkspaceNoticeSchema = z.strictObject({
  cleared: z.boolean(),
})

export type DesktopWorkspaceUsage = z.infer<typeof desktopWorkspaceUsageSchema>
export type DesktopWorkspaceCleanup = z.infer<typeof desktopWorkspaceCleanupSchema>
export type DesktopWorkspaceNotice = z.infer<typeof desktopWorkspaceNoticeSchema>

export type DesktopNotificationResult =
  "shown" | "denied" | "unsupported" | "cancelled" | "failed"

export async function checkDesktopUpdate() {
  if (!isDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  return desktopUpdateSchema.parse(await Desktop.checkForUpdate())
}

/**
 * Aggregate local task-workspace usage for the account signed in to this Mac.
 * The native host derives the account from its own refresh session and never
 * returns paths or server-side storage figures; the page cannot name another
 * account.
 */
export async function readDesktopWorkspaceUsage(): Promise<DesktopWorkspaceUsage> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  return desktopWorkspaceUsageSchema.parse(await Desktop.workspaceUsage())
}

/** One click applies the existing 14-day/10-GiB retention policy. */
export async function cleanupDesktopWorkspaces(): Promise<DesktopWorkspaceCleanup> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  return desktopWorkspaceCleanupSchema.parse(
    await Desktop.cleanupWorkspaces()
  )
}

/**
 * Read-only check of this conversation's confirmed local eviction. The native
 * host derives the account from its own refresh session and returns a boolean
 * only; an unowned, legacy, or foreign workspace never reports as cleared.
 */
export async function readDesktopWorkspaceNotice(
  conversationId: string
): Promise<DesktopWorkspaceNotice> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  return desktopWorkspaceNoticeSchema.parse(
    await Desktop.workspaceNotice(conversationId)
  )
}

let hostInfo: z.infer<typeof hostInfoSchema> | null = null
let desktopNotificationsSupported = false
let notificationClickBridgeInstalled = false
let notificationClickListener:
  ((target: DesktopNotificationClick) => void) | null = null
let pendingNotificationClick: DesktopNotificationClick | null = null
let updateRequired = false
const updateListeners = new Set<() => void>()

export function requireDesktopUpdate(): void {
  if (updateRequired) return
  updateRequired = true
  for (const listener of updateListeners) listener()
}

export function getDesktopUpdateRequired(): boolean {
  return isDesktopHost() && updateRequired
}

export function subscribeDesktopUpdate(listener: () => void): () => void {
  updateListeners.add(listener)
  return () => updateListeners.delete(listener)
}

export function isDesktopHost(): boolean {
  return isMyGo()
}

export function isMacDesktopHost(): boolean {
  return isDesktopHost() && hostInfo?.platform === "darwin"
}

export function supportsNativeDesktopNotifications(): boolean {
  return isMacDesktopHost() && desktopNotificationsSupported
}

export async function showDesktopCompletionNotification(
  input: CompletionNotificationInput,
  signal: AbortSignal
): Promise<DesktopNotificationResult> {
  if (!supportsNativeDesktopNotifications()) return "unsupported"
  return desktopNotificationResult(signal, () =>
    Desktop.showCompletionNotification.with({ signal })(input)
  )
}

export async function showDesktopTestNotification(
  body: string,
  signal: AbortSignal
): Promise<DesktopNotificationResult> {
  if (!supportsNativeDesktopNotifications()) return "unsupported"
  return desktopNotificationResult(signal, () =>
    Desktop.showTestNotification.with({ signal })(body)
  )
}

async function desktopNotificationResult(
  signal: AbortSignal,
  show: () => Promise<void>
): Promise<DesktopNotificationResult> {
  try {
    signal.throwIfAborted()
    await show()
    return signal.aborted ? "cancelled" : "shown"
  } catch (error) {
    if (signal.aborted) return "cancelled"
    const message = error instanceof Error ? error.message : ""
    if (message === "DESKTOP_NOTIFICATIONS_DENIED") return "denied"
    if (message === "DESKTOP_NOTIFICATIONS_UNSUPPORTED") return "unsupported"
    return "failed"
  }
}

// Notification clicks may launch the app, so the listener is installed before
// React mounts and holds the target until the router is ready.
export function installDesktopNotificationClickBridge(): void {
  if (notificationClickBridgeInstalled || !isDesktopHost()) return
  notificationClickBridgeInstalled = true
  events.desktopNotificationClick.on((value) => {
    const target = desktopNotificationClickSchema.safeParse(value)
    if (!target.success) return
    if (notificationClickListener) notificationClickListener(target.data)
    else pendingNotificationClick = target.data
  })
}

export function subscribeDesktopNotificationClick(
  listener: (target: DesktopNotificationClick) => void
) {
  if (!isDesktopHost()) return
  installDesktopNotificationClickBridge()
  notificationClickListener = listener
  if (pendingNotificationClick) {
    const target = pendingNotificationClick
    pendingNotificationClick = null
    listener(target)
  }
  return () => {
    if (notificationClickListener === listener) notificationClickListener = null
  }
}

export function desktopNotificationRouteForUser(
  target: DesktopNotificationClick,
  userId: string
): string | null {
  return target.userId === userId
    ? `/conversations/${target.conversationId}`
    : null
}

const desktopMenuPathSchema = z.enum([
  "/settings/general",
  "/conversations/new",
])

export function subscribeDesktopNavigation(
  navigate: (path: z.infer<typeof desktopMenuPathSchema>) => void
) {
  if (!isDesktopHost()) return
  return events.desktopNavigate.on((value) => {
    const path = desktopMenuPathSchema.safeParse(value)
    if (path.success) navigate(path.data)
  })
}

export async function initializeDesktopHost(): Promise<null> {
  if (!isDesktopHost()) return null
  installDesktopNotificationClickBridge()
  hostInfo = hostInfoSchema.parse(await Desktop.info())
  document.documentElement.dataset.desktopPlatform = hostInfo.platform
  desktopNotificationsSupported = false
  if (hostInfo.platform === "darwin") {
    try {
      desktopNotificationsSupported =
        (await Desktop.notificationsSupported()) === true
    } catch {
      desktopNotificationsSupported = false
    }
  }
  return null
}

export function getDesktopServerUrl(): string | null {
  if (!isDesktopHost()) return null
  if (!hostInfo) throw new Error("DESKTOP_HOST_NOT_READY")
  return hostInfo.serverUrl
}

export function getDesktopPlatform(): "darwin" | "windows" | null {
  return isDesktopHost() ? (hostInfo?.platform ?? null) : null
}

export function getPublicAppOrigin(): string {
  return getDesktopServerUrl() ?? window.location.origin
}

export async function clearDesktopSession(): Promise<void> {
  if (isDesktopHost()) await Desktop.clearSession()
}

export function hostFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return isDesktopHost() ? nativeFetch(input, init) : fetch(input, init)
}

export async function openDesktopExternal(url: string): Promise<void> {
  if (!isDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  await Desktop.openExternal(url)
}
