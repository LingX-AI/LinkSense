import { useSyncExternalStore } from "react"

import {
  getDesktopUpdateState,
  subscribeDesktopUpdateChanged,
  type DesktopUpdateResult,
} from "@/adapters/desktop/desktop-adapter"

// The native host owns the update operation. This store mirrors only its
// authoritative snapshots, so every visible update entry shows the same state.
let snapshot: DesktopUpdateResult | null = null
let lastRevision: number | null = null
let detachFromNative: (() => void) | null = null
let generation = 0
const listeners = new Set<() => void>()

export function applyDesktopUpdateResult(
  result: DesktopUpdateResult
): DesktopUpdateResult | null {
  if (result.revision !== undefined) {
    // Native publishes a strictly increasing revision for every distinct
    // snapshot, so an equal revision is a duplicate and a lower one is stale.
    if (lastRevision !== null && result.revision <= lastRevision)
      return snapshot
    lastRevision = result.revision
  } else if (lastRevision !== null) {
    // A legacy check response may omit the revision. It must not roll back a
    // revisioned display.
    return snapshot
  }
  snapshot = result
  for (const listener of listeners) listener()
  return snapshot
}

export function getDesktopUpdateSnapshot(): DesktopUpdateResult | null {
  return snapshot
}

async function refreshActiveSnapshot(subscriptionGeneration: number) {
  try {
    const result = await getDesktopUpdateState()
    if (subscriptionGeneration !== generation || listeners.size === 0) return
    applyDesktopUpdateResult(result)
  } catch {
    if (subscriptionGeneration !== generation || listeners.size === 0) return
    const current = snapshot
    // A failed background read must not replace a good native snapshot.
    if (current === null || current.state === "idle") {
      applyDesktopUpdateResult({ state: "failed" })
    }
  }
}

export function subscribeDesktopUpdateState(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    const subscriptionGeneration = ++generation
    detachFromNative = subscribeDesktopUpdateChanged((result) => {
      if (subscriptionGeneration !== generation || listeners.size === 0) return
      applyDesktopUpdateResult(result)
    })
    // Internal subscribers share this one initial native read.
    void refreshActiveSnapshot(subscriptionGeneration)
  }
  return () => {
    if (!listeners.delete(listener)) return
    if (listeners.size > 0) return
    // A late native event or snapshot read must not revive this subscription.
    generation += 1
    detachFromNative?.()
    detachFromNative = null
    snapshot = null
    lastRevision = null
  }
}

export function useDesktopUpdateState(): DesktopUpdateResult | null {
  return useSyncExternalStore(
    subscribeDesktopUpdateState,
    getDesktopUpdateSnapshot,
    () => null
  )
}
