import { afterEach, describe, expect, it, vi } from "vitest"

import { connectKnowledgeBaseEvents } from "@/features/knowledge-bases/knowledge-base-events"
import {
  beginLoginSession,
  getAccessToken,
  setAccessToken,
} from "@/api/session"

const KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001"

describe("knowledge base event connector", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setAccessToken(null)
    restoreWebLocks()
  })

  it("does not reconnect after an authoritative stream termination", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const onConnectionChange = vi.fn()
    const shouldReconnect = vi.fn(() => Promise.resolve(false))

    const disconnect = connectKnowledgeBaseEvents(
      "00000000-0000-4000-8000-000000000001",
      {
        onEvent: vi.fn(),
        onConnectionChange,
        shouldReconnect,
      }
    )

    await vi.waitFor(() => expect(shouldReconnect).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onConnectionChange).toHaveBeenCalledWith("connected")
    expect(onConnectionChange).not.toHaveBeenCalledWith("reconnecting")
    disconnect()
  })

  it("stops an abandoned stream without refreshing, replaying, or clearing the replacement login when its initial 401 arrives after sign-in", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    let resolveInitial!: (response: Response) => void
    const initial = new Promise<Response>((resolve) => {
      resolveInitial = resolve
    })
    let eventRequests = 0
    const eventAuthorizations: Array<string | null> = []
    const requestedPaths: string[] = []
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const path = new URL(String(input), window.location.origin).pathname
        requestedPaths.push(path)
        if (path === "/api/v1/auth/refresh") {
          return Promise.resolve(
            authSessionResponse("account-a-refreshed".padEnd(48, "x"))
          )
        }
        if (path === `/api/v1/knowledge-bases/${KNOWLEDGE_BASE_ID}/events`) {
          eventRequests += 1
          eventAuthorizations.push(
            new Headers(init?.headers).get("Authorization")
          )
          return eventRequests === 1
            ? initial
            : Promise.resolve(authFailureResponse())
        }
        throw new Error(`unexpected request ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    installImmediateWebLock()
    const onConnectionChange = vi.fn()
    const shouldReconnect = vi.fn(() => true)

    const disconnect = connectKnowledgeBaseEvents(KNOWLEDGE_BASE_ID, {
      onEvent: vi.fn(),
      onConnectionChange,
      shouldReconnect,
    })
    try {
      await vi.waitFor(() => expect(eventRequests).toBe(1))

      beginLoginSession()
      setAccessToken(accountBToken, Date.now() + 60_000)
      resolveInitial(authFailureResponse())
      await new Promise((resolve) => window.setTimeout(resolve, 0))

      expect(requestedPaths).toEqual([
        `/api/v1/knowledge-bases/${KNOWLEDGE_BASE_ID}/events`,
      ])
      expect(eventAuthorizations).toEqual([`Bearer ${accountAToken}`])
      expect(getAccessToken()).toBe(accountBToken)
      expect(shouldReconnect).not.toHaveBeenCalled()
      expect(onConnectionChange).not.toHaveBeenCalledWith("reconnecting")
    } finally {
      disconnect()
    }
  })

  it("does not deliver events accepted for a previous login", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
      },
    })
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const onEvent = vi.fn()
    const onConnectionChange = vi.fn()
    const disconnect = connectKnowledgeBaseEvents(KNOWLEDGE_BASE_ID, {
      onEvent,
      onConnectionChange,
      shouldReconnect: () => true,
    })
    try {
      await vi.waitFor(() =>
        expect(onConnectionChange).toHaveBeenCalledWith("connected")
      )
      beginLoginSession()
      setAccessToken(accountBToken, Date.now() + 60_000)
      streamController.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify(knowledgeEvent())}\n\n`
        )
      )
      await new Promise((resolve) => window.setTimeout(resolve, 0))

      expect(onEvent).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(getAccessToken()).toBe(accountBToken)
    } finally {
      disconnect()
    }
  })

  it("does not run the reconnect decision or replay after sign-in when a connected stream ends", async () => {
    vi.useFakeTimers()
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
      },
    })
    const authorizations: Array<string | null> = []
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        authorizations.push(new Headers(init?.headers).get("Authorization"))
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    let signalConnected!: () => void
    const connected = new Promise<void>((resolve) => {
      signalConnected = resolve
    })
    const onConnectionChange = vi.fn((state: "connected" | "reconnecting") => {
      if (state === "connected") signalConnected()
    })
    const shouldReconnect = vi.fn(() => true)
    const disconnect = connectKnowledgeBaseEvents(KNOWLEDGE_BASE_ID, {
      onEvent: vi.fn(),
      onConnectionChange,
      shouldReconnect,
    })
    try {
      await connected

      // The connected stream still belongs to login A. Login B replaces it
      // while the connector is waiting for the next chunk.
      beginLoginSession()
      setAccessToken(accountBToken, Date.now() + 60_000)
      streamController.close()
      await vi.advanceTimersByTimeAsync(5_000)

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(authorizations).toEqual([`Bearer ${accountAToken}`])
      expect(shouldReconnect).not.toHaveBeenCalled()
      expect(onConnectionChange).not.toHaveBeenCalledWith("reconnecting")
      expect(getAccessToken()).toBe(accountBToken)
    } finally {
      disconnect()
    }
  })
})

function knowledgeEvent() {
  return {
    type: "knowledge_document_processing_updated",
    knowledge_base_id: KNOWLEDGE_BASE_ID,
    document_id: "00000000-0000-4000-8000-000000000002",
    processing_generation: null,
    status: "processing",
    stage: "queued",
    progress_percent: 10,
    revision: 1,
    retry_at: null,
    retry_attempt: 0,
    stable_error_code: null,
    updated_at: "2026-07-11T00:00:00.000Z",
  }
}

function authSessionResponse(accessToken: string) {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
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
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  )
}

function authFailureResponse() {
  return new Response(
    JSON.stringify({ success: false, error_code: "AUTH_SESSION_EXPIRED" }),
    { status: 401, headers: { "content-type": "application/json" } }
  )
}

function installImmediateWebLock() {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, callback: () => Promise<unknown>) => callback(),
    },
  })
}

function restoreWebLocks() {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  })
}
