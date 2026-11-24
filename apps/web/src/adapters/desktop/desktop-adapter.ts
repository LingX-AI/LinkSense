import { fetch as nativeFetch } from "@mygo-plugins/fetch"
import { isMyGo } from "mygo-runtime"
import { z } from "zod"

import { desktopDeviceSettingsHref } from "@/features/desktop-execution/desktop-execution-target"

import {
  Desktop,
  events,
  type CompletionNotificationInput,
  type DesktopApprovalNotificationInput,
  type DesktopNotificationClick,
  type MacSignOutOptions,
} from "./mygo"

const hostInfoSchema = z.strictObject({
  bridgeVersion: z.literal(1),
  serverUrl: z.url(),
  platform: z.enum(["darwin", "windows"]),
  version: z.string().min(1),
  macSignOut: z.literal(true).optional(),
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
  // Present only on an approval reminder. It is a recheck key, never a
  // decision or a route supplied by the notification.
  requestId: z.uuid().optional(),
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

const artifactDownloadHandleSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)

const artifactDownloadSavedSchema = z.strictObject({
  handle: artifactDownloadHandleSchema,
  name: z.string().min(1).max(512),
})

export type DesktopWorkspaceUsage = z.infer<typeof desktopWorkspaceUsageSchema>
export type DesktopWorkspaceCleanup = z.infer<
  typeof desktopWorkspaceCleanupSchema
>
export type DesktopWorkspaceNotice = z.infer<
  typeof desktopWorkspaceNoticeSchema
>

export type DesktopArtifactDownloadSaved = z.infer<
  typeof artifactDownloadSavedSchema
>

export type DesktopNotificationResult =
  "shown" | "denied" | "unsupported" | "cancelled" | "stale" | "failed"

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

/**
 * Begin one opaque save ticket before the authenticated artifact fetch. With a
 * preview source it derives a fresh single-use save ticket from that preview's
 * original account and page provenance. Only a Mac desktop host offers the
 * Finder action; browsers and Windows download as before.
 */
export async function beginDesktopArtifactDownload(
  sourceHandle?: string
): Promise<string | null> {
  if (!isMacDesktopHost()) return null
  if (sourceHandle === undefined) {
    return artifactDownloadHandleSchema.parse(
      await Desktop.beginArtifactDownload()
    )
  }
  return artifactDownloadHandleSchema.parse(
    await Desktop.beginArtifactDownload(
      artifactDownloadHandleSchema.parse(sourceHandle)
    )
  )
}

/**
 * Retain one reusable provenance handle for bytes this page is about to load.
 * It creates no writer or Finder offer and is closed when the preview unmounts,
 * reloads, signs out, or its account lease changes.
 */
export async function beginDesktopArtifactPreview(): Promise<string | null> {
  if (!isMacDesktopHost()) return null
  return artifactDownloadHandleSchema.parse(
    await Desktop.beginArtifactPreview()
  )
}

/** Bind the ticket to the exact blob URL the page is about to save. */
export async function armDesktopArtifactDownload(
  handle: string,
  blobUrl: string
): Promise<void> {
  if (!isMacDesktopHost()) return
  await Desktop.armArtifactDownload(
    artifactDownloadHandleSchema.parse(handle),
    z.string().min(1).max(4096).startsWith("blob:").parse(blobUrl)
  )
}

/** Drop a ticket whose fetch or save never completed. */
export async function cancelDesktopArtifactDownload(
  handle: string
): Promise<void> {
  if (!isMacDesktopHost()) return
  await Desktop.cancelArtifactDownload(
    artifactDownloadHandleSchema.parse(handle)
  )
}

/** Run only from the explicit keyboard-accessible Finder action. */
export async function revealDesktopArtifactDownload(
  handle: string
): Promise<void> {
  if (!isMacDesktopHost()) throw new Error("DESKTOP_HOST_UNAVAILABLE")
  await Desktop.revealArtifactDownload(
    artifactDownloadHandleSchema.parse(handle)
  )
}

/** Native completion events carry an opaque handle and the saved file name. */
export function subscribeDesktopArtifactSaved(
  listener: (saved: DesktopArtifactDownloadSaved) => void
): () => void {
  if (!isMacDesktopHost()) return () => undefined
  return events.desktopArtifactSaved.on((value) => {
    const parsed = artifactDownloadSavedSchema.safeParse(value)
    if (parsed.success) listener(parsed.data)
  })
}

let hostInfo: z.infer<typeof hostInfoSchema> | null = null
let desktopNotificationsSupported = false
let notificationClickBridgeInstalled = false
type ProtectedNotificationScope = {
  ownerId: string
  pathname: string
  search: string
  hash: string
}
let protectedNotificationScope: ProtectedNotificationScope | null = null
let pendingNotificationClick:
  | (DesktopNotificationClick & { afterConversation?: DesktopConversationPath })
  | null = null
let desktopApprovalClickVerifier: DesktopApprovalClickVerifier | null = null
let approvalClickGeneration = 0
let approvalClickVerification: DesktopApprovalClickVerification | null = null
let verifiedApprovalClick: DesktopNotificationClick | null = null
let navigationBridgeInstalled = false
let menuNavigationListener: ((path: DesktopMenuPath) => void) | null = null
let launchNavigationListener: ((path: DesktopLaunchPath) => void) | null = null
let launchContext: DesktopLaunchContext = {
  authenticated: false,
  ownerId: null,
  ready: false,
  pathname: "",
  search: "",
  hash: "",
}
let pendingConversationNavigation: PendingLaunch<DesktopConversationPath> | null =
  null
let pendingPairingNavigation: PendingLaunch<
  typeof desktopDeviceSettingsHref
> | null = null
let pendingUpdateNavigation: PendingLaunch<
  typeof desktopUpdateSettingsHref
> | null = null
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

export function supportsMacDesktopSignOut(): boolean {
  return isMacDesktopHost() && hostInfo?.macSignOut === true
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

const missingApprovalNotificationBinding =
  "method Desktop.ShowApprovalNotification is not bound"

/**
 * Show a generic native reminder for one observed approval pair. The payload
 * carries no task text, command, path, or route, and never answers the request.
 */
export async function showDesktopApprovalNotification(
  input: DesktopApprovalNotificationInput,
  signal: AbortSignal
): Promise<DesktopNotificationResult> {
  if (!supportsNativeDesktopNotifications()) return "unsupported"
  return desktopNotificationResult(
    signal,
    () => Desktop.showApprovalNotification.with({ signal })(input),
    missingApprovalNotificationBinding
  )
}

// MyGo's generated bind() always gives the client a `.with` function, even
// when the running host never bound the method. The host answers such a call
// with this exact Go error; only the update caller treats it as unsupported.
const missingUpdateNotificationBinding =
  "method Desktop.ShowUpdateNotification is not bound"

/**
 * Show one quiet native notice for the exact signed update revision. The page
 * supplies no text or version; the host rechecks its account and candidate.
 */
export async function showDesktopUpdateNotification(
  revision: number,
  signal: AbortSignal
): Promise<DesktopNotificationResult> {
  if (!supportsNativeDesktopNotifications()) return "unsupported"
  // A malformed or zero revision is a page bug: never call native and never
  // leave an unhandled rejection for the caller's async effect.
  const exactRevision = desktopUpdateRevisionSchema
    .refine((value) => value > 0)
    .safeParse(revision)
  if (!exactRevision.success) return "failed"
  return desktopNotificationResult(
    signal,
    () => Desktop.showUpdateNotification.with({ signal })(exactRevision.data),
    missingUpdateNotificationBinding
  )
}

async function desktopNotificationResult(
  signal: AbortSignal,
  show: () => Promise<void>,
  missingHostMethod?: string
): Promise<DesktopNotificationResult> {
  try {
    signal.throwIfAborted()
    await show()
    return signal.aborted ? "cancelled" : "shown"
  } catch (error) {
    if (signal.aborted) return "cancelled"
    const message = error instanceof Error ? error.message : ""
    if (missingHostMethod !== undefined && message === missingHostMethod)
      return "unsupported"
    if (message === "DESKTOP_NOTIFICATIONS_DENIED") return "denied"
    if (message === "DESKTOP_NOTIFICATIONS_UNSUPPORTED") return "unsupported"
    if (
      message === "DESKTOP_UPDATE_STALE" ||
      message === "DESKTOP_UPDATE_BUSY" ||
      message === "DESKTOP_APPROVAL_NOTIFICATION_STALE" ||
      message === "DESKTOP_APPROVAL_NOTIFICATION_INVALID" ||
      message === "AUTH_REQUIRED"
    )
      return "stale"
    return "failed"
  }
}

type DesktopApprovalClickVerifier = (input: {
  userId: string
  conversationId: string
  requestId: string
  signal: AbortSignal
}) => Promise<boolean>

type DesktopApprovalClickVerification = {
  click: DesktopNotificationClick & { requestId: string }
  ownerId: string
  surface: { pathname: string; search: string; hash: string }
  generation: number
  controller: AbortController
}

/**
 * The page injects the exact-pair GET so this native adapter never imports the
 * authenticated API client. Until a verifier is registered, an approval click
 * stays buffered; without one it can never navigate.
 */
export function registerDesktopApprovalClickVerifier(
  verifier: DesktopApprovalClickVerifier
): () => void {
  desktopApprovalClickVerifier = verifier
  flushPendingDesktopLaunch()
  return () => {
    if (desktopApprovalClickVerifier !== verifier) return
    desktopApprovalClickVerifier = null
    invalidateApprovalClickVerification()
  }
}

/**
 * Cancel a queued or in-flight approval click on sign-out, account replacement
 * (including the same id), or a newer protected surface. Completion clicks are
 * left to their existing owner checks.
 */
export function cancelPendingApprovalNotificationClick(): void {
  invalidateApprovalClickVerification()
  if (pendingNotificationClick?.requestId) pendingNotificationClick = null
}

function invalidateApprovalClickVerification(): void {
  approvalClickVerification?.controller.abort()
  approvalClickVerification = null
  approvalClickGeneration += 1
  verifiedApprovalClick = null
}

// A pre-auth cold-start notification stays buffered until a newer explicit
// action or the page readiness lets an exact-pair check start.
function verifyApprovalNotificationClick(
  click: DesktopNotificationClick & { requestId: string },
  ownerId: string,
  surface: { pathname: string; search: string; hash: string }
): void {
  if (approvalClickVerification?.click === click) return
  const verifier = desktopApprovalClickVerifier
  if (!verifier) return
  approvalClickVerification?.controller.abort()
  verifiedApprovalClick = null
  const generation = ++approvalClickGeneration
  const controller = new AbortController()
  const verification: DesktopApprovalClickVerification = {
    click,
    ownerId,
    surface,
    generation,
    controller,
  }
  approvalClickVerification = verification
  void verifier({
    userId: click.userId,
    conversationId: click.conversationId,
    requestId: click.requestId,
    signal: controller.signal,
  })
    .then((live) => {
      if (
        approvalClickVerification !== verification ||
        generation !== approvalClickGeneration
      )
        return
      approvalClickVerification = null
      if (!live) {
        if (pendingNotificationClick === click) pendingNotificationClick = null
        return
      }
      // Recheck the exact protected surface after the async GET. A newer
      // click, link, account, sign-out, or manual route change (path, query,
      // or hash) must win.
      const scope = protectedNotificationScope
      if (
        pendingNotificationClick !== click ||
        !launchContext.authenticated ||
        !launchContext.ready ||
        launchContext.ownerId !== ownerId ||
        !scope ||
        scope.ownerId !== ownerId ||
        scope.pathname !== surface.pathname ||
        scope.search !== surface.search ||
        scope.hash !== surface.hash
      ) {
        if (pendingNotificationClick === click) pendingNotificationClick = null
        return
      }
      verifiedApprovalClick = click
      flushPendingDesktopLaunch()
    })
    .catch(() => {
      if (
        approvalClickVerification !== verification ||
        generation !== approvalClickGeneration
      )
        return
      approvalClickVerification = null
      if (pendingNotificationClick === click) pendingNotificationClick = null
    })
}

// Notification clicks may launch the app, so the listener is installed before
// React mounts and holds the target until the router is ready.
export function installDesktopNotificationClickBridge(): void {
  if (notificationClickBridgeInstalled || !isDesktopHost()) return
  notificationClickBridgeInstalled = true
  events.desktopNotificationClick.on((value) => {
    const target = desktopNotificationClickSchema.safeParse(value)
    if (!target.success) return
    // A new click can replace the waiting notification only for its owner.
    if (
      pendingNotificationClick?.afterConversation &&
      target.data.userId !== pendingNotificationClick.userId
    )
      return
    invalidateApprovalClickVerification()
    pendingNotificationClick = target.data
    flushPendingDesktopLaunch()
  })
}

// Staying on an unsaved draft also discards the click waiting behind the
// declined conversation link.
export function cancelDeferredDesktopNotification(pathname: string): void {
  if (pendingNotificationClick?.afterConversation !== pathname) return
  invalidateApprovalClickVerification()
  pendingNotificationClick = null
}

// Published during the protected route's commit, before BootstrapGate drains
// launch intents. A signed-in public page still cannot open a notification.
// The full committed location (path, query, and hash) fences a deferred exact
// check so it cannot navigate over a newer route.
export function scopeDesktopNotificationNavigation(
  ownerId: string,
  pathname: string,
  search = "",
  hash = ""
) {
  if (!isDesktopHost()) return
  installDesktopNotificationClickBridge()
  if (
    launchContext.ready &&
    (launchContext.pathname !== pathname ||
      launchContext.search !== search ||
      launchContext.hash !== hash)
  ) {
    // A route change committed while a protected surface was live is a newer
    // explicit intent than a queued approval click.
    cancelPendingApprovalNotificationClick()
  }
  const scope = { ownerId, pathname, search, hash }
  protectedNotificationScope = scope
  if (pendingNotificationClick) {
    // Suspense can reveal a protected route again without rerunning the
    // BootstrapGate effect. Recheck after the guards have committed.
    queueMicrotask(() => {
      if (
        protectedNotificationScope === scope &&
        launchContext.ownerId === ownerId &&
        launchContext.pathname === pathname &&
        launchContext.search === search &&
        launchContext.hash === hash
      ) {
        flushPendingDesktopLaunch()
      }
    })
  }
  return () => {
    if (protectedNotificationScope === scope) {
      protectedNotificationScope = null
    }
  }
}

export const desktopUpdateSettingsHref =
  "/settings/general#desktop-update-heading" as const

const desktopMenuPathSchema = z.enum([
  "/settings/general",
  "/conversations/new",
])
// Go validates the 8-4-4-4-12 hex shape. z.guid() mirrors that native parsing
// contract; it does not imply the API can retrieve a non-RFC identifier.
const desktopConversationPathSchema = z.templateLiteral([
  "/conversations/",
  z.guid(),
])

type DesktopMenuPath = z.infer<typeof desktopMenuPathSchema>
type DesktopConversationPath = z.infer<typeof desktopConversationPathSchema>
type DesktopLaunchPath =
  | DesktopConversationPath
  | typeof desktopDeviceSettingsHref
  | typeof desktopUpdateSettingsHref

type DesktopLaunchContext = {
  authenticated: boolean
  ownerId: string | null
  ready: boolean
  pathname: string
  search?: string
  hash: string
}

type PendingLaunch<Path extends DesktopLaunchPath> = {
  path: Path
  ownerId: string | null
}

// Launch links can arrive before React mounts. Buffer the validated path and
// owner until the protected destination is usable; menu actions stay live-only.
export function installDesktopNavigationBridge(): void {
  if (navigationBridgeInstalled || !isDesktopHost()) return
  navigationBridgeInstalled = true
  events.desktopNavigate.on((value) => {
    const menuPath = desktopMenuPathSchema.safeParse(value)
    if (menuPath.success) {
      // A menu action is live-only and supersedes a queued approval prompt.
      if (!menuNavigationListener) return
      cancelPendingApprovalNotificationClick()
      menuNavigationListener(menuPath.data)
      return
    }
    if (value === desktopUpdateSettingsHref) {
      cancelPendingApprovalNotificationClick()
      pendingUpdateNavigation = { path: value, ownerId: launchContext.ownerId }
    } else if (value === desktopDeviceSettingsHref) {
      // Null means the bridge is installed but Desktop.info has not resolved.
      // Windows never opens this Mac-only pairing surface, so it must not
      // cancel an unrelated pending approval there.
      if (getDesktopPlatform() === "windows") return
      // A newer explicit settings handoff wins over a queued approval prompt.
      cancelPendingApprovalNotificationClick()
      pendingPairingNavigation = { path: value, ownerId: launchContext.ownerId }
    } else {
      const conversationPath = desktopConversationPathSchema.safeParse(value)
      // Malformed or unknown native values are not navigation. They must not
      // invalidate an exact-pair check that is already in flight.
      if (!conversationPath.success) return
      // A recognized conversation link wins over a pending approval prompt,
      // including one buffered before its exact-pair check started. Completion
      // clicks keep their existing draft-handoff priority.
      cancelPendingApprovalNotificationClick()
      pendingConversationNavigation = {
        path: conversationPath.data,
        ownerId: launchContext.ownerId,
      }
    }
    flushPendingDesktopLaunch()
  })
}

// Menus are only delivered while their current protected route owns them.
export function subscribeDesktopNavigation(
  navigate: (path: DesktopMenuPath) => void
) {
  if (!isDesktopHost()) return
  menuNavigationListener = navigate
  installDesktopNavigationBridge()
  return () => {
    if (menuNavigationListener === navigate) menuNavigationListener = null
  }
}

export function subscribeDesktopLaunchNavigation(
  navigate: (path: DesktopLaunchPath) => void
) {
  if (!isDesktopHost()) return
  launchNavigationListener = navigate
  installDesktopNavigationBridge()
  flushPendingDesktopLaunch()
  return () => {
    if (launchNavigationListener === navigate) launchNavigationListener = null
  }
}

// The auth/bootstrap gate publishes whether the current surface may open a
// protected destination and which signed-in owner (if any) captured it.
// An ownerless intent is adopted by the first authenticated owner even while
// that owner cannot route (for example under maintenance), so a later owner
// mismatch fences it. A link received before the first sign-in still survives
// an anonymous cancel/restart because no owner is ever published.
export function updateDesktopLaunchContext(
  context: DesktopLaunchContext
): void {
  const search = context.search ?? ""
  const pathnameChanged = context.pathname !== launchContext.pathname
  const searchChanged = search !== launchContext.search
  const hashChanged = context.hash !== launchContext.hash
  if (
    pathnameChanged ||
    searchChanged ||
    hashChanged ||
    context.ownerId !== launchContext.ownerId
  ) {
    // A manually changed route, query, anchor, or account replacement must
    // not let an earlier approval verification navigate over the new surface.
    invalidateApprovalClickVerification()
  }
  if (
    pendingNotificationClick?.requestId &&
    context.ownerId !== null &&
    pendingNotificationClick.userId !== context.ownerId
  ) {
    pendingNotificationClick = null
  }
  if (
    launchContext.ready &&
    context.ready &&
    pendingNotificationClick?.requestId &&
    (hashChanged ||
      searchChanged ||
      (pathnameChanged && !pendingNotificationClick.afterConversation))
  ) {
    // Once a protected surface is live, an explicit route, query, or anchor
    // change wins over a queued approval prompt. A completion click waiting
    // behind a conversation/draft handoff keeps its afterConversation marker
    // until that handoff settles.
    pendingNotificationClick = null
  }
  if (launchContext.authenticated && !context.authenticated) {
    cancelPendingApprovalNotificationClick()
  }
  const waiting = pendingNotificationClick
  if (
    waiting?.afterConversation &&
    (context.pathname !== launchContext.pathname ||
      context.ownerId !== launchContext.ownerId)
  ) {
    if (
      context.pathname === waiting.afterConversation &&
      context.ownerId === waiting.userId
    ) {
      delete waiting.afterConversation
    } else {
      pendingNotificationClick = null
    }
  }
  launchContext = { ...context, search }
  pendingConversationNavigation = launchForOwner(
    pendingConversationNavigation,
    context.ownerId
  )
  pendingPairingNavigation = launchForOwner(
    pendingPairingNavigation,
    context.ownerId
  )
  pendingUpdateNavigation = launchForOwner(
    pendingUpdateNavigation,
    context.ownerId
  )
  flushPendingDesktopLaunch()
}

function launchForOwner<Path extends DesktopLaunchPath>(
  pending: PendingLaunch<Path> | null,
  ownerId: string | null
): PendingLaunch<Path> | null {
  if (!pending || pending.ownerId === ownerId) return pending
  return pending.ownerId === null ? { ...pending, ownerId } : null
}

function flushPendingDesktopLaunch(): void {
  const { authenticated, ownerId, ready, pathname, hash } = launchContext
  if (!launchNavigationListener || !authenticated || !ready || !ownerId) return

  const scope = protectedNotificationScope
  const notification =
    scope?.ownerId === ownerId && scope.pathname === pathname
      ? pendingNotificationClick
      : null
  const notificationPath =
    notification?.userId === ownerId
      ? (`/conversations/${notification.conversationId}` as const)
      : null
  if (notification && !notificationPath) pendingNotificationClick = null

  const conversation = pendingConversationNavigation?.path
  pendingConversationNavigation = null
  if (conversation) {
    pendingPairingNavigation = null
    pendingUpdateNavigation = null
    if (conversation !== pathname) {
      if (notificationPath === conversation) pendingNotificationClick = null
      // Keep a different notification until this route commits so it cannot
      // replace the unsaved-draft prompt.
      else if (notification && notificationPath)
        notification.afterConversation = conversation
      launchNavigationListener(conversation)
      return
    }
  }
  if (pendingNotificationClick?.afterConversation) {
    // The click waits behind a higher-priority conversation/draft handoff.
    // An update intent is lower priority and must not surface later after the
    // draft is accepted or declined.
    pendingUpdateNavigation = null
    return
  }
  if (notificationPath) {
    if (notification?.requestId && verifiedApprovalClick !== notification) {
      // The native banner only names the pair; the authenticated page must
      // confirm it is still the live head for this login before routing.
      if (!scope) return
      verifyApprovalNotificationClick(
        notification as DesktopNotificationClick & { requestId: string },
        ownerId,
        {
          pathname: scope.pathname,
          search: scope.search,
          hash: scope.hash,
        }
      )
      return
    }
    verifiedApprovalClick = null
    pendingNotificationClick = null
    pendingPairingNavigation = null
    pendingUpdateNavigation = null
    if (notificationPath !== pathname)
      launchNavigationListener(notificationPath)
  } else if (pendingPairingNavigation && isMacDesktopHost()) {
    const { path } = pendingPairingNavigation
    pendingPairingNavigation = null
    pendingUpdateNavigation = null
    if (path !== `${pathname}${hash}`) launchNavigationListener(path)
  } else if (pendingUpdateNavigation && isMacDesktopHost()) {
    const { path } = pendingUpdateNavigation
    pendingUpdateNavigation = null
    if (path !== `${pathname}${hash}`) launchNavigationListener(path)
  }
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
  if (hostInfo.platform === "windows") pendingPairingNavigation = null
  desktopNotificationsSupported = false
  if (hostInfo.platform === "darwin") {
    try {
      desktopNotificationsSupported =
        (await Desktop.notificationsSupported()) === true
    } catch {
      desktopNotificationsSupported = false
    }
  }
  flushPendingDesktopLaunch()
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

export async function clearDesktopSession(
  options: MacSignOutOptions = {}
): Promise<void> {
  if (supportsMacDesktopSignOut()) {
    await Desktop.clearMacSession(options)
  } else if (isDesktopHost()) {
    await Desktop.clearSession()
  }
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
