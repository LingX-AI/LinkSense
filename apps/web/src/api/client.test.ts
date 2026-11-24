import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  ApiError,
  apiRequest,
  apiStreamRequest,
  apiUploadRequest,
  downloadApiFile,
  isRetryableApiError,
  refreshSession,
} from "@/api/client"
import {
  getAccessToken,
  getStoredAccessSession,
  setAccessToken,
} from "@/api/session"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}

it("passes low priority to optional background requests", async () => {
  const fetch = vi.fn().mockResolvedValue(json({ success: true, data: true }))
  vi.stubGlobal("fetch", fetch)
  await apiRequest("/conversations/task/browser-use-intent", {
    method: "POST",
    body: { message_id: "message" },
    schema: z.boolean(),
    priority: "low",
  })
  expect(fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ priority: "low" })
  )
})

const refreshedAccessToken = "refreshed-access-token".padEnd(48, "x")
const refreshedStreamToken = "refreshed-stream-token".padEnd(48, "x")
const firstAccountId = "00000000-0000-4000-8000-000000000001"
const secondAccountId = "00000000-0000-4000-8000-000000000002"
const accessSessionKey = "linksense.auth.access-session"

function accountToken(id: string, nonce: string, role = "admin") {
  const claims = btoa(JSON.stringify({ sub: id, role, nonce })).replace(/=+$/, "")
  return `header.${claims}.signature`
}

function storeTabToken(token: string) {
  window.localStorage.setItem(
    accessSessionKey,
    JSON.stringify({ access_token: token, expires_at: Date.now() + 60_000 })
  )
}

function expiredResponse() {
  return json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
}

function refreshedResponse(token = refreshedAccessToken) {
  return json({ success: true, data: authSession(token) })
}

function delayedResponse() {
  let complete: (response: Response) => void = () => {}
  const promise = new Promise<Response>((resolve) => {
    complete = resolve
  })
  return { promise, complete }
}

function authSession(accessToken: string) {
  return {
    access_token: accessToken,
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_session_expires_at: "2099-03-01T00:00:00.000Z",
    user: {
      id: firstAccountId,
      email: "person@example.com",
      name: "Person",
      avatar_object_key: null,
      role: "admin",
      status: "active",
      preferred_locale: "zh-CN",
      running_message_action: "queue",
      last_login_at: "2026-08-31T08:00:00.000Z",
      last_login_method: "password",
      password_updated_at: "2026-08-01T08:00:00.000Z",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-31T08:00:00.000Z",
    },
  }
}

function installImmediateWebLock() {
  const request = vi.fn((_name: string, callback: () => Promise<unknown>) =>
    callback()
  )
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  })
  return request
}

describe("API response parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setAccessToken(null)
  })

  it("accepts a successful 204 response without trying to parse JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    )

    await expect(
      apiRequest("/admin/user-groups/group-1", {
        method: "DELETE",
        schema: z.unknown(),
      })
    ).resolves.toBeNull()
  })

  it("reports authenticated form upload progress and validates the response", async () => {
    const progressListeners: Array<(event: ProgressEvent) => void> = []
    const requestListeners = new Map<string, Array<(event: Event) => void>>()
    const sentBodies: Array<Document | XMLHttpRequestBodyInit | null> = []

    class SuccessfulUploadRequest {
      responseType: XMLHttpRequestResponseType = ""
      response: unknown = null
      status = 0
      withCredentials = false
      readonly upload = {
        addEventListener: (
          type: string,
          listener: (event: ProgressEvent) => void
        ) => {
          if (type === "progress") progressListeners.push(listener)
        },
      }

      open() {}
      setRequestHeader() {}
      addEventListener(type: string, listener: (event: Event) => void) {
        const listeners = requestListeners.get(type) ?? []
        listeners.push(listener)
        requestListeners.set(type, listeners)
      }
      abort() {}
      send(body: Document | XMLHttpRequestBodyInit | null) {
        sentBodies.push(body)
        for (const listener of progressListeners) {
          listener({
            lengthComputable: true,
            loaded: 45,
            total: 100,
          } as ProgressEvent)
          listener({
            lengthComputable: true,
            loaded: 100,
            total: 100,
          } as ProgressEvent)
        }
        this.status = 200
        this.response = { success: true, data: { id: "upload-1" } }
        for (const listener of requestListeners.get("load") ?? []) {
          listener(new Event("load"))
        }
      }
    }

    vi.stubGlobal("XMLHttpRequest", SuccessfulUploadRequest)
    const body = new FormData()
    body.set("file", new File(["zip"], "skill.zip"))
    const onUploadProgress = vi.fn()

    await expect(
      apiUploadRequest("/capabilities", {
        method: "POST",
        body,
        schema: z.object({ id: z.string() }),
        onUploadProgress,
      })
    ).resolves.toEqual({ id: "upload-1" })
    expect(sentBodies).toEqual([body])
    expect(onUploadProgress.mock.calls).toEqual([[45], [100]])
  })
})

describe("API retry classification", () => {
  it("retries only network and server failures", () => {
    expect(
      isRetryableApiError(
        new ApiError({ status: 0, errorCode: "NETWORK_UNAVAILABLE" })
      )
    ).toBe(true)
    expect(
      isRetryableApiError(
        new ApiError({ status: 503, errorCode: "SERVICE_UNAVAILABLE" })
      )
    ).toBe(true)
    expect(
      isRetryableApiError(
        new ApiError({ status: 200, errorCode: "API_RESPONSE_INVALID" })
      )
    ).toBe(false)
    expect(
      isRetryableApiError(
        new ApiError({ status: 401, errorCode: "AUTH_SESSION_EXPIRED" })
      )
    ).toBe(false)
    expect(isRetryableApiError(new Error("unexpected"))).toBe(false)
  })
})

describe("authenticated API recovery", () => {
  beforeEach(() => {
    installImmediateWebLock()
    setAccessToken("stale-access-token")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setAccessToken(null)
    vi.useRealTimers()
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    })
  })

  it("reuses a newer token written by another tab instead of rotating refresh again", async () => {
    const request = vi.fn((_name: string, callback: () => Promise<unknown>) => {
      window.localStorage.setItem(
        "linksense.auth.access-session",
        JSON.stringify({
          access_token: "newer-tab-access-token",
          expires_at: Date.now() + 60_000,
        })
      )
      return callback()
    })
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(refreshSession("stale-access-token")).resolves.toMatchObject({
      access_token: "newer-tab-access-token",
    })

    expect(request).toHaveBeenCalledWith(
      "linksense.auth.refresh.v1",
      expect.any(Function)
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe("newer-tab-access-token")
  })

  it("coalesces refresh requests over HTTP without Web Locks or native UUIDs", async () => {
    const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto))
    vi.stubGlobal("crypto", { getRandomValues })
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    })
    window.localStorage.setItem(
      "linksense.auth.refresh-lease.v1",
      JSON.stringify({ ownerId: "old-timestamp-tab-owner", expiresAt: 0 })
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json({ success: true, data: authSession(refreshedAccessToken) })
      )
    vi.stubGlobal("fetch", fetchMock)

    const [first, second] = await Promise.all([
      refreshSession("stale-access-token"),
      refreshSession("stale-access-token"),
    ])

    expect(first.access_token).toBe(refreshedAccessToken)
    expect(second.access_token).toBe(refreshedAccessToken)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(getRandomValues).toHaveBeenCalledOnce()
    expect(
      window.localStorage.getItem("linksense.auth.refresh-lease.v1")
    ).toBeNull()
  })

  it.each(["successful", "definitive failure"])(
    "leaves another tab's new session intact after a late %s refresh",
    async (result) => {
      const oldRefresh = delayedResponse()
      const fetchMock = vi.fn().mockReturnValue(oldRefresh.promise)
      vi.stubGlobal("fetch", fetchMock)

      const refresh = refreshSession().catch((error: unknown) => error)
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(getAccessToken()).toBe("stale-access-token")
      const newToken = accountToken(secondAccountId, "signed-in")
      storeTabToken(newToken)
      oldRefresh.complete(
        result === "successful" ? refreshedResponse() : expiredResponse()
      )

      await expect(refresh).resolves.toMatchObject({ name: "AbortError" })
      expect(getStoredAccessSession()?.accessToken).toBe(newToken)
    }
  )

  it.each(["this tab", "another tab"])(
    "does not publish a refresh response after logout in %s",
    async (tab) => {
      const oldRefresh = delayedResponse()
      const fetchMock = vi.fn().mockReturnValue(oldRefresh.promise)
      vi.stubGlobal("fetch", fetchMock)

      const refresh = refreshSession().catch((error: unknown) => error)
      expect(fetchMock).toHaveBeenCalledOnce()
      if (tab === "this tab") {
        setAccessToken(null)
      } else {
        window.localStorage.removeItem(accessSessionKey)
      }
      oldRefresh.complete(refreshedResponse())

      await expect(refresh).resolves.toMatchObject({ name: "AbortError" })
      expect(getStoredAccessSession()).toBeNull()
    }
  )

  it("publishes the refresh normally when only the previous token expires", async () => {
    vi.useFakeTimers()
    setAccessToken("short-lived-token", Date.now() + 1_000)
    const oldRefresh = delayedResponse()
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(oldRefresh.promise))

    const refresh = refreshSession()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(getAccessToken()).toBeNull()
    expect(getStoredAccessSession()).toBeNull()
    oldRefresh.complete(refreshedResponse())

    await expect(refresh).resolves.toMatchObject({
      access_token: refreshedAccessToken,
    })
    expect(getAccessToken()).toBe(refreshedAccessToken)
  })

  it.each(["another account", "a changed role", "explicit logout"])(
    "does not retry a pending write after %s",
    async (transition) => {
      setAccessToken(accountToken(firstAccountId, "original"))
      const originalResponse = delayedResponse()
      const fetchMock = vi
        .fn()
        .mockReturnValueOnce(originalResponse.promise)
        .mockResolvedValueOnce(json({ success: true, data: true }))
      vi.stubGlobal("fetch", fetchMock)

      const request = apiRequest("/me/preferences", {
        method: "PATCH",
        body: { language: "en-US" },
        schema: z.boolean(),
      }).catch((error: unknown) => error)
      if (transition === "explicit logout") {
        setAccessToken(null)
      } else if (transition === "a changed role") {
        storeTabToken(accountToken(firstAccountId, "updated", "user"))
      } else {
        storeTabToken(accountToken(secondAccountId, "updated"))
      }
      originalResponse.complete(expiredResponse())

      await expect(request).resolves.toMatchObject({ name: "AbortError" })
      expect(fetchMock).toHaveBeenCalledOnce()
    }
  )

  it("still retries a request with another tab's same-account rotation", async () => {
    const initialToken = accountToken(firstAccountId, "initial")
    const rotatedToken = accountToken(firstAccountId, "rotated")
    setAccessToken(initialToken)
    const originalResponse = delayedResponse()
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(originalResponse.promise)
      .mockResolvedValueOnce(json({ success: true, data: true }))
    vi.stubGlobal("fetch", fetchMock)

    const request = apiRequest("/me/preferences", {
      method: "PATCH",
      body: { language: "en-US" },
      schema: z.boolean(),
    })
    storeTabToken(rotatedToken)
    originalResponse.complete(expiredResponse())

    await expect(request).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/me/preferences")
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Authorization")
    ).toBe(`Bearer ${rotatedToken}`)
  })

  it("keeps a newer session when a retried request fails definitively", async () => {
    const retry = delayedResponse()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(expiredResponse())
      .mockResolvedValueOnce(refreshedResponse())
      .mockReturnValueOnce(retry.promise)
    vi.stubGlobal("fetch", fetchMock)

    const request = apiRequest("/me", { schema: z.unknown() }).catch(
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const newToken = accountToken(secondAccountId, "signed-in")
    storeTabToken(newToken)
    retry.complete(expiredResponse())

    await expect(request).resolves.toMatchObject({ name: "AbortError" })
    expect(getStoredAccessSession()?.accessToken).toBe(newToken)
  })

  it.each(["initial", "retried"] as const)(
    "does not deliver a successful %s response to a different account",
    async (attempt) => {
      setAccessToken(accountToken(firstAccountId, "original"))
      const oldResponse = delayedResponse()
      const fetchMock = vi.fn()
      if (attempt === "retried") {
        fetchMock
          .mockResolvedValueOnce(expiredResponse())
          .mockResolvedValueOnce(
            refreshedResponse(accountToken(firstAccountId, "refreshed"))
          )
      }
      fetchMock.mockReturnValueOnce(oldResponse.promise)
      vi.stubGlobal("fetch", fetchMock)
      const consume = vi.fn()
      const request = apiRequest("/projects/order", {
        method: "PUT",
        schema: z.array(z.string()),
      })
        .then(consume)
        .catch((error: unknown) => error)

      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledTimes(attempt === "initial" ? 1 : 3)
      )
      const nextToken = accountToken(secondAccountId, "signed-in")
      storeTabToken(nextToken)
      oldResponse.complete(json({ success: true, data: ["previous-project"] }))

      await expect(request).resolves.toMatchObject({ name: "AbortError" })
      expect(consume).not.toHaveBeenCalled()
      expect(getStoredAccessSession()?.accessToken).toBe(nextToken)
    }
  )

  it("delivers a successful response after a same-account rotation", async () => {
    setAccessToken(accountToken(firstAccountId, "original"))
    const oldResponse = delayedResponse()
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(oldResponse.promise))

    const request = apiRequest("/projects", { schema: z.array(z.string()) })
    setAccessToken(accountToken(firstAccountId, "rotated"))
    oldResponse.complete(json({ success: true, data: ["current-project"] }))

    await expect(request).resolves.toEqual(["current-project"])
  })

  it("keeps anonymous recovery when no access token was ever sent", async () => {
    setAccessToken(null)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(expiredResponse())
      .mockResolvedValueOnce(refreshedResponse())
      .mockResolvedValueOnce(json({ success: true, data: true }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(apiRequest("/me", { schema: z.boolean() })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("does not apply the account guard to explicit logout responses", async () => {
    const oldResponse = delayedResponse()
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(oldResponse.promise))

    const request = apiRequest("/auth/logout", {
      method: "POST",
      schema: z.null(),
      skipRefresh: true,
    })
    setAccessToken(null)
    oldResponse.complete(new Response(null, { status: 204 }))

    await expect(request).resolves.toBeNull()
  })

  it("checks the retry token in the same turn that sends the request", async () => {
    const newToken = accountToken(secondAccountId, "signed-in")
    const readValue = window.localStorage.getItem.bind(window.localStorage)
    let queuedAccountChange = false
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key) => {
      const value = readValue(key)
      if (
        !queuedAccountChange &&
        key === accessSessionKey &&
        value?.includes(refreshedAccessToken)
      ) {
        queuedAccountChange = true
        queueMicrotask(() => setAccessToken(newToken))
      }
      return value
    })
    let tokenWhenRetryWasSent: string | null | undefined
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(expiredResponse())
      .mockResolvedValueOnce(refreshedResponse())
      .mockImplementationOnce(() => {
        tokenWhenRetryWasSent = getAccessToken()
        return Promise.resolve(expiredResponse())
      })
    vi.stubGlobal("fetch", fetchMock)

    await expect(apiRequest("/me", { schema: z.unknown() })).rejects.toMatchObject(
      { name: "AbortError" }
    )
    expect(tokenWhenRetryWasSent).toBe(refreshedAccessToken)
    expect(getAccessToken()).toBe(newToken)
  })

  it("does not retry after the caller aborts while the shared refresh is pending", async () => {
    const refresh = delayedResponse()
    const controller = new AbortController()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(expiredResponse())
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(json({ success: true, data: true }))
    vi.stubGlobal("fetch", fetchMock)

    const request = apiRequest("/me", {
      schema: z.boolean(),
      signal: controller.signal,
    }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    controller.abort()
    refresh.complete(refreshedResponse())

    await expect(request).resolves.toMatchObject({ name: "AbortError" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getAccessToken()).toBe(refreshedAccessToken)
  })

  it("keeps the refreshed token when the retried request has a network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
      )
      .mockResolvedValueOnce(
        json({
          success: true,
          data: authSession(refreshedAccessToken),
        })
      )
      .mockRejectedValueOnce(new TypeError("network unavailable"))
    vi.stubGlobal("fetch", fetchMock)

    const error = await apiRequest("/me", { schema: z.unknown() }).catch(
      (value: unknown) => value
    )

    expect(error).toMatchObject({
      status: 0,
      errorCode: "NETWORK_UNAVAILABLE",
    })
    expect(getAccessToken()).toBe(refreshedAccessToken)
  })

  it("keeps the refreshed token when the retried request returns a server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
        )
        .mockResolvedValueOnce(
          json({
            success: true,
            data: authSession(refreshedAccessToken),
          })
        )
        .mockResolvedValueOnce(
          json({ success: false, error_code: "INTERNAL_ERROR" }, 500)
        )
    )

    await expect(
      apiRequest("/me", { schema: z.unknown() })
    ).rejects.toMatchObject({ status: 500, errorCode: "INTERNAL_ERROR" })
    expect(getAccessToken()).toBe(refreshedAccessToken)
  })

  it("clears the token only when refresh is definitively expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
        )
        .mockResolvedValueOnce(
          json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
        )
    )

    await expect(
      apiRequest("/me", { schema: z.unknown() })
    ).rejects.toMatchObject({
      status: 401,
      errorCode: "AUTH_SESSION_EXPIRED",
    })
    expect(getAccessToken()).toBeNull()
  })

  it("does not rotate refresh for an unrelated 401 response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json(
          { success: false, error_code: "EXTERNAL_PROVIDER_UNAUTHORIZED" },
          401
        )
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      apiRequest("/provider", { schema: z.unknown() })
    ).rejects.toMatchObject({
      status: 401,
      errorCode: "EXTERNAL_PROVIDER_UNAUTHORIZED",
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(getAccessToken()).toBe("stale-access-token")
  })

  it("refreshes once and retries an authenticated streaming request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
      )
      .mockResolvedValueOnce(
        json({
          success: true,
          data: authSession(refreshedStreamToken),
        })
      )
      .mockResolvedValueOnce(
        new Response('{"type":"done","text":"hello"}\n', {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    const response = await apiStreamRequest("/voice/transcriptions", {
      method: "POST",
      body: { audio_data_url: "data:audio/webm;base64,AAAA", stream: true },
    })

    await expect(response.text()).resolves.toContain('"type":"done"')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit
    const retriedRequest = fetchMock.mock.calls[2]?.[1] as RequestInit
    expect(new Headers(firstRequest.headers).get("Authorization")).toBe(
      "Bearer stale-access-token"
    )
    expect(new Headers(retriedRequest.headers).get("Authorization")).toBe(
      `Bearer ${refreshedStreamToken}`
    )
    expect(retriedRequest.body).toBe(firstRequest.body)
    expect(getAccessToken()).toBe(refreshedStreamToken)
  })

  it("forwards AbortSignal cancellation from an authenticated stream", async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"))
          })
        })
    )
    vi.stubGlobal("fetch", fetchMock)

    const request = apiStreamRequest("/voice/transcriptions", {
      method: "POST",
      body: { audio_data_url: "data:audio/webm;base64,AAAA", stream: true },
      signal: controller.signal,
    })
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: "AbortError" })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBe(
      controller.signal
    )
  })
})

describe("authenticated file downloads", () => {
  beforeEach(() => setAccessToken("expired-access-token"))

  afterEach(() => {
    vi.unstubAllGlobals()
    setAccessToken(null)
  })

  it("refreshes once after a 401 and retries the exact download request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
      )
      .mockResolvedValueOnce(
        json({
          success: true,
          data: authSession(refreshedAccessToken),
        })
      )
      .mockResolvedValueOnce(
        new Response("created_at,action", {
          status: 200,
          headers: { "content-type": "text/csv" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      downloadApiFile("/admin/audit/export.csv", { result: "failure" })
    ).resolves.toBeInstanceOf(Blob)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/v1/admin/audit/export.csv?result=failure"
    )
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "/api/v1/admin/audit/export.csv?result=failure"
    )
    const finalHeaders = new Headers(
      (fetchMock.mock.calls[2]?.[1] as RequestInit).headers
    )
    expect(finalHeaders.get("Authorization")).toBe(
      `Bearer ${refreshedAccessToken}`
    )
    expect(getAccessToken()).toBe(refreshedAccessToken)
  })

  it("forwards cancellation to an authenticated file request without rewriting it as a network error", async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"))
          })
        })
    )
    vi.stubGlobal("fetch", fetchMock)

    const request = downloadApiFile(
      "/conversations/c1/attachments/file-1/content",
      undefined,
      controller.signal
    )
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: "AbortError" })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBe(
      controller.signal
    )
  })

  it("keeps downloads uncached by default and allows private thumbnail response caching", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("image", { headers: { "content-type": "image/webp" } })
    )
    vi.stubGlobal("fetch", fetchMock)
    await downloadApiFile("/files/download")
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ cache: "no-store" })
    )
    await downloadApiFile("/files/thumbnail", undefined, undefined, {
      cache: "default",
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ cache: "default", credentials: "include" })
    )
  })

  it("preserves structured validation parameters for readable row-level feedback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          {
            success: false,
            error_code: "VALIDATION_ERROR",
            message_key: "errors.common.validation",
            params: {
              errors: [{ row: 3, field: "email", code: "duplicate_in_file" }],
            },
          },
          400
        )
      )
    )

    const error = await apiRequest("/admin/users/import", {
      method: "POST",
      schema: z.unknown(),
    }).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).params).toEqual({
      errors: [{ row: 3, field: "email", code: "duplicate_in_file" }],
    })
  })
})
