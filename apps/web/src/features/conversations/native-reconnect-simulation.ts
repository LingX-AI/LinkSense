import { useCallback, useEffect, useMemo, useState } from "react"
import { z } from "zod"

import { getNativeCodexPayload, type ConversationEvent } from "@/api/contracts"

export const nativeReconnectRoundCount = 3
export const nativeReconnectAttemptsPerRound = 5
export const nativeReconnectAttemptIntervalMs = 5_000
export const nativeReconnectStorageKeyPrefix = "linksense.native-reconnect.v2"

const nativeReconnectSnapshotSchema = z
  .object({
    version: z.literal(2),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    phase: z.enum(["reconnecting", "failed"]),
    round: z.number().int().min(1).max(nativeReconnectRoundCount),
    attempt: z.number().int().min(1).max(nativeReconnectAttemptsPerRound),
    startedAtMs: z.number().int().nonnegative(),
    nextAttemptAtMs: z.number().int().nonnegative().nullable(),
  })
  .refine(
    (value) =>
      value.phase === "reconnecting"
        ? value.nextAttemptAtMs !== null
        : value.round === nativeReconnectRoundCount &&
          value.attempt === nativeReconnectAttemptsPerRound &&
          value.nextAttemptAtMs === null,
    { message: "Invalid native reconnect phase state" }
  )

export type NativeReconnectSnapshot = z.infer<
  typeof nativeReconnectSnapshotSchema
>

export type NativeReconnectDisplayState = Readonly<
  Pick<NativeReconnectSnapshot, "turnId" | "phase" | "round" | "attempt"> & {
    roundCount: typeof nativeReconnectRoundCount
    attemptsPerRound: typeof nativeReconnectAttemptsPerRound
    stoppedAtMs?: number
  }
>

const nativeReconnectStoreChangedEvent =
  "linksense:native-reconnect-store-changed"

function getStorageKey(conversationId: string) {
  return `${nativeReconnectStorageKeyPrefix}:${conversationId}`
}

function getBrowserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function snapshotsEqual(
  left: NativeReconnectSnapshot,
  right: NativeReconnectSnapshot
) {
  return (
    left.phase === right.phase &&
    left.round === right.round &&
    left.attempt === right.attempt &&
    left.nextAttemptAtMs === right.nextAttemptAtMs
  )
}

function toDisplayState(
  snapshot: NativeReconnectSnapshot
): NativeReconnectDisplayState {
  return {
    phase: snapshot.phase,
    turnId: snapshot.turnId,
    round: snapshot.round,
    attempt: snapshot.attempt,
    roundCount: nativeReconnectRoundCount,
    attemptsPerRound: nativeReconnectAttemptsPerRound,
    ...(snapshot.phase === "failed"
      ? {
          stoppedAtMs:
            snapshot.startedAtMs +
            nativeReconnectAttemptIntervalMs *
              nativeReconnectRoundCount *
              nativeReconnectAttemptsPerRound,
        }
      : {}),
  }
}

let nativeReconnectNotificationScheduled = false

function notifyNativeReconnectStoreChanged() {
  if (typeof window === "undefined" || nativeReconnectNotificationScheduled) {
    return
  }
  nativeReconnectNotificationScheduled = true
  window.queueMicrotask(() => {
    nativeReconnectNotificationScheduled = false
    window.dispatchEvent(new Event(nativeReconnectStoreChangedEvent))
  })
}

function parseNativeReconnectSnapshot(
  storage: Storage | undefined,
  conversationId: string
): NativeReconnectSnapshot | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(getStorageKey(conversationId))
    if (!raw) return null
    const parsed = nativeReconnectSnapshotSchema.safeParse(JSON.parse(raw))
    return parsed.success && parsed.data.conversationId === conversationId
      ? parsed.data
      : null
  } catch {
    return null
  }
}

export function hasNativeReconnectFailure(conversationId: string) {
  return (
    parseNativeReconnectSnapshot(getBrowserStorage(), conversationId)?.phase ===
    "failed"
  )
}

export function useNativeReconnectStoreRevision() {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const handleStoreChange = () => {
      setRevision((current) => current + 1)
    }
    const handleStorage = (event: StorageEvent) => {
      if (
        event.storageArea === window.localStorage &&
        event.key?.startsWith(`${nativeReconnectStorageKeyPrefix}:`)
      ) {
        handleStoreChange()
      }
    }
    window.addEventListener(nativeReconnectStoreChangedEvent, handleStoreChange)
    window.addEventListener("storage", handleStorage)
    return () => {
      window.removeEventListener(
        nativeReconnectStoreChangedEvent,
        handleStoreChange
      )
      window.removeEventListener("storage", handleStorage)
    }
  }, [])

  return revision
}

export function createNativeReconnectSnapshot({
  conversationId,
  turnId,
  nowMs,
}: {
  conversationId: string
  turnId: string
  nowMs: number
}): NativeReconnectSnapshot {
  return {
    version: 2,
    conversationId,
    turnId,
    phase: "reconnecting",
    round: 1,
    attempt: 1,
    startedAtMs: nowMs,
    nextAttemptAtMs: nowMs + nativeReconnectAttemptIntervalMs,
  }
}

export function advanceNativeReconnectSnapshot(
  snapshot: NativeReconnectSnapshot,
  nowMs: number
): NativeReconnectSnapshot {
  if (
    snapshot.phase === "failed" ||
    snapshot.nextAttemptAtMs === null ||
    nowMs < snapshot.nextAttemptAtMs
  ) {
    return snapshot
  }

  let next = snapshot
  while (
    next.phase === "reconnecting" &&
    next.nextAttemptAtMs !== null &&
    nowMs >= next.nextAttemptAtMs
  ) {
    const nextAttemptAtMs =
      next.nextAttemptAtMs + nativeReconnectAttemptIntervalMs
    if (next.attempt < nativeReconnectAttemptsPerRound) {
      next = {
        ...next,
        attempt: next.attempt + 1,
        nextAttemptAtMs,
      }
      continue
    }
    if (next.round < nativeReconnectRoundCount) {
      next = {
        ...next,
        round: next.round + 1,
        attempt: 1,
        nextAttemptAtMs,
      }
      continue
    }
    next = {
      ...next,
      phase: "failed",
      nextAttemptAtMs: null,
    }
  }
  return next
}

export function readNativeReconnectSnapshot(
  storage: Storage | undefined,
  conversationId: string,
  turnId: string
): NativeReconnectSnapshot | null {
  if (!storage) return null
  const key = getStorageKey(conversationId)
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = parseNativeReconnectSnapshot(storage, conversationId)
    if (!parsed || parsed.turnId !== turnId) {
      removeNativeReconnectSnapshot(storage, conversationId)
      return null
    }
    return parsed
  } catch {
    removeNativeReconnectSnapshot(storage, conversationId)
    return null
  }
}

export function writeNativeReconnectSnapshot(
  storage: Storage | undefined,
  snapshot: NativeReconnectSnapshot
) {
  if (!storage) return
  try {
    storage.setItem(
      getStorageKey(snapshot.conversationId),
      JSON.stringify(snapshot)
    )
    notifyNativeReconnectStoreChanged()
  } catch {
    // Storage is optional. The reconnect simulation continues in memory.
  }
}

export function removeNativeReconnectSnapshot(
  storage: Storage | undefined,
  conversationId: string
) {
  if (!storage) return
  try {
    const key = getStorageKey(conversationId)
    if (storage.getItem(key) === null) return
    storage.removeItem(key)
    notifyNativeReconnectStoreChanged()
  } catch {
    // Storage is optional. Clearing the in-memory state is still sufficient.
  }
}

export function isNativeStreamDisconnectRetry(event: ConversationEvent) {
  const native = getNativeCodexPayload(event)
  if (native?.method !== "error" || !native.params.willRetry) return false

  const errorInfo = native.params.error.codexErrorInfo
  return (
    typeof errorInfo === "object" &&
    errorInfo !== null &&
    "responseStreamDisconnected" in errorInfo
  )
}

export function useNativeReconnectSimulation({
  conversationId,
  turnId,
}: {
  conversationId?: string
  turnId?: string
}) {
  const scopeKey =
    conversationId && turnId ? `${conversationId}:${turnId}` : undefined
  const displayScopeKey =
    scopeKey ??
    (conversationId ? `${conversationId}:no-running-turn` : undefined)
  const [snapshot, setSnapshot] = useState<NativeReconnectSnapshot | null>(null)
  const [hydratedScopeKey, setHydratedScopeKey] = useState<string>()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!conversationId) {
        setSnapshot(null)
        setHydratedScopeKey(displayScopeKey)
        return
      }
      if (!turnId || !scopeKey) {
        const persisted = parseNativeReconnectSnapshot(
          getBrowserStorage(),
          conversationId
        )
        setSnapshot(persisted?.phase === "failed" ? persisted : null)
        setHydratedScopeKey(displayScopeKey)
        return
      }
      const storage = getBrowserStorage()
      const persisted = readNativeReconnectSnapshot(
        storage,
        conversationId,
        turnId
      )
      const next = persisted
        ? advanceNativeReconnectSnapshot(persisted, Date.now())
        : null
      if (next && next !== persisted) {
        writeNativeReconnectSnapshot(storage, next)
      }
      setSnapshot(next)
      setHydratedScopeKey(displayScopeKey)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [conversationId, displayScopeKey, scopeKey, turnId])

  const start = useCallback(() => {
    if (!conversationId || !turnId || !scopeKey) return
    const nowMs = Date.now()
    const storage = getBrowserStorage()
    setSnapshot((current) => {
      const persisted = readNativeReconnectSnapshot(
        storage,
        conversationId,
        turnId
      )
      const base =
        current?.conversationId === conversationId && current.turnId === turnId
          ? current
          : (persisted ??
            createNativeReconnectSnapshot({
              conversationId,
              turnId,
              nowMs,
            }))
      const next = advanceNativeReconnectSnapshot(base, nowMs)
      writeNativeReconnectSnapshot(storage, next)
      return next
    })
    setHydratedScopeKey(scopeKey)
  }, [conversationId, scopeKey, turnId])

  const clear = useCallback(() => {
    if (!conversationId) return
    const storage = getBrowserStorage()
    const persisted = parseNativeReconnectSnapshot(storage, conversationId)
    if (
      persisted?.phase === "failed" &&
      (!turnId || persisted.turnId === turnId)
    ) {
      setSnapshot(persisted)
      setHydratedScopeKey(displayScopeKey)
      return
    }
    removeNativeReconnectSnapshot(storage, conversationId)
    setSnapshot(null)
    setHydratedScopeKey(displayScopeKey)
  }, [conversationId, displayScopeKey, turnId])

  const activeSnapshot =
    snapshot &&
    snapshot.conversationId === conversationId &&
    snapshot.turnId === turnId
      ? snapshot
      : null
  const failedSnapshot =
    snapshot &&
    snapshot.conversationId === conversationId &&
    snapshot.phase === "failed"
      ? snapshot
      : null

  useEffect(() => {
    if (
      !activeSnapshot ||
      activeSnapshot.phase === "failed" ||
      activeSnapshot.nextAttemptAtMs === null
    ) {
      return
    }
    const delay = Math.max(0, activeSnapshot.nextAttemptAtMs - Date.now())
    const timer = window.setTimeout(() => {
      const nowMs = Date.now()
      setSnapshot((current) => {
        if (
          !current ||
          current.conversationId !== conversationId ||
          current.turnId !== turnId
        ) {
          return current
        }
        const next = advanceNativeReconnectSnapshot(current, nowMs)
        if (snapshotsEqual(current, next)) return current
        writeNativeReconnectSnapshot(getBrowserStorage(), next)
        return next
      })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [
    activeSnapshot,
    conversationId,
    activeSnapshot?.nextAttemptAtMs,
    activeSnapshot?.phase,
    turnId,
  ])

  const state = useMemo<NativeReconnectDisplayState | null | undefined>(() => {
    if (!displayScopeKey || hydratedScopeKey !== displayScopeKey) {
      return undefined
    }
    if (activeSnapshot) return toDisplayState(activeSnapshot)
    return !turnId && failedSnapshot ? toDisplayState(failedSnapshot) : null
  }, [
    activeSnapshot,
    displayScopeKey,
    failedSnapshot,
    hydratedScopeKey,
    turnId,
  ])

  return { state, start, clear }
}
