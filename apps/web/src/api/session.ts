import {
  accessTokenClaimsSchema,
  type AccessTokenClaims,
} from "@linksense/shared"

const ACCESS_SESSION_STORAGE_KEY = "linksense.auth.access-session"
const DEFAULT_ACCESS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000
const MAX_TIMEOUT_MS = 2_147_483_647
const accessTokenIdentitySchema = accessTokenClaimsSchema
  .pick({ sub: true, role: true })
  .strip()

export type StoredAccessSession = {
  accessToken: string
  expiresAt: number
}

type PersistedAccessSession = {
  access_token: string
  expires_at: number
}

type SessionListener = (token: string | null) => void
type StorageReadResult =
  | { status: "unavailable" }
  | { status: "empty" }
  | { status: "valid"; session: StoredAccessSession }

let accessToken: string | null = null
let accessTokenExpiresAt: number | null = null
let expirationTimer: ReturnType<typeof setTimeout> | null = null
let sessionRevision = 0
let signOutRevision = 0
let failedWriteBackingValue: string | null | undefined

const listeners = new Set<SessionListener>()

function getLocalStorage() {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function removeStoredAccessSession() {
  try {
    getLocalStorage()?.removeItem(ACCESS_SESSION_STORAGE_KEY)
  } catch {
    // The in-memory session remains usable when storage is unavailable.
  }
}

function readStoredValue(storage: Storage | null) {
  try {
    return storage?.getItem(ACCESS_SESSION_STORAGE_KEY)
  } catch {
    return undefined
  }
}

function parsePersistedAccessSession(
  value: string | null
): StoredAccessSession | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as unknown
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("access_token" in parsed) ||
      !("expires_at" in parsed)
    ) {
      return null
    }

    const accessTokenValue = parsed.access_token
    const expiresAtValue = parsed.expires_at
    if (
      typeof accessTokenValue !== "string" ||
      accessTokenValue.length === 0 ||
      typeof expiresAtValue !== "number" ||
      !Number.isFinite(expiresAtValue) ||
      expiresAtValue <= Date.now()
    ) {
      return null
    }

    return { accessToken: accessTokenValue, expiresAt: expiresAtValue }
  } catch {
    return null
  }
}

function readStoredAccessSession(removeInvalid = true): StorageReadResult {
  const storedValue = readStoredValue(getLocalStorage())
  if (storedValue === undefined || storedValue === failedWriteBackingValue) {
    return { status: "unavailable" }
  }
  failedWriteBackingValue = undefined

  if (storedValue === null) return { status: "empty" }

  const session = parsePersistedAccessSession(storedValue)
  if (session) return { status: "valid", session }

  if (removeInvalid) removeStoredAccessSession()
  return { status: "empty" }
}

function persistAccessSession(session: StoredAccessSession | null) {
  const storage = getLocalStorage()
  if (!storage) return
  const previousValue = readStoredValue(storage)

  try {
    if (session) {
      const persistedSession: PersistedAccessSession = {
        access_token: session.accessToken,
        expires_at: session.expiresAt,
      }
      storage.setItem(
        ACCESS_SESSION_STORAGE_KEY,
        JSON.stringify(persistedSession)
      )
    } else {
      storage.removeItem(ACCESS_SESSION_STORAGE_KEY)
    }
    failedWriteBackingValue = undefined
  } catch {
    failedWriteBackingValue = previousValue
  }
}

function notifyListeners(token: string | null) {
  for (const listener of listeners) {
    listener(token)
  }
}

function clearExpirationTimer() {
  if (expirationTimer !== null) {
    clearTimeout(expirationTimer)
    expirationTimer = null
  }
}

function hasExpired() {
  return accessTokenExpiresAt !== null && accessTokenExpiresAt <= Date.now()
}

function scheduleExpiration() {
  clearExpirationTimer()
  if (!accessToken || accessTokenExpiresAt === null) return

  const delay = accessTokenExpiresAt - Date.now()
  expirationTimer = setTimeout(
    () => {
      if (hasExpired()) {
        restoreAccessTokenFromStorage()
        return
      }
      scheduleExpiration()
    },
    Math.max(0, Math.min(delay, MAX_TIMEOUT_MS))
  )
}

function updateAccessSession(
  token: string | null,
  expiresAt: number | null,
  options: { persist: boolean; notify: boolean }
) {
  if (options.notify) {
    if (token !== accessToken || token === null) sessionRevision += 1
    if (token === null) signOutRevision += 1
  }
  accessToken = token
  accessTokenExpiresAt = expiresAt

  if (options.persist) {
    persistAccessSession(
      token && expiresAt !== null ? { accessToken: token, expiresAt } : null
    )
  }

  scheduleExpiration()
  if (options.notify) notifyListeners(token)
}

function decodeJwtPayload(token: string): unknown {
  const payloadSegment = token.split(".")[1]
  if (!payloadSegment || typeof atob !== "function") return null

  try {
    const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const binaryPayload = atob(padded)
    const bytes = Uint8Array.from(binaryPayload, (character) =>
      character.charCodeAt(0)
    )
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

function decodeJwtExpiration(token: string) {
  const payload = decodeJwtPayload(token)
  if (typeof payload !== "object" || payload === null || !("exp" in payload)) {
    return null
  }
  return typeof payload.exp === "number" && Number.isFinite(payload.exp)
    ? payload.exp * 1000
    : null
}

export function readAccessTokenIdentity(
  token: string | null
): { id: string; role: AccessTokenClaims["role"] } | null {
  if (!token || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null

  const claims = accessTokenIdentitySchema.safeParse(decodeJwtPayload(token))
  return claims.success ? { id: claims.data.sub, role: claims.data.role } : null
}

export function captureAccessSessionGuard(
  { allowSameAccountRotation = false } = {}
): () => boolean {
  const token = accessToken
  const expiresAt = accessTokenExpiresAt
  const revision = sessionRevision
  const signedOut = signOutRevision
  const previous = allowSameAccountRotation ? readAccessTokenIdentity(token) : null

  const matchesToken = (candidate: string | null) => {
    if (candidate === token) return true
    if (candidate === null) {
      return (accessTokenExpiresAt ?? expiresAt ?? Infinity) <= Date.now()
    }
    if (!previous) return false
    const next = readAccessTokenIdentity(candidate)
    return previous.id === next?.id && previous.role === next.role
  }

  return () => {
    if (signedOut !== signOutRevision) return false
    if (!allowSameAccountRotation && revision !== sessionRevision) return false
    if (!matchesToken(accessToken)) return false
    const stored = readStoredAccessSession(false)
    return (
      stored.status === "unavailable" ||
      matchesToken(stored.status === "valid" ? stored.session.accessToken : null)
    )
  }
}

function normalizeExpiration(
  token: string,
  expiresAt?: string | number | Date | null
) {
  if (expiresAt instanceof Date) {
    const timestamp = expiresAt.getTime()
    if (Number.isFinite(timestamp)) return timestamp
  } else if (typeof expiresAt === "string") {
    const timestamp = Date.parse(expiresAt)
    if (Number.isFinite(timestamp)) return timestamp
  } else if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return expiresAt
  }

  return decodeJwtExpiration(token) ?? Date.now() + DEFAULT_ACCESS_TOKEN_TTL_MS
}

export function getStoredAccessSession(): StoredAccessSession | null {
  const result = readStoredAccessSession()
  return result.status === "valid" ? result.session : null
}

export function restoreAccessTokenFromStorage() {
  const result = readStoredAccessSession()
  if (result.status === "unavailable") {
    if (hasExpired()) {
      updateAccessSession(null, null, { persist: false, notify: false })
    }
    return accessToken
  }

  const nextSession = result.status === "valid" ? result.session : null
  const nextToken = nextSession?.accessToken ?? null
  const nextExpiresAt = nextSession?.expiresAt ?? null
  if (accessToken === nextToken && accessTokenExpiresAt === nextExpiresAt) {
    return accessToken
  }

  updateAccessSession(nextToken, nextExpiresAt, {
    persist: false,
    notify: nextSession !== null || !hasExpired(),
  })
  return accessToken
}

export function hasUsableAccessToken() {
  return getStoredAccessSession() !== null || getAccessToken() !== null
}

export function getAccessToken() {
  return hasExpired() ? restoreAccessTokenFromStorage() : accessToken
}

export function setAccessToken(
  token: string | null,
  expiresAt?: string | number | Date | null
) {
  if (!token) {
    updateAccessSession(null, null, { persist: true, notify: true })
    return
  }

  const normalizedExpiration = normalizeExpiration(token, expiresAt)
  if (normalizedExpiration <= Date.now()) {
    updateAccessSession(null, null, { persist: true, notify: true })
    return
  }

  updateAccessSession(token, normalizedExpiration, {
    persist: true,
    notify: true,
  })
}

export function subscribeToAccessToken(listener: SessionListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function handleStorageEvent(event: StorageEvent) {
  if (event.key !== null && event.key !== ACCESS_SESSION_STORAGE_KEY) return
  if (event.storageArea !== getLocalStorage()) return
  restoreAccessTokenFromStorage()
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", handleStorageEvent)
  restoreAccessTokenFromStorage()
}
