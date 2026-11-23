import {
  armDesktopArtifactDownload,
  beginDesktopArtifactDownload,
  beginDesktopArtifactPreview,
  cancelDesktopArtifactDownload,
  isMacDesktopHost,
  revealDesktopArtifactDownload,
  subscribeDesktopArtifactSaved,
} from "@/adapters/desktop/desktop-adapter"
import { downloadApiFile } from "@/api/client"
import {
  getLoginSessionBoundary,
  isLoginSessionCurrent,
  subscribeToLoginSession,
  type LoginSessionBoundary,
} from "@/api/session"
import { notify } from "@/components/feedback/notification"
import i18n from "@/i18n"
import { downloadBlob, downloadUrl } from "@/lib/download-blob"

import type { TaskArtifact } from "./task-artifact-api"

let savedSubscriptionInstalled = false

// A save that fails after the page armed its ticket emits no native event, so
// pending entries are bounded by the native ticket lifetime and a hard maximum
// instead of being retained forever.
const PENDING_SAVE_MAX_AGE_MS = 15 * 60 * 1000
const PENDING_SAVE_MAXIMUM = 64

type PendingSave = {
  handle: string
  boundary: LoginSessionBoundary
  startedAt: number
  // Set by the owner that ends the save. The initiating operation holds this
  // record even after map eviction, so release stays exactly-once.
  released: boolean
}

type FinderOffer = {
  handle: string
  toastId: string
  boundary: LoginSessionBoundary
  settled: boolean
  release: () => void
}

// The login that started each armed save. A completion is accepted only while
// that login is still current; a late completion from an ended login is
// dropped without showing its name or acquiring a callback.
const pendingSaves = new Map<string, PendingSave>()
// One visible Finder offer per completed ticket, owned by one login. Ending
// that login dismisses exactly these offers.
const finderOffers = new Map<string, FinderOffer>()

// The owner that ends a pending save is the one that cancels it, exactly once.
// Failures, login replacement, and age expiry release the same record; the
// initiating operation keeps that record after overflow eviction, so a late
// failure can still free the ticket and a stale guard can see a prior release.
function releasePendingSave(pending: PendingSave): Promise<void> {
  if (pending.released) return Promise.resolve()
  pending.released = true
  pendingSaves.delete(pending.handle)
  return cancelDesktopArtifactDownload(pending.handle).catch(() => undefined)
}

function prunePendingSaves(now: number) {
  for (const pending of pendingSaves.values()) {
    if (now - pending.startedAt < PENDING_SAVE_MAX_AGE_MS) continue
    void releasePendingSave(pending)
  }
  // Map iteration is insertion-ordered; drop the oldest overflow without
  // cancelling it or marking it released. The operation still owns the ticket,
  // so its own settlement must remain able to free it.
  for (const handle of pendingSaves.keys()) {
    if (pendingSaves.size <= PENDING_SAVE_MAXIMUM) break
    pendingSaves.delete(handle)
  }
}

function trackPendingSave(
  handle: string,
  boundary: LoginSessionBoundary
): PendingSave {
  const now = Date.now()
  const pending: PendingSave = {
    handle,
    boundary,
    startedAt: now,
    released: false,
  }
  // Insert before pruning so the exact bound covers this record too: overflow
  // evicts the oldest save instead of leaving the map one over the maximum.
  pendingSaves.set(handle, pending)
  prunePendingSaves(now)
  return pending
}

function dismissOffer(offer: FinderOffer) {
  offer.settled = true
  finderOffers.delete(offer.handle)
  notify.dismiss(offer.toastId)
  void cancelDesktopArtifactDownload(offer.handle).catch(() => undefined)
}

// Sign-out intent, an accepted replacement login, or a definitive auth clear
// ends the previous login's ownership of Finder state. Only offers and pending
// saves started under the earlier boundary are dismissed; other notifications
// and ordinary token rotation are untouched.
function endFinderStateFromEarlierLogin(boundary: LoginSessionBoundary) {
  for (const pending of pendingSaves.values()) {
    if (pending.boundary === boundary) continue
    void releasePendingSave(pending)
  }
  for (const offer of [...finderOffers.values()]) {
    if (offer.boundary === boundary) continue
    // Claim the offer before dismissal so Sonner's dismissal callback cannot
    // release the same ticket a second time.
    dismissOffer(offer)
  }
}

type PreviewProvenance = {
  content: Uint8Array | null
  sourceHandle: string
  boundary: LoginSessionBoundary
  active: boolean
  detachAbort: () => void
}

// The exact Uint8Array returned by a preview load owns one reusable native
// provenance handle. Every deliberate save derives its own single-use ticket
// from it; a file name, a later load, or a new ticket cannot claim those bytes.
const previewProvenance = new WeakMap<Uint8Array, PreviewProvenance>()

function cancelProvenance(provenance: PreviewProvenance) {
  if (!provenance.active) return
  provenance.active = false
  if (provenance.content) previewProvenance.delete(provenance.content)
  provenance.detachAbort()
  void cancelDesktopArtifactDownload(provenance.sourceHandle).catch(
    () => undefined
  )
}

function previewSourceFor(content: Uint8Array): string | null {
  const provenance = previewProvenance.get(content)
  if (!provenance?.active) return null
  // A preview loaded by an earlier login must not derive a save ticket in its
  // successor. Drop the native source the old login still owns.
  if (!isLoginSessionCurrent(provenance.boundary)) {
    cancelProvenance(provenance)
    return null
  }
  return provenance.sourceHandle
}

function installSavedSubscription() {
  if (savedSubscriptionInstalled) return
  savedSubscriptionInstalled = true
  subscribeToLoginSession(endFinderStateFromEarlierLogin)
  subscribeDesktopArtifactSaved((saved) => {
    const pending = pendingSaves.get(saved.handle)
    if (!pending) return
    // The save outlived its login. Do not show the name, create an offer, or
    // hand the queued completion a callback; just release the native ticket.
    if (!isLoginSessionCurrent(pending.boundary)) {
      void releasePendingSave(pending)
      return
    }
    pendingSaves.delete(saved.handle)

    const toastId = `task-artifact-saved-${saved.handle}`
    // One completed ticket belongs to this offer until it is revealed or
    // released. Sonner can report both an action click and a dismissal for the
    // same toast, so the first outcome claims the ticket.
    const offer: FinderOffer = {
      handle: saved.handle,
      toastId,
      boundary: pending.boundary,
      settled: false,
      release: () => undefined,
    }
    offer.release = () => {
      if (offer.settled) return
      offer.settled = true
      finderOffers.delete(offer.handle)
      void cancelDesktopArtifactDownload(offer.handle).catch(() => undefined)
    }
    finderOffers.set(offer.handle, offer)
    notify.success(i18n.t("taskArtifacts.saved", { name: saved.name }), {
      id: toastId,
      action: {
        label: i18n.t("taskArtifacts.showInFinder"),
        onClick: () => {
          // The login can end between rendering the offer and activating it.
          if (offer.settled || !isLoginSessionCurrent(offer.boundary)) return
          // Sonner runs the action callback before deleting the toast; a
          // dismissal caused by this click must not cancel the reveal.
          offer.settled = true
          finderOffers.delete(offer.handle)
          notify.dismiss(toastId)
          void revealDesktopArtifactDownload(offer.handle).catch(() => {
            // A reveal rejected after its login ended must not surface an
            // error on the next account's screen.
            if (isLoginSessionCurrent(offer.boundary)) {
              notify.error(i18n.t("taskArtifacts.revealFailed"))
            }
            // The native side consumes the ticket before Finder opens. This
            // cancel is a no-op after consumption and frees the completed slot
            // when the reveal was rejected before consuming it.
            void cancelDesktopArtifactDownload(offer.handle).catch(
              () => undefined
            )
          })
        },
      },
      onAutoClose: offer.release,
      onDismiss: offer.release,
    })
  })
}

function artifactContentPath(
  file: Pick<TaskArtifact, "id" | "conversation_id">
) {
  return `/conversations/${file.conversation_id}/files/${file.id}/content`
}

/**
 * Loads preview bytes with the native save identity already established. On a
 * Mac the reusable provenance source starts before the original /content
 * request and is cancelled by abort, reload, or unmount. Browsers and Windows
 * take the unchanged path.
 */
export async function loadTaskArtifactContent(
  file: Pick<TaskArtifact, "id" | "conversation_id">,
  signal?: AbortSignal
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  if (!isMacDesktopHost()) {
    const blob = await downloadApiFile(
      artifactContentPath(file),
      undefined,
      signal
    )
    signal?.throwIfAborted()
    return new Uint8Array(await blob.arrayBuffer())
  }

  // Ownership belongs to the login that requested these bytes, not to whichever
  // login is current when the native source resolves.
  const boundary = getLoginSessionBoundary()
  const sourceHandle = await beginDesktopArtifactPreview()
  if (!sourceHandle) throw new Error("DESKTOP_DOWNLOAD_UNAVAILABLE")
  // The component may have unmounted while the native source was starting.
  if (signal?.aborted) {
    void cancelDesktopArtifactDownload(sourceHandle).catch(() => undefined)
    signal.throwIfAborted()
  }
  if (!isLoginSessionCurrent(boundary)) {
    void cancelDesktopArtifactDownload(sourceHandle).catch(() => undefined)
    throw new Error("DESKTOP_DOWNLOAD_STALE")
  }
  const provenance: PreviewProvenance = {
    content: null,
    sourceHandle,
    boundary,
    active: true,
    detachAbort: () => undefined,
  }
  const onAbort = () => cancelProvenance(provenance)
  signal?.addEventListener("abort", onAbort, { once: true })
  provenance.detachAbort = () => signal?.removeEventListener("abort", onAbort)

  try {
    const blob = await downloadApiFile(
      artifactContentPath(file),
      undefined,
      signal
    )
    signal?.throwIfAborted()
    const content = new Uint8Array(await blob.arrayBuffer())
    signal?.throwIfAborted()
    // Bytes fetched for an ended login must not reach the caller or a save.
    if (!isLoginSessionCurrent(boundary)) {
      throw new Error("DESKTOP_DOWNLOAD_STALE")
    }
    provenance.content = content
    previewProvenance.set(content, provenance)
    return content
  } catch (error) {
    cancelProvenance(provenance)
    throw error
  }
}

async function saveWithFinderOffer(
  blob: Blob,
  filename: string,
  pending: PendingSave
): Promise<void> {
  const { handle, boundary } = pending
  // The initiating login can end while the fetch is still completing, and age
  // expiry can release the ticket even while that login stays current. Neither
  // may arm or click a ticket this operation no longer owns.
  if (pending.released || !isLoginSessionCurrent(boundary)) {
    await releasePendingSave(pending)
    throw new Error("DESKTOP_DOWNLOAD_STALE")
  }
  let url: string
  try {
    url = URL.createObjectURL(blob)
  } catch (error) {
    await releasePendingSave(pending)
    throw error
  }
  try {
    await armDesktopArtifactDownload(handle, url)
  } catch (error) {
    // The rejected arm leaves this URL unused; revoke it immediately instead
    // of retaining it after the toast can no longer complete.
    URL.revokeObjectURL(url)
    // Each save owns a freshly derived ticket, so discarding it cannot drop
    // an earlier binding. A stale ticket must not save without a path.
    await releasePendingSave(pending)
    throw error
  }
  // Logout or expiry can win while the ticket is arming; never click the anchor
  // into the replacement login or a released ticket.
  if (pending.released || !isLoginSessionCurrent(boundary)) {
    URL.revokeObjectURL(url)
    await releasePendingSave(pending)
    throw new Error("DESKTOP_DOWNLOAD_STALE")
  }
  try {
    downloadUrl(url, filename)
  } catch (error) {
    await releasePendingSave(pending)
    throw error
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/**
 * Saves bytes a preview already holds. The content argument must be the exact
 * object returned by loadTaskArtifactContent; no second fetch is created. Each
 * save derives its own single-use native ticket from the live provenance, and
 * Mac loads without that provenance fail closed.
 */
export async function saveTaskArtifactBlob(
  blob: Blob,
  filename: string,
  content?: Uint8Array
): Promise<void> {
  if (!isMacDesktopHost()) {
    downloadBlob(blob, filename)
    return
  }
  const sourceHandle = content ? previewSourceFor(content) : null
  if (!sourceHandle) throw new Error("DESKTOP_DOWNLOAD_STALE")
  // Each save derives a distinct single-use ticket from the original load's
  // account and page provenance. The source stays reusable for later saves.
  const boundary = getLoginSessionBoundary()
  const handle = await beginDesktopArtifactDownload(sourceHandle)
  if (!handle) throw new Error("DESKTOP_DOWNLOAD_UNAVAILABLE")
  if (!isLoginSessionCurrent(boundary)) {
    void cancelDesktopArtifactDownload(handle).catch(() => undefined)
    throw new Error("DESKTOP_DOWNLOAD_STALE")
  }
  installSavedSubscription()
  const pending = trackPendingSave(handle, boundary)
  await saveWithFinderOffer(blob, filename, pending)
}

/**
 * Saves one authenticated task artifact through the existing blob pipeline.
 * On a Mac desktop host the native ticket starts before the fetch and the
 * Finder action appears only after MyGo reports the exact save succeeded.
 */
export async function downloadTaskArtifact(
  file: TaskArtifact,
  signal?: AbortSignal
): Promise<void> {
  const mac = isMacDesktopHost()
  // Ownership belongs to the login that requested this save, not to whichever
  // login is current when the native ticket resolves.
  const boundary = getLoginSessionBoundary()
  const handle = mac ? await beginDesktopArtifactDownload() : null
  if (!handle && mac) throw new Error("DESKTOP_DOWNLOAD_UNAVAILABLE")
  if (handle && !isLoginSessionCurrent(boundary)) {
    void cancelDesktopArtifactDownload(handle).catch(() => undefined)
    throw new Error("DESKTOP_DOWNLOAD_STALE")
  }
  let pending: PendingSave | null = null
  if (handle) {
    installSavedSubscription()
    pending = trackPendingSave(handle, boundary)
  }
  let blob: Blob
  try {
    blob = await downloadApiFile(
      `/conversations/${file.conversation_id}/files/${file.id}/download`,
      undefined,
      signal
    )
    signal?.throwIfAborted()
  } catch (error) {
    if (pending) await releasePendingSave(pending)
    throw error
  }
  if (!pending) {
    downloadBlob(blob, file.name)
    return
  }
  await saveWithFinderOffer(blob, file.name, pending)
}
