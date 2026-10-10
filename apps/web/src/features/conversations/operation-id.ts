import { sha256 } from "@noble/hashes/sha2.js"
import { z } from "zod"
import { createRandomUuid } from "@/lib/random-uuid"

type StableOperation = {
  fingerprint: string
  baseId: string
  id: string
  closedId?: string
}

export type OperationReference = { current: StableOperation | null }
type OperationStorage = Pick<Storage, "getItem" | "setItem">

function operationStorage(): OperationStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function closedOperationKey(baseId: string): string {
  return `linksense.closed-operation.v1:${baseId}`
}

function readClosedOperation(
  storage: OperationStorage | undefined,
  baseId: string
): string | undefined {
  try {
    const parsed = z
      .uuid()
      .safeParse(storage?.getItem(closedOperationKey(baseId)))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function retireOperationId(
  reference: OperationReference,
  id: string,
  storage: OperationStorage | undefined = operationStorage()
): void {
  const current = reference.current
  if (!current || current.id !== id) return
  reference.current = { ...current, closedId: id }
  try {
    // Persist only a confirmed closed ID, never message contents. The next ID
    // is deterministic so reloads and lost responses cannot create a new turn.
    storage?.setItem(closedOperationKey(current.baseId), id)
  } catch {
    // Without storage a reload returns to the sealed ID, which the server
    // rejects. Advancing it again derives the same next ID, never a replay.
  }
}

export function operationAttemptId(reference: {
  current: string | null
}): string {
  reference.current ??= createRandomUuid()
  return reference.current
}

export async function stableOperationId(
  reference: OperationReference,
  payload: Record<string, unknown>,
  storage: OperationStorage | undefined = operationStorage()
): Promise<string> {
  const fingerprint = JSON.stringify(payload)
  const current =
    reference.current?.fingerprint === fingerprint ? reference.current : null
  if (current && !current.closedId) return current.id
  const baseId = current?.baseId ?? (await digestOperationId(fingerprint))
  const closedId = current?.closedId ?? readClosedOperation(storage, baseId)
  const id = closedId
    ? await digestOperationId(`closed-operation:${baseId}:${closedId}`)
    : baseId
  reference.current = { fingerprint, baseId, id }
  return id
}

async function digestOperationId(value: string): Promise<string> {
  const digest = sha256(new TextEncoder().encode(value))
  digest[6] = (digest[6]! & 0x0f) | 0x50
  digest[8] = (digest[8]! & 0x3f) | 0x80
  const hex = Array.from(digest.subarray(0, 16), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}
