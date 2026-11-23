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
  DESKTOP_PROTOCOL_HEADER,
  SERVER_BUILD_HEADER,
  desktopProtocolVersion,
} from "@linksense/shared"
import {
  beginLoginSession,
  getAccessToken,
  getLoginSessionBoundary,
  setAccessToken,
} from "@/api/session"

beforeEach(() => {
  // This file runs in the isolated component project; start each test with no
  // access session or refresh lease carried over from a previous case.
  window.localStorage.clear()
})

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

function authSession(accessToken: string) {
  return {
    access_token: accessToken,
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_session_expires_at: "2099-03-01T00:00:00.000Z",
    user: {
      id: "00000000-0000-4000-8000-000000000001",
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

it("ignores the desktop update requirement from a refresh that outlives its login", async () => {
  vi.resetModules()
  vi.stubGlobal("mygo", {})
  const desktop = await import("@/adapters/desktop/desktop-adapter")
  const client = await import("./client")
  const session = await import("./session")
  const serverUrl = vi
    .spyOn(desktop, "getDesktopServerUrl")
    .mockReturnValue("https://desktop.example.test")
  const incompatibleResponse = () =>
    json({ success: true, data: authSession(refreshedAccessToken) })
  let deliverOldResponse = () => {}
  const request = vi
    .spyOn(desktop, "hostFetch")
    .mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        deliverOldResponse = () => resolve(incompatibleResponse())
      })
    )
    .mockImplementation(async () => incompatibleResponse())

  try {
    session.setAccessToken("desktop-account-a")
    const oldRefresh = client.refreshSession()
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "https://desktop.example.test/api/v1/auth/refresh",
      expect.objectContaining({ method: "POST" })
    )

    session.beginLoginSession()
    session.setAccessToken("desktop-account-b")
    deliverOldResponse()

    await expect(oldRefresh).rejects.toMatchObject({ name: "AbortError" })
    expect(session.getAccessToken()).toBe("desktop-account-b")
    expect(desktop.getDesktopUpdateRequired()).toBe(false)

    await expect(client.refreshSession()).rejects.toMatchObject({
      errorCode: "DESKTOP_UPDATE_REQUIRED",
    })
    expect(desktop.getDesktopUpdateRequired()).toBe(true)
  } finally {
    session.setAccessToken(null)
    request.mockRestore()
    serverUrl.mockRestore()
    vi.unstubAllGlobals()
    vi.resetModules()
  }
})

describe("Mac request response headers", () => {
  it.each([
    ["ordinary request", "first attempt"],
    ["voice stream", "first attempt"],
    ["ordinary request", "retry"],
    ["voice stream", "retry"],
  ])(
    "ignores incompatible headers for the %s on the %s from a replaced login",
    async (kind, attempt) => {
      vi.resetModules()
      vi.stubGlobal("mygo", {
        platform: "darwin",
        on: vi.fn(),
        callWith: vi.fn(async (method: string) => {
          if (method === "Desktop.Info") {
            return {
              bridgeVersion: 1,
              serverUrl: "https://desktop.example.test",
              platform: "darwin",
              version: "0.1.0",
            }
          }
          if (method === "Desktop.NotificationsSupported") return false
          throw new Error(`Unexpected bridge call: ${method}`)
        }),
      })
      const desktop = await import("@/adapters/desktop/desktop-adapter")
      const client = await import("./client")
      const session = await import("./session")
      const request = vi
        .spyOn(desktop, "hostFetch")
        .mockRejectedValue(new Error("Unexpected extra request"))

      const incompatibleHeaders = {
        [DESKTOP_PROTOCOL_HEADER]: String(desktopProtocolVersion + 1),
      }
      const cancel = vi.fn()
      const staleResponse = new Response(new ReadableStream({ cancel }), {
        status: 401,
        headers: incompatibleHeaders,
      })
      let deliverOldResponse = () => {}
      const delayedHeaders = new Promise<Response>((resolve) => {
        deliverOldResponse = () => resolve(staleResponse)
      })

      const isRetry = attempt === "retry"
      if (isRetry) {
        const expired = json(
          { success: false, error_code: "AUTH_SESSION_EXPIRED" },
          401
        )
        const refreshed = json({
          success: true,
          data: authSession(refreshedAccessToken),
        })
        for (const response of [expired, refreshed]) {
          response.headers.set(
            DESKTOP_PROTOCOL_HEADER,
            String(desktopProtocolVersion)
          )
          request.mockResolvedValueOnce(response)
        }
      }
      request.mockReturnValueOnce(delayedHeaders)
      const authorizationAt = (index: number) =>
        new Headers(request.mock.calls[index]?.[1]?.headers).get("Authorization")
      const path = kind === "voice stream" ? "/voice/transcriptions" : "/me"
      const start = () =>
        kind === "voice stream"
          ? client.apiStreamRequest(path, { method: "POST" })
          : client.apiRequest(path, { schema: z.unknown() })

      try {
        await desktop.initializeDesktopHost()
        expect(desktop.isMacDesktopHost()).toBe(true)
        session.setAccessToken("desktop-account-a")
        const oldRequest = start().catch((error: unknown) => error)
        const attempts = isRetry ? 3 : 1
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(attempts))
        expect(authorizationAt(0)).toBe("Bearer desktop-account-a")
        if (isRetry) {
          expect(request.mock.calls[1]?.[0]).toBe(
            "https://desktop.example.test/api/v1/auth/refresh"
          )
          expect(authorizationAt(2)).toBe(`Bearer ${refreshedAccessToken}`)
        }

        session.beginLoginSession()
        session.setAccessToken("desktop-account-b")
        deliverOldResponse()

        expect({
          outcome: await oldRequest,
          updateRequired: desktop.getDesktopUpdateRequired(),
          cancelCalls: cancel.mock.calls.length,
          token: session.getAccessToken(),
          attempts: request.mock.calls.length,
        }).toMatchObject({
          outcome: { name: "AbortError" },
          updateRequired: false,
          cancelCalls: 1,
          token: "desktop-account-b",
          attempts,
        })

        request.mockResolvedValueOnce(
          new Response(null, { headers: incompatibleHeaders })
        )
        await expect(start()).rejects.toMatchObject({
          errorCode: "DESKTOP_UPDATE_REQUIRED",
        })
        expect(desktop.getDesktopUpdateRequired()).toBe(true)
        expect(request).toHaveBeenCalledTimes(attempts + 1)
        expect(authorizationAt(attempts)).toBe("Bearer desktop-account-b")
      } finally {
        session.setAccessToken(null)
        request.mockRestore()
        vi.unstubAllGlobals()
        delete document.documentElement.dataset.desktopPlatform
        vi.resetModules()
      }
    }
  )
})

describe("Mac request response bodies", () => {
  async function loadMacClient() {
    vi.resetModules()
    vi.stubGlobal("mygo", {
      platform: "darwin",
      on: vi.fn(),
      callWith: vi.fn(async (method: string) => {
        if (method === "Desktop.Info") {
          return {
            bridgeVersion: 1,
            serverUrl: "https://desktop.example.test",
            platform: "darwin",
            version: "0.1.0",
          }
        }
        if (method === "Desktop.NotificationsSupported") return false
        throw new Error(`Unexpected bridge call: ${method}`)
      }),
    })
    const desktop = await import("@/adapters/desktop/desktop-adapter")
    const client = await import("./client")
    const session = await import("./session")
    await desktop.initializeDesktopHost()
    expect(desktop.isMacDesktopHost()).toBe(true)
    return { desktop, client, session }
  }

  function delayJsonResponse(
    payload: unknown,
    options: { status?: number } = {}
  ) {
    let jsonEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      jsonEntered = resolve
    })
    let completeBody!: () => void
    const bodyReady = new Promise<void>((resolve) => {
      completeBody = resolve
    })
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        await bodyReady
        controller.enqueue(
          new TextEncoder().encode(
            typeof payload === "string" ? payload : JSON.stringify(payload)
          )
        )
        controller.close()
      },
      cancel,
    })
    const response = new Response(body, {
      status: options.status ?? 200,
      headers: {
        "content-type": "application/json",
        [DESKTOP_PROTOCOL_HEADER]: String(desktopProtocolVersion),
      },
    })
    const originalJson = response.json.bind(response)
    vi.spyOn(response, "json").mockImplementation(() => {
      jsonEntered()
      return originalJson()
    })
    return { response, entered, completeBody, cancel }
  }

  it.each([
    ["first attempt", false],
    ["authenticated retry", true],
  ])(
    "does not apply an ordinary request body that completes after the login changed on the %s",
    async (_label, isRetry) => {
      const { desktop, client, session } = await loadMacClient()
      const delayed = delayJsonResponse({
        success: true,
        data: { show_reasoning: true },
      })
      const request = vi.spyOn(desktop, "hostFetch")
      if (isRetry) {
        const expired = json(
          { success: false, error_code: "AUTH_SESSION_EXPIRED" },
          401
        )
        expired.headers.set(
          DESKTOP_PROTOCOL_HEADER,
          String(desktopProtocolVersion)
        )
        const refreshed = json({
          success: true,
          data: authSession(refreshedAccessToken),
        })
        refreshed.headers.set(
          DESKTOP_PROTOCOL_HEADER,
          String(desktopProtocolVersion)
        )
        request.mockResolvedValueOnce(expired)
        request.mockResolvedValueOnce(refreshed)
      }
      request.mockResolvedValueOnce(delayed.response)

      try {
        session.setAccessToken("desktop-account-a", Date.now() + 60_000)
        const loginSessionA = session.getLoginSessionBoundary()
        const pending = client
          .apiRequest("/me/personalization", {
            method: "PATCH",
            body: { show_reasoning: true },
            schema: z.object({ show_reasoning: z.boolean() }),
          })
          .catch((error: unknown) => error)

        await delayed.entered
        const expectedAttempts = isRetry ? 3 : 1
        expect(request).toHaveBeenCalledTimes(expectedAttempts)
        expect(session.getLoginSessionBoundary()).toBe(loginSessionA)
        expect(session.getAccessToken()).toBe(
          isRetry ? refreshedAccessToken : "desktop-account-a"
        )
        const authorizationAt = (index: number) =>
          new Headers(request.mock.calls[index]?.[1]?.headers).get(
            "Authorization"
          )
        expect(authorizationAt(0)).toBe("Bearer desktop-account-a")
        if (isRetry) {
          expect(request.mock.calls[1]?.[0]).toBe(
            "https://desktop.example.test/api/v1/auth/refresh"
          )
          expect(authorizationAt(2)).toBe(`Bearer ${refreshedAccessToken}`)
        }

        session.beginLoginSession()
        session.setAccessToken("desktop-account-b", Date.now() + 60_000)
        delayed.completeBody()

        const outcome = await pending
        expect(outcome).toMatchObject({ name: "AbortError" })
        expect(outcome).not.toBeInstanceOf(client.ApiError)
        expect(delayed.cancel).not.toHaveBeenCalled()
        expect(request).toHaveBeenCalledTimes(expectedAttempts)
        expect(session.getAccessToken()).toBe("desktop-account-b")
      } finally {
        session.setAccessToken(null)
        request.mockRestore()
        vi.unstubAllGlobals()
        delete document.documentElement.dataset.desktopPlatform
        vi.resetModules()
      }
    }
  )

  it.each([
    [
      "non-OK response body",
      { status: 401 },
      { success: false, error_code: "AUTH_SESSION_EXPIRED" },
    ],
    ["invalid response body", { status: 200 }, "not-json"],
  ])(
    "treats a delayed Mac %s from a replaced login as local cancellation",
    async (_label, responseOptions, body) => {
      const { desktop, client, session } = await loadMacClient()
      const delayed = delayJsonResponse(body, responseOptions)
      const request = vi
        .spyOn(desktop, "hostFetch")
        .mockResolvedValue(delayed.response)

      try {
        session.setAccessToken("desktop-account-a", Date.now() + 60_000)
        const pending = client
          .apiRequest("/me/personalization", {
            method: "PATCH",
            body: { show_reasoning: true },
            schema: z.object({ show_reasoning: z.boolean() }),
          })
          .catch((error: unknown) => error)

        await delayed.entered
        expect(request).toHaveBeenCalledOnce()

        session.beginLoginSession()
        session.setAccessToken("desktop-account-b", Date.now() + 60_000)
        delayed.completeBody()

        const error = await pending
        expect(error).toMatchObject({ name: "AbortError" })
        expect(error).not.toBeInstanceOf(client.ApiError)
        expect(delayed.cancel).not.toHaveBeenCalled()
        expect(request).toHaveBeenCalledOnce()
        expect(session.getAccessToken()).toBe("desktop-account-b")
      } finally {
        session.setAccessToken(null)
        request.mockRestore()
        vi.unstubAllGlobals()
        delete document.documentElement.dataset.desktopPlatform
        vi.resetModules()
      }
    }
  )
})

it("does not apply account A's delayed desktop upload response to account B", async () => {
  vi.resetModules()
  vi.stubGlobal("mygo", {})
  const desktop = await import("@/adapters/desktop/desktop-adapter")
  const client = await import("./client")
  const session = await import("./session")
  const serverUrl = vi
    .spyOn(desktop, "getDesktopServerUrl")
    .mockReturnValue("https://desktop.example.test")
  let deliverUpload!: (response: Response) => void
  const request = vi.spyOn(desktop, "hostFetch").mockReturnValue(
    new Promise<Response>((resolve) => {
      deliverUpload = resolve
    })
  )
  const onUploadProgress = vi.fn()

  try {
    session.setAccessToken("desktop-account-a", Date.now() + 60_000)
    const upload = client
      .apiUploadRequest("/capabilities/import", {
        method: "POST",
        body: new FormData(),
        schema: z.object({ id: z.string() }),
        onUploadProgress,
      })
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())

    // Account A's native upload headers arrive only after B owns the session.
    session.beginLoginSession()
    session.setAccessToken("desktop-account-b", Date.now() + 60_000)
    deliverUpload(json({ success: true, data: { id: "account-a-upload" } }))

    await expect(upload).resolves.toMatchObject({ name: "AbortError" })
    expect(onUploadProgress).not.toHaveBeenCalled()
    expect(desktop.getDesktopUpdateRequired()).toBe(false)
    expect(session.getAccessToken()).toBe("desktop-account-b")
  } finally {
    session.setAccessToken(null)
    request.mockRestore()
    serverUrl.mockRestore()
    vi.unstubAllGlobals()
    vi.resetModules()
  }
})

it("does not apply account A's delayed desktop download headers to account B", async () => {
  vi.resetModules()
  vi.stubGlobal("mygo", {})
  const desktop = await import("@/adapters/desktop/desktop-adapter")
  const client = await import("./client")
  const session = await import("./session")
  const serverUrl = vi
    .spyOn(desktop, "getDesktopServerUrl")
    .mockReturnValue("https://desktop.example.test")
  let deliverDownload!: (response: Response) => void
  const request = vi.spyOn(desktop, "hostFetch").mockReturnValue(
    new Promise<Response>((resolve) => {
      deliverDownload = resolve
    })
  )

  try {
    session.setAccessToken("desktop-account-a", Date.now() + 60_000)
    const download = client
      .downloadApiFile("/conversations/c1/files/f1/download")
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())

    // Account A's Finder download headers arrive only after B owns the session.
    session.beginLoginSession()
    session.setAccessToken("desktop-account-b", Date.now() + 60_000)
    deliverDownload(new Response("account-a-file", { status: 200 }))

    await expect(download).resolves.toMatchObject({ name: "AbortError" })
    expect(desktop.getDesktopUpdateRequired()).toBe(false)
    expect(session.getAccessToken()).toBe("desktop-account-b")
  } finally {
    session.setAccessToken(null)
    request.mockRestore()
    serverUrl.mockRestore()
    vi.unstubAllGlobals()
    vi.resetModules()
  }
})

it("does not deliver a download whose body completes after the login changed", async () => {
  vi.resetModules()
  vi.stubGlobal("mygo", {})
  const desktop = await import("@/adapters/desktop/desktop-adapter")
  const client = await import("./client")
  const session = await import("./session")
  const serverUrl = vi
    .spyOn(desktop, "getDesktopServerUrl")
    .mockReturnValue("https://desktop.example.test")
  let finishBody!: () => void
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("account-a-file"))
      finishBody = () => controller.close()
    },
  })
  const request = vi.spyOn(desktop, "hostFetch").mockResolvedValue(
    new Response(body, {
      status: 200,
      headers: { [DESKTOP_PROTOCOL_HEADER]: String(desktopProtocolVersion) },
    })
  )

  try {
    session.setAccessToken("desktop-account-a", Date.now() + 60_000)
    const download = client
      .downloadApiFile("/conversations/c1/files/f1/download")
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    // Header checks have passed while A is current; the body is still pending.
    await new Promise((resolve) => setTimeout(resolve, 0))

    session.beginLoginSession()
    session.setAccessToken("desktop-account-b", Date.now() + 60_000)
    finishBody()

    await expect(download).resolves.toMatchObject({ name: "AbortError" })
    expect(desktop.getDesktopUpdateRequired()).toBe(false)
    expect(session.getAccessToken()).toBe("desktop-account-b")
  } finally {
    session.setAccessToken(null)
    request.mockRestore()
    serverUrl.mockRestore()
    vi.unstubAllGlobals()
    vi.resetModules()
  }
})

it("keeps the desktop update gate for a mismatched response from the current login", async () => {
  vi.resetModules()
  vi.stubGlobal("mygo", {})
  const desktop = await import("@/adapters/desktop/desktop-adapter")
  const client = await import("./client")
  const session = await import("./session")
  const serverUrl = vi
    .spyOn(desktop, "getDesktopServerUrl")
    .mockReturnValue("https://desktop.example.test")
  const request = vi
    .spyOn(desktop, "hostFetch")
    .mockResolvedValue(new Response("account-a-file", { status: 200 }))

  try {
    session.setAccessToken("desktop-account-a", Date.now() + 60_000)
    await expect(
      client.downloadApiFile("/conversations/c1/files/f1/download")
    ).rejects.toMatchObject({ errorCode: "DESKTOP_UPDATE_REQUIRED" })
    expect(desktop.getDesktopUpdateRequired()).toBe(true)
  } finally {
    session.setAccessToken(null)
    request.mockRestore()
    serverUrl.mockRestore()
    vi.unstubAllGlobals()
    vi.resetModules()
  }
})

it("does not apply a stale browser upload build response to the replacement login", async () => {
  const oldBuild = "a".repeat(64)
  const newBuild = "b".repeat(64)
  vi.resetModules()
  vi.stubEnv("VITE_LINKSENSE_BUILD_ID", oldBuild)
  const client = await import("./client")
  const session = await import("./session")
  const build = await import("@/app/client-build")
  const onUploadProgress = vi.fn()
  const deferredRequest: {
    current: {
      respond(status: number, response: unknown): void
      progress(): void
    } | null
  } = { current: null }

  class DeferredUploadRequest extends EventTarget {
    responseType: XMLHttpRequestResponseType = ""
    status = 0
    response: unknown = null
    withCredentials = false
    readonly upload = new EventTarget()

    open() {}
    setRequestHeader() {}
    getResponseHeader(name: string) {
      return name.toLowerCase() === SERVER_BUILD_HEADER ? newBuild : null
    }
    send() {
      deferredRequest.current = this
    }
    abort() {
      this.dispatchEvent(new Event("abort"))
    }
    progress() {
      this.upload.dispatchEvent(
        new ProgressEvent("progress", {
          lengthComputable: true,
          loaded: 5,
          total: 10,
        })
      )
    }
    respond(status: number, response: unknown) {
      this.status = status
      this.response = response
      this.dispatchEvent(new Event("load"))
    }
  }

  vi.stubGlobal("XMLHttpRequest", DeferredUploadRequest)
  try {
    session.setAccessToken("web-account-a", Date.now() + 60_000)
    const upload = client
      .apiUploadRequest("/capabilities/import", {
        method: "POST",
        body: new FormData(),
        schema: z.object({ id: z.string() }),
        onUploadProgress,
      })
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(deferredRequest.current).not.toBeNull())

    // Account A's delayed XHR progress and headers arrive after B signs in.
    session.beginLoginSession()
    session.setAccessToken("web-account-b", Date.now() + 60_000)
    deferredRequest.current?.progress()
    deferredRequest.current?.respond(200, {
      success: true,
      data: { id: "account-a-upload" },
    })

    await expect(upload).resolves.toMatchObject({ name: "AbortError" })
    expect(onUploadProgress).not.toHaveBeenCalled()
    expect(build.getPendingClientBuild()).toBeNull()
    expect(session.getAccessToken()).toBe("web-account-b")
  } finally {
    session.setAccessToken(null)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  }
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

  it("treats a refresh rejection that settles after the login changed as local cancellation", async () => {
    const loginSessionA = getLoginSessionBoundary()
    let resolveRefresh!: (response: Response) => void
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    const refreshRequests: Array<string | null> = []
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const path = new URL(String(input), window.location.origin).pathname
        if (path === "/api/v1/auth/refresh") {
          refreshRequests.push(new Headers(init?.headers).get("Authorization"))
          return refreshResponse
        }
        throw new Error(`unexpected request ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)

    const pendingRefresh = refreshSession(
      "stale-access-token",
      loginSessionA
    ).catch((error: unknown) => error)
    await vi.waitFor(() => expect(refreshRequests).toHaveLength(1))
    expect(refreshRequests[0]).toBeNull()

    beginLoginSession()
    setAccessToken("replacement-login-token", Date.now() + 60_000)
    // The server's genuine 401 belongs to the previous login and settles late.
    resolveRefresh(
      json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
    )

    const error = await pendingRefresh
    expect(error).toMatchObject({ name: "AbortError" })
    expect(error).not.toBeInstanceOf(ApiError)
    expect(getAccessToken()).toBe("replacement-login-token")
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("treats a refresh success that settles after the login changed as local cancellation", async () => {
    const loginSessionA = getLoginSessionBoundary()
    let resolveRefresh!: (response: Response) => void
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    const fetchMock = vi.fn(
      (input: RequestInfo | URL): Promise<Response> => {
        const path = new URL(String(input), window.location.origin).pathname
        if (path === "/api/v1/auth/refresh") return refreshResponse
        throw new Error(`unexpected request ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)

    const pendingRefresh = refreshSession(
      "stale-access-token",
      loginSessionA
    ).catch((error: unknown) => error)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    beginLoginSession()
    setAccessToken("replacement-login-token", Date.now() + 60_000)
    resolveRefresh(
      json({
        success: true,
        data: authSession("old-login-refreshed-token".padEnd(48, "x")),
      })
    )

    const error = await pendingRefresh
    expect(error).toMatchObject({ name: "AbortError" })
    expect(getAccessToken()).toBe("replacement-login-token")
  })

  it("releases its own fallback refresh lease immediately when the login changed during verification", async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    })
    const leaseKey = "linksense.auth.refresh-lease.v1"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    try {
      const loginSessionA = getLoginSessionBoundary()
      const pendingRefresh = refreshSession(
        "stale-access-token",
        loginSessionA
      ).catch((error: unknown) => error)
      const acquiredLease = JSON.parse(
        window.localStorage.getItem(leaseKey) ?? "null"
      ) as { ownerId: string; expiresAt: number }
      expect(acquiredLease.ownerId).toBeTypeOf("string")
      expect(acquiredLease.expiresAt).toBeGreaterThan(Date.now())

      // The replacement login wins while the 100ms verification wait is held.
      beginLoginSession()
      setAccessToken("replacement-login-token", Date.now() + 60_000)
      await vi.advanceTimersByTimeAsync(100)

      expect(window.localStorage.getItem(leaseKey)).toBeNull()
      const error = await pendingRefresh
      expect(error).toMatchObject({ name: "AbortError" })
      // The stale flow never starts renewal or a refresh request.
      await vi.advanceTimersByTimeAsync(3_000)
      expect(window.localStorage.getItem(leaseKey)).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(getAccessToken()).toBe("replacement-login-token")
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not release another tab's fallback refresh lease when a stale generation wakes", async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    })
    const leaseKey = "linksense.auth.refresh-lease.v1"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    try {
      const loginSessionA = getLoginSessionBoundary()
      const pendingRefresh = refreshSession(
        "stale-access-token",
        loginSessionA
      ).catch((error: unknown) => error)
      expect(window.localStorage.getItem(leaseKey)).not.toBeNull()
      const otherLease = {
        ownerId: "another-tab-owner",
        expiresAt: Date.now() + 10_000,
      }
      window.localStorage.setItem(leaseKey, JSON.stringify(otherLease))

      beginLoginSession()
      setAccessToken("replacement-login-token", Date.now() + 60_000)
      await vi.advanceTimersByTimeAsync(100)

      const error = await pendingRefresh
      expect(error).toMatchObject({ name: "AbortError" })
      expect(
        JSON.parse(window.localStorage.getItem(leaseKey) ?? "null")
      ).toEqual(otherLease)
      await vi.advanceTimersByTimeAsync(3_000)
      expect(
        JSON.parse(window.localStorage.getItem(leaseKey) ?? "null")
      ).toEqual(otherLease)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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

  it("runs the optional attempt guard before each physical attempt and can stop the post-refresh retry", async () => {
    const guard = vi.fn()
    guard
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new ApiError({ status: 409, errorCode: "WRITE_CLOSED" })
      })
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
      .mockResolvedValueOnce(json({ success: true, data: { id: "created" } }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      apiRequest("/conversations", {
        method: "POST",
        body: {},
        schema: z.unknown(),
        beforeAttempt: guard,
      })
    ).rejects.toMatchObject({ status: 409, errorCode: "WRITE_CLOSED" })

    expect(guard).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getAccessToken()).toBe(refreshedAccessToken)
  })

  it("keeps an opted-in write when its attempt guard allows both attempts", async () => {
    const guard = vi.fn()
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
      .mockResolvedValueOnce(json({ success: true, data: { id: "created" } }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      apiRequest("/conversations", {
        method: "POST",
        body: {},
        schema: z.object({ id: z.string() }),
        beforeAttempt: guard,
      })
    ).resolves.toEqual({ id: "created" })

    expect(guard).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getAccessToken()).toBe(refreshedAccessToken)
  })

  it("keeps authentication untouched when an auth-shaped attempt guard rejects", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const rejectBeforeRequest = () => {
      throw new ApiError({ status: 401, errorCode: "AUTH_REQUIRED" })
    }

    // A local eligibility rejection is not an HTTP response, so it must not
    // rotate the session before the first physical attempt.
    await expect(
      apiRequest("/conversations", {
        method: "POST",
        body: {},
        schema: z.unknown(),
        beforeAttempt: rejectBeforeRequest,
      })
    ).rejects.toMatchObject({ status: 401, errorCode: "AUTH_REQUIRED" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe("stale-access-token")

    // The post-refresh attempt guard runs outside the retry's authentication
    // catch, so its rejection keeps the session refreshed a moment earlier.
    const guard = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new ApiError({ status: 401, errorCode: "AUTH_REQUIRED" })
      })
    fetchMock
      .mockResolvedValueOnce(
        json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
      )
      .mockResolvedValueOnce(
        json({
          success: true,
          data: authSession(refreshedAccessToken),
        })
      )

    await expect(
      apiRequest("/conversations", {
        method: "POST",
        body: {},
        schema: z.unknown(),
        beforeAttempt: guard,
      })
    ).rejects.toMatchObject({ status: 401, errorCode: "AUTH_REQUIRED" })
    expect(guard).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getAccessToken()).toBe(refreshedAccessToken)
  })

  it("does not apply a refresh, retry, or token clear from a replaced login session", async () => {
    const loginSessionBoundary = getLoginSessionBoundary()
    let resolveRefresh!: (response: Response) => void
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
      )
      .mockImplementationOnce(() => refreshResponse)
      .mockResolvedValueOnce(json({ success: true, data: { id: "stale" } }))
    vi.stubGlobal("fetch", fetchMock)

    const request = apiRequest("/conversations/task", {
      method: "POST",
      body: {},
      schema: z.unknown(),
      loginSessionBoundary,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(beginLoginSession()).not.toBe(loginSessionBoundary)
    setAccessToken("replacement-login-token", Date.now() + 60_000)
    resolveRefresh(json(authSession("old-login-refreshed-token")))

    await expect(request).rejects.toMatchObject({
      status: 401,
      errorCode: "AUTH_SESSION_EXPIRED",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getAccessToken()).toBe("replacement-login-token")
  })

  it("does not refresh or clear a replacement login when an ordinary request fails after sign-out", async () => {
    let resolveAttempt!: (response: Response) => void
    const firstAttempt = new Promise<Response>((resolve) => {
      resolveAttempt = resolve
    })
    const attempts: Array<string | null> = []
    const refreshRequests: Array<string | null> = []
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const path = new URL(String(input), window.location.origin).pathname
        const authorization = new Headers(init?.headers).get("Authorization")
        if (path === "/api/v1/auth/refresh") {
          refreshRequests.push(authorization)
          throw new Error("refresh must not start after sign-out")
        }
        if (path === "/api/v1/conversations/task") {
          attempts.push(authorization)
          if (attempts.length === 1) return firstAttempt
          return Promise.resolve(
            json({ success: true, data: { id: "replayed" } })
          )
        }
        throw new Error(`unexpected request ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)

    // No loginSessionBoundary option: ownership is captured at request start.
    const request = apiRequest("/conversations/task", {
      method: "POST",
      body: {},
      schema: z.unknown(),
    }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    expect(attempts[0]).toBe("Bearer stale-access-token")

    beginLoginSession()
    setAccessToken("replacement-login-token", Date.now() + 60_000)
    resolveAttempt(
      json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
    )

    await expect(request).resolves.toMatchObject({
      status: 401,
      errorCode: "AUTH_SESSION_EXPIRED",
    })
    // No replay with the replacement credentials.
    expect(attempts).toHaveLength(1)
    expect(refreshRequests).toHaveLength(0)
    expect(getAccessToken()).toBe("replacement-login-token")
  })

  it.each(["refreshed", "definitively rejected"] as const)(
    "does not apply an ordinary request's old refresh after sign-out when it is %s",
    async (refreshOutcome) => {
      let resolveRefresh!: (response: Response) => void
      const refreshResponse = new Promise<Response>((resolve) => {
        resolveRefresh = resolve
      })
      const attempts: Array<string | null> = []
      const refreshRequests: Array<string | null> = []
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const path = new URL(String(input), window.location.origin).pathname
          const authorization = new Headers(init?.headers).get("Authorization")
          if (path === "/api/v1/auth/refresh") {
            refreshRequests.push(authorization)
            return refreshResponse
          }
          if (path === "/api/v1/conversations/task") {
            attempts.push(authorization)
            if (attempts.length === 1) {
              return Promise.resolve(
                json(
                  { success: false, error_code: "AUTH_SESSION_EXPIRED" },
                  401
                )
              )
            }
            return Promise.resolve(
              json({ success: true, data: { id: "replayed" } })
            )
          }
          throw new Error(`unexpected request ${path}`)
        }
      )
      vi.stubGlobal("fetch", fetchMock)

      const request = apiRequest("/conversations/task", {
        method: "POST",
        body: {},
        schema: z.unknown(),
      }).catch((error: unknown) => error)
      await vi.waitFor(() => expect(refreshRequests).toHaveLength(1))
      expect(refreshRequests[0]).toBeNull()

      beginLoginSession()
      setAccessToken("replacement-login-token", Date.now() + 60_000)
      resolveRefresh(
        refreshOutcome === "refreshed"
          ? json({
              success: true,
              data: authSession("old-login-refreshed-token".padEnd(48, "x")),
            })
          : json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
      )

      await expect(request).resolves.toMatchObject({
        status: 401,
        errorCode: "AUTH_SESSION_EXPIRED",
      })
      // No replay with the replacement credentials and no clear of its token.
      expect(attempts).toHaveLength(1)
      expect(getAccessToken()).toBe("replacement-login-token")
    }
  )

  it("does not clear a replacement login when an ordinary retry from the previous login fails", async () => {
    const refreshedLoginToken = "first-login-refreshed-token".padEnd(48, "x")
    let resolveRetry!: (response: Response) => void
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetry = resolve
    })
    const attempts: Array<string | null> = []
    const refreshRequests: Array<string | null> = []
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const path = new URL(String(input), window.location.origin).pathname
        const authorization = new Headers(init?.headers).get("Authorization")
        if (path === "/api/v1/auth/refresh") {
          refreshRequests.push(authorization)
          return Promise.resolve(
            json({
              success: true,
              data: authSession(refreshedLoginToken),
            })
          )
        }
        if (path === "/api/v1/conversations/task") {
          attempts.push(authorization)
          if (attempts.length === 1) {
            return Promise.resolve(
              json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
            )
          }
          return retryResponse
        }
        throw new Error(`unexpected request ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)

    const request = apiRequest("/conversations/task", {
      method: "POST",
      body: {},
      schema: z.unknown(),
    }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    expect(attempts[1]).toBe(`Bearer ${refreshedLoginToken}`)

    beginLoginSession()
    setAccessToken("replacement-login-token", Date.now() + 60_000)
    resolveRetry(
      json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
    )

    await expect(request).resolves.toMatchObject({
      status: 401,
      errorCode: "AUTH_SESSION_EXPIRED",
    })
    expect(attempts).toHaveLength(2)
    expect(refreshRequests).toHaveLength(1)
    expect(getAccessToken()).toBe("replacement-login-token")
  })

  it("keeps refresh single-flight within each login generation and does not reuse A's refresh for B", async () => {
    const accountAToken = "refresh-generation-account-a-token"
    const accountBToken = "refresh-generation-account-b-token"
    const accountARefreshed = "refresh-generation-account-a-refreshed"
    const accountBRefreshed = "refresh-generation-account-b-refreshed"
    setAccessToken(accountAToken, Date.now() + 60_000)
    const loginSessionA = getLoginSessionBoundary()

    let resolveRefreshA!: (response: Response) => void
    let resolveRefreshB!: (response: Response) => void
    const refreshA = new Promise<Response>((resolve) => {
      resolveRefreshA = resolve
    })
    const refreshB = new Promise<Response>((resolve) => {
      resolveRefreshB = resolve
    })
    const refreshRequests: { authorization: string | null }[] = []
    const raceRequests: { path: string; authorization: string | null }[] = []
    const raceAttempts = new Map<string, number>()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      const authorization = new Headers(init?.headers).get("Authorization")
      if (path === "/api/v1/auth/refresh") {
        refreshRequests.push({ authorization })
        return refreshRequests.length === 1 ? refreshA : refreshB
      }
      if (path === "/api/v1/race/a" || path === "/api/v1/race/b") {
        const attempt = (raceAttempts.get(path) ?? 0) + 1
        raceAttempts.set(path, attempt)
        raceRequests.push({ path, authorization })
        if (attempt > 1 && authorization === `Bearer ${accountBRefreshed}`) {
          return Promise.resolve(json({ success: true, data: { ok: true } }))
        }
        return Promise.resolve(
          json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
        )
      }
      throw new Error(`unexpected request ${path}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const requestA = apiRequest("/race/a", {
      method: "POST",
      schema: z.object({ ok: z.boolean() }),
      loginSessionBoundary: loginSessionA,
    }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(refreshRequests).toHaveLength(1))
    expect(refreshRequests[0]?.authorization).toBeNull()

    const loginSessionB = beginLoginSession()
    expect(loginSessionB).not.toBe(loginSessionA)
    setAccessToken(accountBToken, Date.now() + 60_000)

    const requestB = apiRequest("/race/b", {
      method: "POST",
      schema: z.object({ ok: z.boolean() }),
      loginSessionBoundary: loginSessionB,
    })
    let requestBSettled = false
    void requestB.then(
      () => {
        requestBSettled = true
      },
      () => {
        requestBSettled = true
      }
    )
    await vi.waitFor(() => expect(refreshRequests).toHaveLength(2))
    expect(refreshRequests[1]?.authorization).toBeNull()
    expect(requestBSettled).toBe(false)

    resolveRefreshA(
      json({ success: true, data: authSession(accountARefreshed) })
    )
    await expect(requestA).resolves.toMatchObject({
      status: 401,
      errorCode: "AUTH_SESSION_EXPIRED",
    })
    expect(getAccessToken()).toBe(accountBToken)
    expect(requestBSettled).toBe(false)

    // A's finally callback has run by now. A second refresh for the still-live
    // B generation must join B's pending refresh instead of starting a third.
    const secondBRefresh = refreshSession(accountBToken, loginSessionB).catch(
      (error: unknown) => error
    )
    expect(refreshRequests).toHaveLength(2)

    resolveRefreshB(
      json({ success: true, data: authSession(accountBRefreshed) })
    )
    await expect(requestB).resolves.toEqual({ ok: true })
    await expect(secondBRefresh).resolves.toMatchObject({
      access_token: accountBRefreshed,
    })
    const bRaceRequests = raceRequests.filter(
      (request) => request.path === "/api/v1/race/b"
    )
    expect(bRaceRequests).toHaveLength(2)
    expect(bRaceRequests[1]?.authorization).toBe(`Bearer ${accountBRefreshed}`)
    expect(
      raceRequests.filter((request) => request.path === "/api/v1/race/a")
    ).toHaveLength(1)
    expect(getAccessToken()).toBe(accountBRefreshed)
  })

  it("keeps the current generation's pending refresh when a stale login's late 401 attempts refresh", async () => {
    const accountAToken = "late-401-account-a-token".padEnd(48, "x")
    const accountBToken = "late-401-account-b-token".padEnd(48, "x")
    const accountBRefreshed = "late-401-account-b-refreshed".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const loginSessionA = getLoginSessionBoundary()

    const loginSessionB = beginLoginSession()
    expect(loginSessionB).not.toBe(loginSessionA)
    setAccessToken(accountBToken, Date.now() + 60_000)

    let resolveRefreshB!: () => void
    const refreshB = new Promise<void>((resolve) => {
      resolveRefreshB = resolve
    })
    const refreshRequests: Array<string | null> = []
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const path = new URL(String(input), window.location.origin).pathname
        if (path === "/api/v1/auth/refresh") {
          refreshRequests.push(new Headers(init?.headers).get("Authorization"))
          return refreshB.then(() =>
            json({ success: true, data: authSession(accountBRefreshed) })
          )
        }
        throw new Error(`unexpected request ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)

    const firstBRefresh = refreshSession(accountBToken, loginSessionB)
    await vi.waitFor(() => expect(refreshRequests).toHaveLength(1))
    expect(refreshRequests[0]).toBeNull()

    // A's terminal 401 arrives after B owns the session. It must reject as
    // local cancellation without taking over or clearing B's shared slot.
    const staleAError = await refreshSession(
      accountAToken,
      loginSessionA
    ).catch((error: unknown) => error)
    expect(staleAError).toMatchObject({ name: "AbortError" })
    expect(refreshRequests).toHaveLength(1)

    // A current B waiter arriving before the first B refresh settles must join
    // that refresh instead of issuing a second POST.
    const secondBRefresh = refreshSession(accountBToken, loginSessionB)
    const refreshPostsWhileBPending = refreshRequests.length

    resolveRefreshB()

    const [firstRefresh, secondRefresh] = await Promise.all([
      firstBRefresh,
      secondBRefresh,
    ])
    expect(refreshPostsWhileBPending).toBe(1)
    expect(refreshRequests).toHaveLength(1)
    expect(firstRefresh.access_token).toBe(accountBRefreshed)
    expect(secondRefresh.access_token).toBe(accountBRefreshed)
    expect(getAccessToken()).toBe(accountBRefreshed)
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

  it("retries an upload once with the same login's rotated token", async () => {
    const requests: Array<{
      respond(status: number, response: unknown): void
      authorization(): string | null
    }> = []

    class UploadRequest extends EventTarget {
      responseType: XMLHttpRequestResponseType = ""
      status = 0
      response: unknown = null
      withCredentials = false
      readonly upload = new EventTarget()
      private readonly requestHeaders = new Map<string, string>()

      open() {}
      setRequestHeader(name: string, value: string) {
        this.requestHeaders.set(name.toLowerCase(), value)
      }
      getResponseHeader() {
        return null
      }
      send() {
        requests.push(this)
      }
      abort() {
        this.dispatchEvent(new Event("abort"))
      }
      authorization() {
        return this.requestHeaders.get("authorization") ?? null
      }
      respond(status: number, response: unknown) {
        this.status = status
        this.response = response
        this.dispatchEvent(new Event("load"))
      }
    }

    vi.stubGlobal("XMLHttpRequest", UploadRequest)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({ success: true, data: authSession(refreshedAccessToken) })
      )
    )
    const upload = apiUploadRequest("/capabilities/import", {
      method: "POST",
      body: new FormData(),
      schema: z.object({ id: z.string() }),
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.authorization()).toBe("Bearer stale-access-token")
    requests[0]?.respond(401, {
      success: false,
      error_code: "AUTH_SESSION_EXPIRED",
    })

    await vi.waitFor(() => expect(requests).toHaveLength(2))
    requests[1]?.respond(200, { success: true, data: { id: "upload-1" } })

    await expect(upload).resolves.toEqual({ id: "upload-1" })
    expect(requests[1]?.authorization()).toBe(`Bearer ${refreshedAccessToken}`)
    expect(getAccessToken()).toBe(refreshedAccessToken)
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
