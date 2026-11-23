import { isDesktopHost } from "@/adapters/desktop/desktop-adapter"

const ACCESS_SESSION_STORAGE_KEY = "linksense.auth.access-session"
const DEFAULT_ACCESS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000
const MAX_TIMEOUT_MS = 2_147_483_647

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

function readStoredAccessSession(): StorageReadResult {
  if (isDesktopHost()) {
    return accessToken &&
      accessTokenExpiresAt !== null &&
      accessTokenExpiresAt > Date.now()
      ? {
          status: "valid",
          session: { accessToken, expiresAt: accessTokenExpiresAt },
        }
      : { status: "empty" }
  }
  const storage = getLocalStorage()
  if (!storage) return { status: "unavailable" }

  let storedValue: string | null
  try {
    storedValue = storage.getItem(ACCESS_SESSION_STORAGE_KEY)
  } catch {
    return { status: "unavailable" }
  }

  if (storedValue === null) return { status: "empty" }

  const session = parsePersistedAccessSession(storedValue)
  if (session) return { status: "valid", session }

  removeStoredAccessSession()
  return { status: "empty" }
}

function persistAccessSession(session: StoredAccessSession) {
  const persistedSession: PersistedAccessSession = {
    access_token: session.accessToken,
    expires_at: session.expiresAt,
  }

  try {
    getLocalStorage()?.setItem(
      ACCESS_SESSION_STORAGE_KEY,
      JSON.stringify(persistedSession)
    )
  } catch {
    // Keep the token in memory when storage is blocked or full.
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

function scheduleExpiration() {
  clearExpirationTimer()
  if (!accessToken || accessTokenExpiresAt === null) return

  const delay = accessTokenExpiresAt - Date.now()
  if (delay <= 0) {
    updateAccessSession(null, null, { persist: true, notify: false })
    return
  }

  expirationTimer = setTimeout(
    () => {
      if (accessTokenExpiresAt !== null && accessTokenExpiresAt <= Date.now()) {
        updateAccessSession(null, null, { persist: true, notify: false })
        return
      }
      scheduleExpiration()
    },
    Math.min(delay, MAX_TIMEOUT_MS)
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
  accessToken = token
  accessTokenExpiresAt = expiresAt

  if (options.persist) {
    if (token && expiresAt !== null) {
      persistAccessSession({ accessToken: token, expiresAt })
    } else {
      removeStoredAccessSession()
    }
  }

  scheduleExpiration()
  if (options.notify) notifyListeners(token, options.reason ?? "session")
}

function decodeJwtExpiration(token: string) {
  const payloadSegment = token.split(".")[1]
  if (!payloadSegment || typeof atob !== "function") return null

  try {
    const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const binaryPayload = atob(padded)
    const bytes = Uint8Array.from(binaryPayload, (character) =>
      character.charCodeAt(0)
    )
    const jsonPayload = new TextDecoder().decode(bytes)
    const payload = JSON.parse(jsonPayload) as unknown
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("exp" in payload)
    ) {
      return null
    }
    const expiration = payload.exp
    return typeof expiration === "number" && Number.isFinite(expiration)
      ? expiration * 1000
      : null
  } catch {
    return null
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

export function beginLoginSession(): LoginSessionBoundary {
  loginSessionBoundary += 1
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
  if (result.status === "unavailable") return getAccessToken()

  const nextSession = result.status === "valid" ? result.session : null
  const nextToken = nextSession?.accessToken ?? null
  const nextExpiresAt = nextSession?.expiresAt ?? null
  const changed =
    accessToken !== nextToken || accessTokenExpiresAt !== nextExpiresAt

  updateAccessSession(nextToken, nextExpiresAt, {
    persist: false,
    notify: changed,
    reason: "storage",
  })
  return nextToken
}

export function hasUsableAccessToken() {
  return getStoredAccessSession() !== null || getAccessToken() !== null
}

export function getAccessToken() {
  if (accessTokenExpiresAt !== null && accessTokenExpiresAt <= Date.now()) {
    updateAccessSession(null, null, { persist: true, notify: false })
  }
  return accessToken
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

  if (event.key === ACCESS_SESSION_STORAGE_KEY && event.newValue !== null) {
    const session = parsePersistedAccessSession(event.newValue)
    if (session) {
      const changed =
        accessToken !== session.accessToken ||
        accessTokenExpiresAt !== session.expiresAt
      updateAccessSession(session.accessToken, session.expiresAt, {
        persist: false,
        notify: changed,
        reason: "storage",
      })
      return
    }
    removeStoredAccessSession()
  }

  if (
    event.key === ACCESS_SESSION_STORAGE_KEY &&
    event.newValue === null &&
    accessTokenExpiresAt !== null &&
    accessTokenExpiresAt <= Date.now()
  ) {
    updateAccessSession(null, null, { persist: false, notify: false })
    return
  }

  restoreAccessTokenFromStorage()
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", handleStorageEvent)
  restoreAccessTokenFromStorage()
}
