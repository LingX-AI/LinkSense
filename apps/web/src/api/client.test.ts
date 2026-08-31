import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  ApiError,
  apiRequest,
  apiStreamRequest,
  apiUploadRequest,
  downloadApiFile,
  refreshSession,
} from "@/api/client"
import { getAccessToken, setAccessToken } from "@/api/session"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
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

describe("authenticated API recovery", () => {
  beforeEach(() => {
    installImmediateWebLock()
    setAccessToken("stale-access-token")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setAccessToken(null)
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

  it("keeps the refreshed token when the retried request has a network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
      )
      .mockResolvedValueOnce(
        json({
          success: true,
          data: {
            access_token: "refreshed-access-token",
            access_token_expires_at: "2099-01-01T00:00:00.000Z",
          },
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
    expect(getAccessToken()).toBe("refreshed-access-token")
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
            data: {
              access_token: "refreshed-access-token",
              access_token_expires_at: "2099-01-01T00:00:00.000Z",
            },
          })
        )
        .mockResolvedValueOnce(
          json({ success: false, error_code: "INTERNAL_ERROR" }, 500)
        )
    )

    await expect(
      apiRequest("/me", { schema: z.unknown() })
    ).rejects.toMatchObject({ status: 500, errorCode: "INTERNAL_ERROR" })
    expect(getAccessToken()).toBe("refreshed-access-token")
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
          data: {
            access_token: "refreshed-stream-token",
            access_token_expires_at: "2099-01-01T00:00:00.000Z",
          },
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
      "Bearer refreshed-stream-token"
    )
    expect(retriedRequest.body).toBe(firstRequest.body)
    expect(getAccessToken()).toBe("refreshed-stream-token")
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
          data: { access_token: "refreshed-access-token", expires_in: 7200 },
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
      "Bearer refreshed-access-token"
    )
    expect(getAccessToken()).toBe("refreshed-access-token")
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
