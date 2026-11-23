import { z } from "zod"
import { createRandomUuid } from "@/lib/random-uuid"
import {
  getDesktopServerUrl,
  hostFetch,
  isDesktopHost,
  isMacDesktopHost,
  requireDesktopUpdate,
} from "@/adapters/desktop/desktop-adapter"
import {
  shouldBlockWorkspaceUiDemoWrite,
  shouldUseWorkspaceUiDemo,
} from "@/features/ui-demo/workspace-ui-demo-mode"
import {
  CLIENT_BUILD_HEADER,
  SERVER_BUILD_HEADER,
  isLocale,
  DESKTOP_PROTOCOL_HEADER,
  desktopProtocolVersion,
  DESKTOP_LEGACY_BUILD_SENTINEL,
} from "@linksense/shared"
import {
  getClientBuildId,
  getPendingClientBuild,
  observeServerBuild,
} from "@/app/client-build"

import { authSessionSchema, type AccessSession } from "@/api/contracts"
import {
  getAccessToken,
  getLoginSessionBoundary,
  getStoredAccessSession,
  isLoginSessionCurrent,
  restoreAccessTokenFromStorage,
  setAccessToken,
  type LoginSessionBoundary,
} from "@/api/session"

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
    /\/$/,
    ""
  ) ?? ""

const successEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: z.unknown(),
  })
  .passthrough()

const errorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    error_code: z.string(),
    message_key: z.string().optional(),
    message: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export class ApiError extends Error {
  readonly status: number
  readonly errorCode: string
  readonly messageKey?: string
  readonly params?: Record<string, unknown>

  constructor(options: {
    status: number
    errorCode: string
    message?: string
    messageKey?: string
    params?: Record<string, unknown>
  }) {
    super(options.message ?? options.errorCode)
    this.name = "ApiError"
    this.status = options.status
    this.errorCode = options.errorCode
    this.messageKey = options.messageKey
    this.params = options.params
  }
}

export function prepareClientBuildRequest(
  headers: Headers,
  path?: string
): void {
  if (isDesktopHost()) {
    headers.set(DESKTOP_PROTOCOL_HEADER, String(desktopProtocolVersion))
    headers.set(CLIENT_BUILD_HEADER, DESKTOP_LEGACY_BUILD_SENTINEL)
    return
  }
  if (getPendingClientBuild() && path !== "/system/bootstrap") {
    throw new ApiError({ status: 409, errorCode: "CLIENT_UPDATE_REQUIRED" })
  }
  const buildId = getClientBuildId()
  if (buildId) headers.set(CLIENT_BUILD_HEADER, buildId)
}

export function validateResponseBuild(headers: Headers): void {
  if (isDesktopHost()) {
    if (
      headers.get(DESKTOP_PROTOCOL_HEADER) !== String(desktopProtocolVersion)
    ) {
      requireDesktopUpdate()
      throw new ApiError({ status: 409, errorCode: "DESKTOP_UPDATE_REQUIRED" })
    }
    return
  }
  if (observeServerBuild(headers.get(SERVER_BUILD_HEADER))) {
    throw new ApiError({ status: 409, errorCode: "CLIENT_UPDATE_REQUIRED" })
  }
}

export function validateUploadResponseBuild(request: XMLHttpRequest): void {
  if (!getClientBuildId()) return
  const headers = new Headers()
  const buildId = request.getResponseHeader(SERVER_BUILD_HEADER)
  if (buildId) headers.set(SERVER_BUILD_HEADER, buildId)
  validateResponseBuild(headers)
}

export type QueryValue = string | number | boolean | null | undefined

export function buildApiUrl(path: string, query?: Record<string, QueryValue>) {
  const baseUrl = getDesktopServerUrl() ?? API_BASE_URL
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const url = new URL(
    `${baseUrl}/api/v1${normalizedPath}`,
    window.location.href
  )

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value))
      }
    }
  }

  return baseUrl ? url.toString() : `${url.pathname}${url.search}`
}

type RequestOptions<TSchema extends z.ZodType> = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown | FormData
  query?: Record<string, QueryValue>
  schema: TSchema
  signal?: AbortSignal
  cache?: RequestCache
  priority?: RequestPriority
  skipRefresh?: boolean
}

/**
 * apiRequest-only option. Upload options inherit RequestOptions, and uploads
 * never run an attempt guard.
 */
export type ApiRequestOptions<TSchema extends z.ZodType> =
  RequestOptions<TSchema> & {
    /**
     * Optional synchronous eligibility check for opt-in writes. It runs
     * immediately before each physical attempt, including the retry after an
     * authenticated refresh. A rejection is not an HTTP response, so it never
     * drives authentication renewal or clears the session.
     */
    beforeAttempt?: () => void
    /**
     * Optional live login-session identity captured when a write was admitted.
     * Defaults to the boundary captured when the request begins. Token refresh
     * keeps it unchanged; sign-out or accepting another session advances it. A
     * stale boundary prevents refresh, retry, and token clearing from crossing
     * into the replacement login.
     */
    loginSessionBoundary?: LoginSessionBoundary
  }

export type ApiUploadRequestOptions<TSchema extends z.ZodType> = Omit<
  RequestOptions<TSchema>,
  "body" | "cache"
> & {
  body: FormData
  onUploadProgress?: (percentage: number) => void
}

export type ApiStreamRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown | FormData
  signal?: AbortSignal
  skipRefresh?: boolean
}

let refreshPromise: {
  loginSessionBoundary: LoginSessionBoundary
  promise: Promise<AccessSession>
} | null = null

function createSupersededLoginError() {
  // A replacement login owns the session now, so this is a local cancellation
  // rather than a server authentication decision. Direct stream consumers
  // already stop on AbortError without clearing the replacement credentials.
  return new DOMException(
    "Request superseded by a newer login session",
    "AbortError"
  )
}

function assertRefreshSessionCurrent(
  loginSessionBoundary: LoginSessionBoundary
) {
  if (isLoginSessionCurrent(loginSessionBoundary)) return
  throw createSupersededLoginError()
}

function assertResponseLoginSessionCurrent(
  response: Response,
  loginSessionBoundary?: LoginSessionBoundary
) {
  if (
    loginSessionBoundary === undefined ||
    isLoginSessionCurrent(loginSessionBoundary)
  ) {
    return
  }
  // Cancel the unread body so native fetch can close its channel.
  void response.body?.cancel().catch(() => undefined)
  throw createSupersededLoginError()
}

function assertResponseBodyLoginSessionCurrent(
  loginSessionBoundary?: LoginSessionBoundary
) {
  if (
    loginSessionBoundary === undefined ||
    isLoginSessionCurrent(loginSessionBoundary)
  ) {
    return
  }
  // Body consumption has already finished, so there is nothing to cancel.
  throw createSupersededLoginError()
}

const REFRESH_LOCK_NAME = "linksense.auth.refresh.v1"
const REFRESH_LEASE_STORAGE_KEY = "linksense.auth.refresh-lease.v1"
const REFRESH_LEASE_DURATION_MS = 10_000
const REFRESH_LEASE_RENEW_INTERVAL_MS = 3_000
const REFRESH_LEASE_POLL_INTERVAL_MS = 100

type RefreshLease = {
  ownerId: string
  expiresAt: number
}

export function isDefinitiveAuthenticationError(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    (error.errorCode === "AUTH_REQUIRED" ||
      error.errorCode === "AUTH_SESSION_EXPIRED")
  )
}

export function isRetryableApiError(error: unknown) {
  return (
    error instanceof ApiError && (error.status === 0 || error.status >= 500)
  )
}

function createRefreshOwnerId() {
  return createRandomUuid()
}

function readRefreshLease() {
  try {
    const value = window.localStorage.getItem(REFRESH_LEASE_STORAGE_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as unknown
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("ownerId" in parsed) ||
      !("expiresAt" in parsed) ||
      typeof parsed.ownerId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null
    }
    return {
      ownerId: parsed.ownerId,
      expiresAt: parsed.expiresAt,
    } satisfies RefreshLease
  } catch {
    return null
  }
}

function writeRefreshLease(lease: RefreshLease) {
  try {
    window.localStorage.setItem(
      REFRESH_LEASE_STORAGE_KEY,
      JSON.stringify(lease)
    )
    return true
  } catch {
    return false
  }
}

function releaseRefreshLease(ownerId: string) {
  try {
    if (readRefreshLease()?.ownerId === ownerId) {
      window.localStorage.removeItem(REFRESH_LEASE_STORAGE_KEY)
    }
  } catch {
    // The refresh request remains valid when storage becomes unavailable.
  }
}

function waitForRefreshLease() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, REFRESH_LEASE_POLL_INTERVAL_MS)
  })
}

async function parseError(
  response: Response,
  loginSessionBoundary?: LoginSessionBoundary
) {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    assertResponseBodyLoginSessionCurrent(loginSessionBoundary)
    throw new ApiError({
      status: response.status,
      errorCode:
        response.status === 0
          ? "NETWORK_UNAVAILABLE"
          : response.status >= 500
            ? "SERVICE_TEMPORARILY_UNAVAILABLE"
            : "API_RESPONSE_INVALID",
    })
  }
  assertResponseBodyLoginSessionCurrent(loginSessionBoundary)

  const parsed = errorEnvelopeSchema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError({
      status: response.status,
      errorCode: "API_RESPONSE_INVALID",
    })
  }

  throw new ApiError({
    status: response.status,
    errorCode: parsed.data.error_code,
    message: parsed.data.message,
    messageKey: parsed.data.message_key,
    params: parsed.data.params,
  })
}

async function rawRequest<TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
  accessTokenOverride?: string | null,
  loginSessionBoundary?: LoginSessionBoundary
) {
  const headers = new Headers({ Accept: "application/json" })
  prepareClientBuildRequest(headers, path)
  const language = document.documentElement.lang
  if (isLocale(language)) {
    headers.set("Accept-Language", language)
  }
  const token =
    accessTokenOverride === undefined ? getAccessToken() : accessTokenOverride
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers.set("Content-Type", "application/json")
    body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await hostFetch(buildApiUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "include",
      signal: options.signal,
      cache: options.cache ?? "no-store",
      ...(options.priority ? { priority: options.priority } : {}),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error
    }
    throw new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" })
  }

  assertResponseLoginSessionCurrent(response, loginSessionBoundary)
  validateResponseBuild(response.headers)
  if (!response.ok) {
    await parseError(response, loginSessionBoundary)
  }

  let payload: unknown
  try {
    payload =
      response.status === 204
        ? { success: true, data: null }
        : await response.json()
  } catch {
    assertResponseBodyLoginSessionCurrent(loginSessionBoundary)
    throw new ApiError({
      status: response.status,
      errorCode: "API_RESPONSE_INVALID",
    })
  }
  assertResponseBodyLoginSessionCurrent(loginSessionBoundary)
  const envelope = successEnvelopeSchema.safeParse(payload)
  if (!envelope.success) {
    throw new ApiError({
      status: response.status,
      errorCode: "API_RESPONSE_INVALID",
    })
  }

  const data = options.schema.safeParse(envelope.data.data)
  if (!data.success) {
    throw new ApiError({
      status: response.status,
      errorCode: "API_RESPONSE_INVALID",
    })
  }

  return data.data
}

function rawUploadRequest<TSchema extends z.ZodType>(
  path: string,
  options: ApiUploadRequestOptions<TSchema>,
  accessTokenOverride: string | null | undefined,
  loginSessionBoundary: LoginSessionBoundary
): Promise<z.infer<TSchema>> {
  if (isDesktopHost()) {
    // Native fetch has no byte-level upload progress; completion is observable.
    return rawRequest(
      path,
      options,
      accessTokenOverride,
      loginSessionBoundary
    ).then((data) => {
      // Body consumption can outlive the header check; do not publish a result
      // or completion progress that belongs to a replaced login.
      if (!isLoginSessionCurrent(loginSessionBoundary)) {
        throw createSupersededLoginError()
      }
      options.onUploadProgress?.(100)
      return data
    })
  }
  const buildHeaders = new Headers()
  prepareClientBuildRequest(buildHeaders, path)
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const language = document.documentElement.lang
    const token =
      accessTokenOverride === undefined ? getAccessToken() : accessTokenOverride
    const abortRequest = () => request.abort()
    const cleanup = () =>
      options.signal?.removeEventListener("abort", abortRequest)

    request.open(
      options.method ?? "POST",
      buildApiUrl(path, options.query),
      true
    )
    request.responseType = "json"
    request.withCredentials = true
    request.setRequestHeader("Accept", "application/json")
    buildHeaders.forEach((value, name) => request.setRequestHeader(name, value))
    if (isLocale(language)) {
      request.setRequestHeader("Accept-Language", language)
    }
    if (token) {
      request.setRequestHeader("Authorization", `Bearer ${token}`)
    }

    request.upload.addEventListener("progress", (event) => {
      if (!isLoginSessionCurrent(loginSessionBoundary)) return
      if (!event.lengthComputable || event.total <= 0) return
      options.onUploadProgress?.(
        Math.min(
          100,
          Math.max(0, Math.round((event.loaded / event.total) * 100))
        )
      )
    })
    request.addEventListener("load", () => {
      cleanup()
      // Reject before the build observer or schema can apply A's response to B.
      if (!isLoginSessionCurrent(loginSessionBoundary)) {
        reject(createSupersededLoginError())
        return
      }
      try {
        validateUploadResponseBuild(request)
      } catch (error) {
        reject(error)
        return
      }
      const successEnvelope = successEnvelopeSchema.safeParse(request.response)
      if (
        request.status >= 200 &&
        request.status < 300 &&
        successEnvelope.success
      ) {
        const data = options.schema.safeParse(successEnvelope.data.data)
        if (data.success) {
          resolve(data.data)
          return
        }
        reject(
          new ApiError({
            status: request.status,
            errorCode: "API_RESPONSE_INVALID",
          })
        )
        return
      }

      const errorEnvelope = errorEnvelopeSchema.safeParse(request.response)
      reject(
        new ApiError({
          status: request.status,
          errorCode: errorEnvelope.success
            ? errorEnvelope.data.error_code
            : request.status >= 500
              ? "SERVICE_TEMPORARILY_UNAVAILABLE"
              : "API_RESPONSE_INVALID",
          message: errorEnvelope.success
            ? errorEnvelope.data.message
            : undefined,
          messageKey: errorEnvelope.success
            ? errorEnvelope.data.message_key
            : undefined,
          params: errorEnvelope.success ? errorEnvelope.data.params : undefined,
        })
      )
    })
    request.addEventListener("error", () => {
      cleanup()
      reject(new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" }))
    })
    request.addEventListener("abort", () => {
      cleanup()
      reject(new DOMException("Upload aborted", "AbortError"))
    })

    if (options.signal) {
      if (options.signal.aborted) {
        request.abort()
        return
      }
      options.signal.addEventListener("abort", abortRequest, { once: true })
    }
    request.send(options.body)
  })
}

function getReusableSession(staleAccessToken: string | null) {
  const restoredToken = restoreAccessTokenFromStorage()
  if (!restoredToken || restoredToken === staleAccessToken) return null

  const storedSession = getStoredAccessSession()
  return {
    access_token: restoredToken,
    access_token_expires_at: storedSession
      ? new Date(storedSession.expiresAt).toISOString()
      : undefined,
  } satisfies AccessSession
}

async function requestNewSession(loginSessionBoundary: LoginSessionBoundary) {
  assertRefreshSessionCurrent(loginSessionBoundary)
  const session = await rawRequest(
    "/auth/refresh",
    {
      method: "POST",
      schema: authSessionSchema,
      skipRefresh: true,
    },
    null,
    loginSessionBoundary
  ).catch((error: unknown): never => {
    // A refresh that settles after the login generation changed belongs to the
    // previous login. Surface even a genuine server 401 as local cancellation
    // so direct consumers do not clear the replacement login.
    if (!isLoginSessionCurrent(loginSessionBoundary)) {
      throw createSupersededLoginError()
    }
    throw error
  })
  assertRefreshSessionCurrent(loginSessionBoundary)
  setAccessToken(session.access_token, session.access_token_expires_at)
  return session
}

async function refreshInsideLock(
  staleAccessToken: string | null,
  loginSessionBoundary: LoginSessionBoundary
) {
  assertRefreshSessionCurrent(loginSessionBoundary)
  return (
    getReusableSession(staleAccessToken) ??
    requestNewSession(loginSessionBoundary)
  )
}

async function refreshWithStorageLease(
  staleAccessToken: string | null,
  loginSessionBoundary: LoginSessionBoundary
) {
  const ownerId = createRefreshOwnerId()

  while (true) {
    assertRefreshSessionCurrent(loginSessionBoundary)
    const reusableSession = getReusableSession(staleAccessToken)
    if (reusableSession) return reusableSession

    const currentLease = readRefreshLease()
    if (!currentLease || currentLease.expiresAt <= Date.now()) {
      const acquired = writeRefreshLease({
        ownerId,
        expiresAt: Date.now() + REFRESH_LEASE_DURATION_MS,
      })
      if (!acquired)
        return refreshInsideLock(staleAccessToken, loginSessionBoundary)

      let renewTimer: number | null = null
      try {
        await waitForRefreshLease()
        // A replacement login may win during the verification wait; its
        // acquisition's finally must still release this lease immediately.
        assertRefreshSessionCurrent(loginSessionBoundary)
        if (readRefreshLease()?.ownerId !== ownerId) continue

        renewTimer = window.setInterval(() => {
          if (readRefreshLease()?.ownerId === ownerId) {
            writeRefreshLease({
              ownerId,
              expiresAt: Date.now() + REFRESH_LEASE_DURATION_MS,
            })
          }
        }, REFRESH_LEASE_RENEW_INTERVAL_MS)

        return await refreshInsideLock(staleAccessToken, loginSessionBoundary)
      } finally {
        // Never release or renew a lease another tab has since overwritten.
        if (renewTimer !== null) window.clearInterval(renewTimer)
        releaseRefreshLease(ownerId)
      }
    }

    await waitForRefreshLease()
  }
}

async function refreshAcrossTabs(
  staleAccessToken: string | null,
  loginSessionBoundary: LoginSessionBoundary
) {
  if (isDesktopHost())
    return refreshInsideLock(staleAccessToken, loginSessionBoundary)
  if (navigator.locks) {
    return navigator.locks.request(REFRESH_LOCK_NAME, () =>
      refreshInsideLock(staleAccessToken, loginSessionBoundary)
    )
  }
  return refreshWithStorageLease(staleAccessToken, loginSessionBoundary)
}

export async function refreshSession(
  staleAccessToken = getAccessToken(),
  loginSessionBoundary = getLoginSessionBoundary()
) {
  // A late authentication failure from a replaced login must not take over or
  // clear the shared slot that the current generation's refresh occupies.
  assertRefreshSessionCurrent(loginSessionBoundary)
  if (refreshPromise?.loginSessionBoundary === loginSessionBoundary) {
    return refreshPromise.promise
  }

  const pendingRefresh = {
    loginSessionBoundary,
    promise: refreshAcrossTabs(staleAccessToken, loginSessionBoundary).finally(
      () => {
        if (refreshPromise === pendingRefresh) refreshPromise = null
      }
    ),
  }
  refreshPromise = pendingRefresh
  return pendingRefresh.promise
}

export async function apiRequest<TSchema extends z.ZodType>(
  path: string,
  options: ApiRequestOptions<TSchema>
) {
  if (
    import.meta.env.DEV &&
    options.method &&
    options.method !== "GET" &&
    shouldBlockWorkspaceUiDemoWrite(path)
  ) {
    throw new ApiError({
      status: 403,
      errorCode: "WORKSPACE_UI_DEMO_READ_ONLY",
      messageKey: "workspaceUiDemo.readOnly",
    })
  }
  if (import.meta.env.DEV && shouldUseWorkspaceUiDemo(path)) {
    const { resolveWorkspaceUiDemoRequest } =
      await import("@/features/ui-demo/workspace-ui-demo-data")
    options.signal?.throwIfAborted()
    return options.schema.parse(resolveWorkspaceUiDemoRequest(path, options))
  }
  const accessTokenUsed = getAccessToken()
  // Ordinary callers own the login generation they started in, matching the
  // upload, stream, and download paths. A response or shared refresh that
  // finishes after an explicit replacement cannot retry with, or clear, the
  // replacement credentials.
  const loginSessionBoundary =
    options.loginSessionBoundary ?? getLoginSessionBoundary()
  const responseLoginSessionBoundary = isMacDesktopHost()
    ? loginSessionBoundary
    : undefined
  const assertLoginSessionCurrent = () => {
    if (!isLoginSessionCurrent(loginSessionBoundary)) {
      throw new ApiError({
        status: 401,
        errorCode: "AUTH_SESSION_EXPIRED",
      })
    }
  }
  assertLoginSessionCurrent()
  // Runs outside the authentication catch: a guard rejection is not an HTTP
  // response, so it must not rotate the session.
  options.beforeAttempt?.()
  try {
    return await rawRequest(
      path,
      options,
      accessTokenUsed,
      responseLoginSessionBoundary
    )
  } catch (error) {
    if (
      isDefinitiveAuthenticationError(error) &&
      !options.skipRefresh &&
      path !== "/auth/refresh" &&
      path !== "/auth/login"
    ) {
      if (!isLoginSessionCurrent(loginSessionBoundary)) {
        throw error
      }
      try {
        await refreshSession(accessTokenUsed, loginSessionBoundary)
      } catch (refreshError) {
        if (!isLoginSessionCurrent(loginSessionBoundary)) {
          throw error
        }
        if (isDefinitiveAuthenticationError(refreshError)) {
          setAccessToken(null)
        }
        throw refreshError
      }

      if (!isLoginSessionCurrent(loginSessionBoundary)) {
        throw error
      }
      // Runs outside the retry's authentication catch: a guard rejection is
      // not an authentication failure, so the refreshed session is kept.
      options.beforeAttempt?.()
      try {
        return await rawRequest(
          path,
          { ...options, skipRefresh: true },
          getAccessToken(),
          responseLoginSessionBoundary
        )
      } catch (retryError) {
        if (
          isLoginSessionCurrent(loginSessionBoundary) &&
          isDefinitiveAuthenticationError(retryError)
        ) {
          setAccessToken(null)
        }
        throw retryError
      }
    }
    throw error
  }
}

export async function apiUploadRequest<TSchema extends z.ZodType>(
  path: string,
  options: ApiUploadRequestOptions<TSchema>
) {
  if (import.meta.env.DEV && shouldBlockWorkspaceUiDemoWrite(path)) {
    const { rejectWorkspaceUiDemoWrite } =
      await import("@/features/ui-demo/workspace-ui-demo-data")
    rejectWorkspaceUiDemoWrite()
  }
  const accessTokenUsed = getAccessToken()
  const loginSessionBoundary = getLoginSessionBoundary()
  try {
    return await rawUploadRequest(
      path,
      options,
      accessTokenUsed,
      loginSessionBoundary
    )
  } catch (error) {
    if (
      isDefinitiveAuthenticationError(error) &&
      !options.skipRefresh &&
      path !== "/auth/refresh" &&
      path !== "/auth/login"
    ) {
      try {
        await refreshSession(accessTokenUsed, loginSessionBoundary)
      } catch (refreshError) {
        if (!isLoginSessionCurrent(loginSessionBoundary)) throw error
        if (isDefinitiveAuthenticationError(refreshError)) {
          setAccessToken(null)
        }
        throw refreshError
      }

      if (!isLoginSessionCurrent(loginSessionBoundary)) throw error
      try {
        return await rawUploadRequest(
          path,
          { ...options, skipRefresh: true },
          getAccessToken(),
          loginSessionBoundary
        )
      } catch (retryError) {
        if (
          isLoginSessionCurrent(loginSessionBoundary) &&
          isDefinitiveAuthenticationError(retryError)
        ) {
          setAccessToken(null)
        }
        throw retryError
      }
    }
    throw error
  }
}

async function rawStreamRequest(
  path: string,
  options: ApiStreamRequestOptions,
  accessTokenOverride?: string | null,
  loginSessionBoundary?: LoginSessionBoundary
) {
  const headers = new Headers({
    Accept: "application/x-ndjson, application/json",
  })
  prepareClientBuildRequest(headers, path)
  const language = document.documentElement.lang
  if (isLocale(language)) {
    headers.set("Accept-Language", language)
  }
  const token =
    accessTokenOverride === undefined ? getAccessToken() : accessTokenOverride
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers.set("Content-Type", "application/json")
    body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await hostFetch(buildApiUrl(path), {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "include",
      signal: options.signal,
      cache: "no-store",
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error
    }
    throw new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" })
  }

  assertResponseLoginSessionCurrent(response, loginSessionBoundary)
  validateResponseBuild(response.headers)
  if (!response.ok) {
    await parseError(response)
  }

  return response
}

/**
 * Opens an authenticated streaming API response while preserving the same
 * access-token refresh semantics as apiRequest. The caller owns response-body
 * parsing and cancellation.
 */
export async function apiStreamRequest(
  path: string,
  options: ApiStreamRequestOptions
) {
  if (import.meta.env.DEV && shouldBlockWorkspaceUiDemoWrite(path)) {
    throw new ApiError({
      status: 403,
      errorCode: "WORKSPACE_UI_DEMO_READ_ONLY",
      messageKey: "workspaceUiDemo.readOnly",
    })
  }
  const accessTokenUsed = getAccessToken()
  const loginSessionBoundary = getLoginSessionBoundary()
  const responseLoginSessionBoundary = isMacDesktopHost()
    ? loginSessionBoundary
    : undefined
  try {
    return await rawStreamRequest(
      path,
      options,
      accessTokenUsed,
      responseLoginSessionBoundary
    )
  } catch (error) {
    if (
      isDefinitiveAuthenticationError(error) &&
      !options.skipRefresh &&
      path !== "/auth/refresh" &&
      path !== "/auth/login"
    ) {
      try {
        await refreshSession(accessTokenUsed, loginSessionBoundary)
      } catch (refreshError) {
        if (!isLoginSessionCurrent(loginSessionBoundary)) throw error
        if (isDefinitiveAuthenticationError(refreshError)) {
          setAccessToken(null)
        }
        throw refreshError
      }

      if (!isLoginSessionCurrent(loginSessionBoundary)) throw error
      try {
        return await rawStreamRequest(
          path,
          { ...options, skipRefresh: true },
          getAccessToken(),
          responseLoginSessionBoundary
        )
      } catch (retryError) {
        if (
          isLoginSessionCurrent(loginSessionBoundary) &&
          isDefinitiveAuthenticationError(retryError)
        ) {
          setAccessToken(null)
        }
        throw retryError
      }
    }
    throw error
  }
}

export async function downloadApiFile(
  path: string,
  query?: Record<string, QueryValue>,
  signal?: AbortSignal,
  options?: { cache?: RequestCache }
) {
  if (import.meta.env.DEV && shouldUseWorkspaceUiDemo(path)) {
    throw new ApiError({
      status: 403,
      errorCode: "WORKSPACE_UI_DEMO_READ_ONLY",
      messageKey: "workspaceUiDemo.readOnly",
    })
  }
  const headers = new Headers()
  prepareClientBuildRequest(headers, path)
  const language = document.documentElement.lang
  if (isLocale(language)) {
    headers.set("Accept-Language", language)
  }
  const accessTokenUsed = getAccessToken()
  const loginSessionBoundary = getLoginSessionBoundary()
  if (accessTokenUsed) {
    headers.set("Authorization", `Bearer ${accessTokenUsed}`)
  }

  const fetchFile = async () => {
    const response = await hostFetch(buildApiUrl(path, query), {
      headers,
      credentials: "include",
      signal,
      cache: options?.cache ?? "no-store",
    })
    // Check ownership before the build observer or a retry can act on A's
    // response after a replacement login owns the session.
    if (!isLoginSessionCurrent(loginSessionBoundary)) {
      // Cancel the unread body so native fetch can close its channel.
      void response.body?.cancel().catch(() => undefined)
      throw createSupersededLoginError()
    }
    validateResponseBuild(response.headers)
    return response
  }

  let response: Response
  try {
    response = await fetchFile()
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error
    }
    throw new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" })
  }

  if (response.status === 401) {
    const authenticationError = await parseError(response.clone()).catch(
      (error: unknown) => error
    )
    if (!isDefinitiveAuthenticationError(authenticationError)) {
      throw authenticationError
    }

    if (!isLoginSessionCurrent(loginSessionBoundary)) {
      throw authenticationError
    }
    try {
      await refreshSession(accessTokenUsed, loginSessionBoundary)
      if (!isLoginSessionCurrent(loginSessionBoundary)) {
        throw authenticationError
      }
      const refreshedToken = getAccessToken()
      if (refreshedToken)
        headers.set("Authorization", `Bearer ${refreshedToken}`)
    } catch (refreshError) {
      if (!isLoginSessionCurrent(loginSessionBoundary)) {
        throw authenticationError
      }
      if (isDefinitiveAuthenticationError(refreshError)) {
        setAccessToken(null)
      }
      throw refreshError
    }

    try {
      response = await fetchFile()
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error
      }
      throw new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" })
    }
  }

  if (!response.ok) {
    try {
      await parseError(response)
    } catch (error) {
      if (
        isLoginSessionCurrent(loginSessionBoundary) &&
        isDefinitiveAuthenticationError(error)
      ) {
        setAccessToken(null)
      }
      throw error
    }
  }
  const blob = await response.blob()
  // Body consumption can outlive the header check; never hand A's bytes to B.
  if (!isLoginSessionCurrent(loginSessionBoundary)) {
    throw createSupersededLoginError()
  }
  return blob
}
