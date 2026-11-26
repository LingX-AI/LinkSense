import {
  accessTokenClaimsSchema,
  type AccessTokenClaims,
} from "@linksense/shared"

import { isDesktopHost } from "@/adapters/desktop/desktop-adapter"

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

type SessionListener = (
  token: string | null,
  reason: SessionChangeReason
) => void
type LoginSessionListener = (boundary: LoginSessionBoundary) => void
/**
 * "session" changes come from an explicit credential decision (accept, rotate,
 * sign-out, or a definitive refresh rejection). "storage" changes only
 * synchronize the in-memory token with localStorage, so an empty read is not a
 * verified session ending.
 */
export type SessionChangeReason = "session" | "storage"
export type LoginSessionChange = "sign-in" | "sign-out"
export type LoginSessionBoundary = number
type StorageReadResult =
  | { status: "unavailable" }
  | { status: "empty" }
  | { status: "valid"; session: StoredAccessSession }

let accessToken: string | null = null
let accessTokenExpiresAt: number | null = null
let expirationTimer: ReturnType<typeof setTimeout> | null = null
// A token rotation is not a new login. Only an explicit session replacement
// (sign-out intent or accepting a session) advances this boundary.
let loginSessionBoundary: LoginSessionBoundary = 0
// Callers distinguish a first sign-in, which may keep a buffered approval
// click for the matched owner, from a sign-out that must clear it.
let loginSessionChange: LoginSessionChange = "sign-out"
// Credential revision tracking pairs with the login boundary: the boundary
// names the login that admitted work, while the guard below also detects
// same-tab credential changes (rotation, definitive clear, cross-tab sync).
let sessionRevision = 0
let signOutRevision = 0
let failedWriteBackingValue: string | null | undefined

const listeners = new Set<SessionListener>()
const loginSessionListeners = new Set<LoginSessionListener>()

function getLocalStorage() {
  if (typeof window === "undefined" || isDesktopHost()) return null
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
  if (isDesktopHost()) {
    // The native host owns desktop credentials, so there is no shared storage
    // to read and the in-memory session is the only source of truth.
    return accessToken &&
      accessTokenExpiresAt !== null &&
      accessTokenExpiresAt > Date.now()
      ? {
          status: "valid",
          session: { accessToken, expiresAt: accessTokenExpiresAt },
        }
      : { status: "empty" }
  }
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
    // Keep the token in memory when storage is blocked or full, and remember
    // which value the failed write was based on so a stale read is not
    // mistaken for a verified session.
    failedWriteBackingValue = previousValue
  }
}

function notifyListeners(token: string | null, reason: SessionChangeReason) {
  for (const listener of listeners) {
    listener(token, reason)
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
        // Re-read the shared slot first: another tab may have persisted a
        // newer session before this token expired.
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
  options: {
    persist: boolean
    notify: boolean
    reason?: SessionChangeReason
  }
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
  if (options.notify) notifyListeners(token, options.reason ?? "session")
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

export function getLoginSessionBoundary(): LoginSessionBoundary {
  return loginSessionBoundary
}

export function getLoginSessionChange(): LoginSessionChange {
  return loginSessionChange
}

/**
 * Observes an explicit login replacement (sign-out intent, an accepted
 * session, or a definitive authentication clear). Token rotation keeps the
 * boundary and never notifies. Cleanup must not break the auth transition, so
 * a failing listener is isolated.
 */
export function subscribeToLoginSession(listener: LoginSessionListener) {
  loginSessionListeners.add(listener)
  return () => {
    loginSessionListeners.delete(listener)
  }
}

export function beginLoginSession(
  change: LoginSessionChange = "sign-out"
): LoginSessionBoundary {
  loginSessionBoundary += 1
  loginSessionChange = change
  for (const listener of loginSessionListeners) {
    try {
      listener(loginSessionBoundary)
    } catch {
      // A cleanup listener cannot veto ending the previous login.
    }
  }
  return loginSessionBoundary
}

export function isLoginSessionCurrent(boundary: LoginSessionBoundary) {
  return boundary === loginSessionBoundary
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
    reason: "storage",
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
  if (isDesktopHost()) return
  if (event.key !== null && event.key !== ACCESS_SESSION_STORAGE_KEY) return
  if (event.storageArea !== getLocalStorage()) return
  restoreAccessTokenFromStorage()
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", handleStorageEvent)
  restoreAccessTokenFromStorage()
}
