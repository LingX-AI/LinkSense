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

const desktopUpdateStates = [
  "idle",
  "checking",
  "available",
  "current",
  "unavailable",
  "failed",
  "busy",
  "downloading",
  "staged",
  "install_failed",
] as const

export const desktopUpdateChannelSchema = z.enum(["stable", "beta"])
export const desktopUpdateRevisionSchema = z.number().int().nonnegative()

export type DesktopUpdateState = (typeof desktopUpdateStates)[number]
export type DesktopUpdateChannel = z.infer<typeof desktopUpdateChannelSchema>

const MAX_DESKTOP_UPDATE_NOTES_BYTES = 4096

const desktopUpdateNotesSchema = z
  .string()
  .refine(
    (notes) =>
      new TextEncoder().encode(notes).length <= MAX_DESKTOP_UPDATE_NOTES_BYTES,
    { message: "DESKTOP_UPDATE_NOTES_TOO_LONG" }
  )

// Native results carry only stable status fields. Notes are bounded plain
// text from the verified candidate; the UI never parses them as HTML, links,
// Markdown, or image sources. An unexpected field fails the parse.
const desktopUpdateResultSchema = z
  .strictObject({
    state: z.enum(desktopUpdateStates),
    version: z.string().min(1).max(80).optional(),
    notes: desktopUpdateNotesSchema.optional(),
    channel: desktopUpdateChannelSchema.optional(),
    betaAvailable: z.boolean().optional(),
    installAvailable: z.boolean().optional(),
    downloadAvailable: z.boolean().optional(),
    downloaded: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    revision: desktopUpdateRevisionSchema.optional(),
  })
  .superRefine((result, context) => {
    // The legacy check contract always named the offered version.
    if (result.state === "available" && result.version === undefined) {
      context.addIssue({
        code: "custom",
        message: "DESKTOP_UPDATE_VERSION_REQUIRED",
        path: ["version"],
      })
    }
  })

export type DesktopUpdateResult = z.infer<typeof desktopUpdateResultSchema>

function requireMacUpdateHost(): void {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
}

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
export type DesktopWorkspaceCleanup = z.infer<
  typeof desktopWorkspaceCleanupSchema
>
export type DesktopWorkspaceNotice = z.infer<
  typeof desktopWorkspaceNoticeSchema
>

export type DesktopNotificationResult =
  "shown" | "denied" | "unsupported" | "cancelled" | "failed"

export async function checkDesktopUpdate(): Promise<DesktopUpdateResult> {
  if (!isDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  return desktopUpdateResultSchema.parse(await Desktop.checkForUpdate())
}

/** Read the native authoritative update snapshot on macOS. */
export async function getDesktopUpdateState(): Promise<DesktopUpdateResult> {
  requireMacUpdateHost()
  return desktopUpdateResultSchema.parse(await Desktop.getUpdateState())
}

/**
 * Ask the native host to install the exact candidate the page rendered. The
 * revision fences late candidates; the page never edits or supplies a feed.
 */
export async function installDesktopUpdate(
  revision: number
): Promise<DesktopUpdateResult> {
  requireMacUpdateHost()
  return desktopUpdateResultSchema.parse(
    await Desktop.installUpdate(desktopUpdateRevisionSchema.parse(revision))
  )
}

/** Persist the stable/beta choice in native preferences. */
export async function setDesktopUpdateChannel(
  channel: DesktopUpdateChannel
): Promise<DesktopUpdateResult> {
  requireMacUpdateHost()
  return desktopUpdateResultSchema.parse(
    await Desktop.setUpdateChannel(desktopUpdateChannelSchema.parse(channel))
  )
}

export async function restartDesktopAfterUpdate(): Promise<void> {
  requireMacUpdateHost()
  await Desktop.restartAfterUpdate()
}

/**
 * Ask the host to open its configured installer page in the system browser.
 * The page supplies no URL and cannot redirect the host elsewhere.
 */
export async function openDesktopUpdateInstaller(): Promise<void> {
  requireMacUpdateHost()
  await Desktop.openUpdateInstaller()
}

export function subscribeDesktopUpdateChanged(
  listener: (result: DesktopUpdateResult) => void
): () => void {
  if (!isMacDesktopHost()) return () => undefined
  return events.desktopUpdateChanged.on((value) => {
    const parsed = desktopUpdateResultSchema.safeParse(value)
    if (parsed.success) listener(parsed.data)
  })
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
  return desktopWorkspaceCleanupSchema.parse(await Desktop.cleanupWorkspaces())
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
  // Mark the native platform before the bridge call so CSS and the router
  // error screen never wait for host info to resolve.
  const nativePlatform = window.mygo?.platform
  if (nativePlatform) {
    document.documentElement.dataset.desktopPlatform =
      nativePlatform === "darwin" ? "darwin" : "windows"
  }
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
