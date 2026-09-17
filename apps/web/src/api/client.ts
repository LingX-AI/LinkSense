import { z } from "zod"

import { authSessionSchema, type AccessSession } from "@/api/contracts"
import {
  getAccessToken,
  getStoredAccessSession,
  restoreAccessTokenFromStorage,
  setAccessToken,
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

export type QueryValue = string | number | boolean | null | undefined

export function buildApiUrl(path: string, query?: Record<string, QueryValue>) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const url = new URL(
    `${API_BASE_URL}/api/v1${normalizedPath}`,
    window.location.origin
  )

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value))
      }
    }
  }

  return API_BASE_URL ? url.toString() : `${url.pathname}${url.search}`
}

type RequestOptions<TSchema extends z.ZodType> = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown | FormData
  query?: Record<string, QueryValue>
  schema: TSchema
  signal?: AbortSignal
  cache?: RequestCache
  skipRefresh?: boolean
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

let refreshPromise: Promise<AccessSession> | null = null

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
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
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

async function parseError(response: Response) {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError({
      status: response.status,
      errorCode:
        response.status === 0 ? "NETWORK_UNAVAILABLE" : "API_RESPONSE_INVALID",
    })
  }

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
  accessTokenOverride?: string | null
) {
  const headers = new Headers({ Accept: "application/json" })
  const language = document.documentElement.lang
  if (language === "zh-CN" || language === "en-US") {
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
    response = await fetch(buildApiUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "include",
      signal: options.signal,
      cache: options.cache,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error
    }
    throw new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" })
  }

  if (!response.ok) {
    await parseError(response)
  }

  let payload: unknown
  try {
    payload =
      response.status === 204
        ? { success: true, data: null }
        : await response.json()
  } catch {
    throw new ApiError({
      status: response.status,
      errorCode: "API_RESPONSE_INVALID",
    })
  }
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
  accessTokenOverride?: string | null
): Promise<z.infer<TSchema>> {
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
    if (language === "zh-CN" || language === "en-US") {
      request.setRequestHeader("Accept-Language", language)
    }
    if (token) {
      request.setRequestHeader("Authorization", `Bearer ${token}`)
    }

    request.upload.addEventListener("progress", (event) => {
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

async function requestNewSession() {
  const session = await rawRequest(
    "/auth/refresh",
    {
      method: "POST",
      schema: authSessionSchema,
      skipRefresh: true,
    },
    null
  )
  setAccessToken(session.access_token, session.access_token_expires_at)
  return session
}

async function refreshInsideLock(staleAccessToken: string | null) {
  return getReusableSession(staleAccessToken) ?? requestNewSession()
}

async function refreshWithStorageLease(staleAccessToken: string | null) {
  const ownerId = createRefreshOwnerId()

  while (true) {
    const reusableSession = getReusableSession(staleAccessToken)
    if (reusableSession) return reusableSession

    const currentLease = readRefreshLease()
    if (!currentLease || currentLease.expiresAt <= Date.now()) {
      const acquired = writeRefreshLease({
        ownerId,
        expiresAt: Date.now() + REFRESH_LEASE_DURATION_MS,
      })
      if (!acquired) return refreshInsideLock(staleAccessToken)

      await waitForRefreshLease()
      if (readRefreshLease()?.ownerId !== ownerId) continue

      const renewTimer = window.setInterval(() => {
        if (readRefreshLease()?.ownerId === ownerId) {
          writeRefreshLease({
            ownerId,
            expiresAt: Date.now() + REFRESH_LEASE_DURATION_MS,
          })
        }
      }, REFRESH_LEASE_RENEW_INTERVAL_MS)

      try {
        return await refreshInsideLock(staleAccessToken)
      } finally {
        window.clearInterval(renewTimer)
        releaseRefreshLease(ownerId)
      }
    }

    await waitForRefreshLease()
  }
}

async function refreshAcrossTabs(staleAccessToken: string | null) {
  if (navigator.locks) {
    return navigator.locks.request(REFRESH_LOCK_NAME, () =>
      refreshInsideLock(staleAccessToken)
    )
  }
  return refreshWithStorageLease(staleAccessToken)
}

export async function refreshSession(staleAccessToken = getAccessToken()) {
  if (!refreshPromise) {
    refreshPromise = refreshAcrossTabs(staleAccessToken).finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}

export async function apiRequest<TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>
) {
  const accessTokenUsed = getAccessToken()
  try {
    return await rawRequest(path, options, accessTokenUsed)
  } catch (error) {
    if (
      isDefinitiveAuthenticationError(error) &&
      !options.skipRefresh &&
      path !== "/auth/refresh" &&
      path !== "/auth/login"
    ) {
      try {
        await refreshSession(accessTokenUsed)
      } catch (refreshError) {
        if (isDefinitiveAuthenticationError(refreshError)) {
          setAccessToken(null)
        }
        throw refreshError
      }

      try {
        return await rawRequest(
          path,
          { ...options, skipRefresh: true },
          getAccessToken()
        )
      } catch (retryError) {
        if (isDefinitiveAuthenticationError(retryError)) {
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
  const accessTokenUsed = getAccessToken()
  try {
    return await rawUploadRequest(path, options, accessTokenUsed)
  } catch (error) {
    if (
      isDefinitiveAuthenticationError(error) &&
      !options.skipRefresh &&
      path !== "/auth/refresh" &&
      path !== "/auth/login"
    ) {
      try {
        await refreshSession(accessTokenUsed)
      } catch (refreshError) {
        if (isDefinitiveAuthenticationError(refreshError)) {
          setAccessToken(null)
        }
        throw refreshError
      }

      try {
        return await rawUploadRequest(
          path,
          { ...options, skipRefresh: true },
          getAccessToken()
        )
      } catch (retryError) {
        if (isDefinitiveAuthenticationError(retryError)) {
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
  accessTokenOverride?: string | null
) {
  const headers = new Headers({
    Accept: "application/x-ndjson, application/json",
  })
  const language = document.documentElement.lang
  if (language === "zh-CN" || language === "en-US") {
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
    response = await fetch(buildApiUrl(path), {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "include",
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error
    }
    throw new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" })
  }

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
  const accessTokenUsed = getAccessToken()
  try {
    return await rawStreamRequest(path, options, accessTokenUsed)
  } catch (error) {
    if (
      isDefinitiveAuthenticationError(error) &&
      !options.skipRefresh &&
      path !== "/auth/refresh" &&
      path !== "/auth/login"
    ) {
      try {
        await refreshSession(accessTokenUsed)
      } catch (refreshError) {
        if (isDefinitiveAuthenticationError(refreshError)) {
          setAccessToken(null)
        }
        throw refreshError
      }

      try {
        return await rawStreamRequest(
          path,
          { ...options, skipRefresh: true },
          getAccessToken()
        )
      } catch (retryError) {
        if (isDefinitiveAuthenticationError(retryError)) {
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
  signal?: AbortSignal
) {
  const headers = new Headers()
  const language = document.documentElement.lang
  if (language === "zh-CN" || language === "en-US") {
    headers.set("Accept-Language", language)
  }
  const accessTokenUsed = getAccessToken()
  if (accessTokenUsed) {
    headers.set("Authorization", `Bearer ${accessTokenUsed}`)
  }

  const fetchFile = () =>
    fetch(buildApiUrl(path, query), {
      headers,
      credentials: "include",
      signal,
    })

  let response: Response
  try {
    response = await fetchFile()
  } catch (error) {
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

    try {
      await refreshSession(accessTokenUsed)
      const refreshedToken = getAccessToken()
      if (refreshedToken)
        headers.set("Authorization", `Bearer ${refreshedToken}`)
    } catch (refreshError) {
      if (isDefinitiveAuthenticationError(refreshError)) {
        setAccessToken(null)
      }
      throw refreshError
    }

    try {
      response = await fetchFile()
    } catch (error) {
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
      if (isDefinitiveAuthenticationError(error)) {
        setAccessToken(null)
      }
      throw error
    }
  }
  return response.blob()
}
