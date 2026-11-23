import { afterEach, describe, expect, it, vi } from "vitest"

import { connectKnowledgeCitationEvents } from "@/features/knowledge-bases/knowledge-citation-events"
import {
  beginLoginSession,
  getAccessToken,
  setAccessToken,
} from "@/api/session"

const CITATION_ID = "00000000-0000-4000-8000-000000000001"

describe("knowledge citation event connector", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setAccessToken(null)
    restoreWebLocks()
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
        if (path === `/api/v1/knowledge-citations/${CITATION_ID}/events`) {
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
    const shouldReconnect = vi.fn(() => true)
    const onSourceChanged = vi.fn()

    const disconnect = connectKnowledgeCitationEvents(CITATION_ID, {
      onSourceChanged,
      shouldReconnect,
    })
    try {
      await vi.waitFor(() => expect(eventRequests).toBe(1))

      beginLoginSession()
      setAccessToken(accountBToken, Date.now() + 60_000)
      resolveInitial(authFailureResponse())
      await new Promise((resolve) => window.setTimeout(resolve, 0))

      expect(requestedPaths).toEqual([
        `/api/v1/knowledge-citations/${CITATION_ID}/events`,
      ])
      expect(eventAuthorizations).toEqual([`Bearer ${accountAToken}`])
      expect(getAccessToken()).toBe(accountBToken)
      expect(shouldReconnect).not.toHaveBeenCalled()
      expect(onSourceChanged).not.toHaveBeenCalled()
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
    const onSourceChanged = vi.fn()
    const disconnect = connectKnowledgeCitationEvents(CITATION_ID, {
      onSourceChanged,
      shouldReconnect: () => true,
    })
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      beginLoginSession()
      setAccessToken(accountBToken, Date.now() + 60_000)
      streamController.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "knowledge_citation_source_changed" })}\n\n`
        )
      )
      await new Promise((resolve) => window.setTimeout(resolve, 0))

      expect(onSourceChanged).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(getAccessToken()).toBe(accountBToken)
    } finally {
      disconnect()
    }
  })

  it("does not reconnect when the reconnect decision resolves after sign-in", async () => {
    vi.useFakeTimers()
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const authorizations: Array<string | null> = []
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        authorizations.push(new Headers(init?.headers).get("Authorization"))
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    let resolveDecision!: (reconnect: boolean) => void
    const decision = new Promise<boolean>((resolve) => {
      resolveDecision = resolve
    })
    const shouldReconnect = vi.fn(() => decision)
    const disconnect = connectKnowledgeCitationEvents(CITATION_ID, {
      onSourceChanged: vi.fn(),
      shouldReconnect,
    })
    try {
      await vi.waitFor(() => expect(shouldReconnect).toHaveBeenCalledOnce())

      // Login B owns the session before the authoritative reconnect decision
      // for login A resolves. The connector must not act on A's decision.
      beginLoginSession()
      setAccessToken(accountBToken, Date.now() + 60_000)
      resolveDecision(true)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(authorizations).toEqual([`Bearer ${accountAToken}`])
      expect(getAccessToken()).toBe(accountBToken)
    } finally {
      disconnect()
    }
  })
  it("aborts a pending reconnect decision as soon as the previous login is replaced", async () => {
    vi.useFakeTimers()
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    let resolveDecision!: (reconnect: boolean) => void
    const decision = new Promise<boolean>((resolve) => {
      resolveDecision = resolve
    })
    let decisionSignal: AbortSignal | undefined
    const shouldReconnect = vi.fn((signal: AbortSignal) => {
      decisionSignal = signal
      return decision
    })
    const disconnect = connectKnowledgeCitationEvents(CITATION_ID, {
      onSourceChanged: vi.fn(),
      shouldReconnect,
    })
    try {
      await vi.waitFor(() => expect(shouldReconnect).toHaveBeenCalledOnce())

      expect(decisionSignal?.aborted).toBe(false)
      beginLoginSession()
      setAccessToken(accountBToken, Date.now() + 60_000)
      // The connector must abort the signal while the callback is still
      // awaiting its decision, not only after that decision resolves.
      expect(decisionSignal?.aborted).toBe(true)

      resolveDecision(true)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(getAccessToken()).toBe(accountBToken)
    } finally {
      disconnect()
    }
  })

  it("keeps a pending reconnect decision when the same login rotates its token", async () => {
    vi.useFakeTimers()
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const rotatedAToken = "account-a-rotated-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const authorizations: Array<string | null> = []
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        authorizations.push(new Headers(init?.headers).get("Authorization"))
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    let resolveDecision!: (reconnect: boolean) => void
    const decision = new Promise<boolean>((resolve) => {
      resolveDecision = resolve
    })
    let decisionSignal: AbortSignal | undefined
    const shouldReconnect = vi.fn((signal: AbortSignal) => {
      decisionSignal = signal
      return decision
    })
    const disconnect = connectKnowledgeCitationEvents(CITATION_ID, {
      onSourceChanged: vi.fn(),
      shouldReconnect,
    })
    try {
      await vi.waitFor(() => expect(shouldReconnect).toHaveBeenCalledOnce())

      setAccessToken(rotatedAToken, Date.now() + 60_000)
      expect(decisionSignal?.aborted).toBe(false)

      resolveDecision(true)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(authorizations).toEqual([
        `Bearer ${accountAToken}`,
        `Bearer ${rotatedAToken}`,
      ])
    } finally {
      disconnect()
    }
  })
})

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
