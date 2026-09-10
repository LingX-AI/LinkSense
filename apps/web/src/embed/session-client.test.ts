import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { EmbedSessionClient } from "./session-client"

const BASE_TIME = new Date("2026-08-13T00:00:00.000Z")
const ORIGIN = "https://partner.example.test"
const SESSION_ID = "50000000-0000-4000-8000-000000000001"
const CONVERSATION_ID = "40000000-0000-4000-8000-000000000001"
const SECOND_CONVERSATION_ID = "40000000-0000-4000-8000-000000000002"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("EmbedSessionClient", () => {
  it.each(["public", "required"] as const)(
    "reports maintenance without reauthenticating or replaying a %s session request",
    async (mode) => {
      vi.useFakeTimers()
      vi.setSystemTime(BASE_TIME)
      let maintenance = false
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path.endsWith("/sessions/exchange"))
          return successEnvelope(tokenPair("initial", BASE_TIME))
        if (path.endsWith("/public-sessions"))
          return successEnvelope({
            session_id: SESSION_ID,
            session_expires_at: "2026-08-14T00:00:00.000Z",
          })
        if (maintenance)
          return Response.json(
            { success: false, error_code: "SYSTEM_MAINTENANCE_ACTIVE" },
            { status: 503 }
          )
        return successEnvelope({ accepted: true })
      })
      vi.stubGlobal("fetch", fetchMock)
      const onMaintenance = vi.fn()
      const onAuthenticationRequired = vi.fn()
      const client = new EmbedSessionClient(ORIGIN, {
        onMaintenance,
        onAuthenticationRequired,
        onConnectionStateChange: vi.fn(),
      })
      if (mode === "public")
        await client.startPublicSession("lsa_application_identifier_1234")
      else await client.acceptTicket(`lst_${"t".repeat(64)}`)
      maintenance = true
      const count = fetchMock.mock.calls.length
      await expect(
        client.request("/api/v1/embed/session/turns", z.unknown(), {
          method: "POST",
        })
      ).rejects.toMatchObject({
        status: 503,
        code: "SYSTEM_MAINTENANCE_ACTIVE",
      })
      expect(onMaintenance).toHaveBeenCalledTimes(1)
      expect(onAuthenticationRequired).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(count + 1)
      expect(client.authenticated).toBe(true)
      maintenance = false
      await expect(
        client.request("/api/v1/embed/session", z.unknown())
      ).resolves.toEqual({ accepted: true })
      client.destroy()
    }
  )

  it("reports maintenance during initial authentication without asking the host to authenticate again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { success: false, error_code: "SYSTEM_MAINTENANCE_ACTIVE" },
          { status: 503 }
        )
      )
    )
    const onMaintenance = vi.fn()
    const onAuthenticationRequired = vi.fn()
    const client = new EmbedSessionClient(ORIGIN, {
      onMaintenance,
      onAuthenticationRequired,
      onConnectionStateChange: vi.fn(),
    })
    await expect(
      client.acceptTicket(`lst_${"t".repeat(64)}`)
    ).rejects.toMatchObject({ code: "SYSTEM_MAINTENANCE_ACTIVE" })
    await expect(
      client.startPublicSession("lsa_application_identifier_1234")
    ).rejects.toMatchObject({ code: "SYSTEM_MAINTENANCE_ACTIVE" })
    expect(onMaintenance).toHaveBeenCalledTimes(2)
    expect(onAuthenticationRequired).not.toHaveBeenCalled()
    client.destroy()
  })

  it("binds the business session id through the authenticated embed session without persisting it", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE_TIME)
    const requests: Array<{ headers: Headers; body: unknown }> = []
    const localStorageWrite = vi.spyOn(Storage.prototype, "setItem")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/sessions/exchange")) {
          return successEnvelope(tokenPair("initial", BASE_TIME))
        }
        if (path.endsWith("/session/external-application-session")) {
          requests.push({
            headers: new Headers(init?.headers),
            body: JSON.parse(String(init?.body)),
          })
          return new Response(null, { status: 204 })
        }
        throw new Error(`Unexpected request: ${path}`)
      })
    )
    const client = new EmbedSessionClient(ORIGIN, {
      onAuthenticationRequired: vi.fn(),
      onConnectionStateChange: vi.fn(),
    })

    await client.acceptTicket(`lst_${"t".repeat(64)}`)
    await client.updateExternalApplicationSession("business-session-a")

    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.get("authorization")).toBe(
      `Bearer jwt_initial_${"a".repeat(64)}`
    )
    expect(requests[0]?.body).toEqual({
      external_application_session_id: "business-session-a",
    })
    expect(localStorageWrite).not.toHaveBeenCalled()
    client.destroy()
  })

  it("keeps tokens in memory and retries a rotation with the same renewal request id", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE_TIME)
    const localStorageWrite = vi.spyOn(Storage.prototype, "setItem")
    const connectionStates: string[] = []
    const renewalBodies: Array<{
      renewal_token: string
      renewal_request_id: string
      origin: string
    }> = []
    let renewalAttempts = 0
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/sessions/exchange")) {
          return successEnvelope(tokenPair("initial", BASE_TIME))
        }
        if (path.endsWith("/sessions/renew")) {
          renewalAttempts += 1
          renewalBodies.push(JSON.parse(String(init?.body)))
          if (renewalAttempts === 1) throw new TypeError("network unavailable")
          return successEnvelope(
            tokenPair(
              "rotated",
              new Date(BASE_TIME.getTime() + 2 * 60 * 60_000)
            )
          )
        }
        throw new Error(`Unexpected request: ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("crypto", {
      ...crypto,
      randomUUID: vi.fn(() => "80000000-0000-4000-8000-000000000001"),
    })
    const client = new EmbedSessionClient(ORIGIN, {
      onAuthenticationRequired: vi.fn(),
      onConnectionStateChange: (state) => connectionStates.push(state),
    })

    await client.acceptTicket(`lst_${"t".repeat(64)}`)
    expect(client.authenticated).toBe(true)
    expect(client.sessionId).toBe(SESSION_ID)
    expect(localStorageWrite).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(118 * 60 * 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(renewalAttempts).toBe(2))

    expect(renewalBodies).toHaveLength(2)
    expect(renewalBodies[0]).toEqual(renewalBodies[1])
    expect(renewalBodies[0]).toEqual({
      renewal_token: `lsr_initial_${"r".repeat(48)}`,
      renewal_request_id: "80000000-0000-4000-8000-000000000001",
      origin: ORIGIN,
    })
    expect(connectionStates).toEqual(["retrying", "connected"])
    expect(localStorageWrite).not.toHaveBeenCalled()
    client.destroy()
  })

  it("requests authentication again when renewal credentials are rejected", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE_TIME)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path.endsWith("/sessions/exchange")) {
          return successEnvelope(tokenPair("initial", BASE_TIME))
        }
        if (path.endsWith("/sessions/renew")) {
          return new Response(
            JSON.stringify({
              success: false,
              error: {
                code: "APPLICATION_EMBED_SESSION_EXPIRED",
                message: "expired",
              },
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            }
          )
        }
        throw new Error(`Unexpected request: ${path}`)
      })
    )
    const onAuthenticationRequired = vi.fn()
    const client = new EmbedSessionClient(ORIGIN, {
      onAuthenticationRequired,
      onConnectionStateChange: vi.fn(),
    })

    await client.acceptTicket(`lst_${"t".repeat(64)}`)
    await vi.advanceTimersByTimeAsync(118 * 60 * 1_000)
    await vi.waitFor(() =>
      expect(onAuthenticationRequired).toHaveBeenCalledOnce()
    )

    expect(client.authenticated).toBe(false)
    client.destroy()
  })

  it("starts a direct public session without storing or exchanging ticket tokens", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE_TIME)
    const publicSessionBodies: Array<Record<string, unknown>> = []
    const sessionRequestHeaders: Headers[] = []
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/public-sessions")) {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          publicSessionBodies.push(body)
          return successEnvelope({
            session_id: SESSION_ID,
            session_expires_at: new Date(
              BASE_TIME.getTime() + 7 * 24 * 60 * 60_000
            ).toISOString(),
          })
        }
        if (path.endsWith("/api/v1/embed/session")) {
          sessionRequestHeaders.push(new Headers(init?.headers))
          return successEnvelope({ ok: true })
        }
        throw new Error(`Unexpected request: ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = new EmbedSessionClient(ORIGIN, {
      onAuthenticationRequired: vi.fn(),
      onConnectionStateChange: vi.fn(),
    })

    await client.startPublicSession("lsa_application_identifier")
    await client.request("/api/v1/embed/session", z.unknown())

    expect(publicSessionBodies).toEqual([
      { app_id: "lsa_application_identifier", origin: ORIGIN },
    ])
    expect(client.authenticated).toBe(true)
    expect(sessionRequestHeaders[0]?.get("authorization")).toBeNull()
    expect(sessionRequestHeaders[0]?.get("x-linksense-embed-app-id")).toBe(
      "lsa_application_identifier"
    )
    expect(sessionRequestHeaders[0]?.get("x-linksense-embed-session-id")).toBe(
      SESSION_ID
    )
    expect(sessionRequestHeaders[0]?.get("x-linksense-embed-origin")).toBe(
      ORIGIN
    )
    client.destroy()
  })

  it("streams public-session voice requests with the embedded session headers", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE_TIME)
    const voiceRequestHeaders: Headers[] = []
    const voiceRequestBodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/public-sessions")) {
          return successEnvelope({
            session_id: SESSION_ID,
            session_expires_at: new Date(
              BASE_TIME.getTime() + 7 * 24 * 60 * 60_000
            ).toISOString(),
          })
        }
        if (path.endsWith("/session/voice/transcriptions")) {
          voiceRequestHeaders.push(new Headers(init?.headers))
          voiceRequestBodies.push(JSON.parse(String(init?.body)))
          return new Response(
            `${JSON.stringify({ type: "done", text: "嵌入识别" })}\n`,
            {
              status: 200,
              headers: { "content-type": "application/x-ndjson" },
            }
          )
        }
        throw new Error(`Unexpected request: ${path}`)
      })
    )
    const client = new EmbedSessionClient(ORIGIN, {
      onAuthenticationRequired: vi.fn(),
      onConnectionStateChange: vi.fn(),
    })

    await client.startPublicSession("lsa_application_identifier")
    const response = await client.requestStream(
      "/api/v1/embed/session/voice/transcriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          audio_data_url: "data:audio/webm;base64,UklGRg==",
          stream: true,
        }),
      }
    )

    expect(response.status).toBe(200)
    expect(voiceRequestHeaders[0]?.get("authorization")).toBeNull()
    expect(voiceRequestHeaders[0]?.get("x-linksense-embed-session-id")).toBe(
      SESSION_ID
    )
    expect(voiceRequestHeaders[0]?.get("x-linksense-embed-app-id")).toBe(
      "lsa_application_identifier"
    )
    expect(voiceRequestBodies).toEqual([
      {
        audio_data_url: "data:audio/webm;base64,UklGRg==",
        stream: true,
      },
    ])
    client.destroy()
  })

  it("preserves the stable embedded voice rate-limit error", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE_TIME)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path.endsWith("/public-sessions")) {
          return successEnvelope({
            session_id: SESSION_ID,
            session_expires_at: new Date(
              BASE_TIME.getTime() + 7 * 24 * 60 * 60_000
            ).toISOString(),
          })
        }
        if (path.endsWith("/session/voice/transcriptions")) {
          return Response.json(
            {
              success: false,
              error_code: "VOICE_TRANSCRIPTION_RATE_LIMITED",
              message: "语音输入每分钟最多使用 20 次，请稍后再试。",
            },
            { status: 429 }
          )
        }
        throw new Error(`Unexpected request: ${path}`)
      })
    )
    const client = new EmbedSessionClient(ORIGIN, {
      onAuthenticationRequired: vi.fn(),
      onConnectionStateChange: vi.fn(),
    })

    await client.startPublicSession("lsa_application_identifier")

    await expect(
      client.requestStream("/api/v1/embed/session/voice/transcriptions", {
        method: "POST",
      })
    ).rejects.toMatchObject({
      status: 429,
      code: "VOICE_TRANSCRIPTION_RATE_LIMITED",
    })
    expect(client.authenticated).toBe(true)
    client.destroy()
  })

  it("applies refreshed authenticated tokens after switching conversations", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE_TIME)
    const switchRequestHeaders: Headers[] = []
    const sessionRequestHeaders: Headers[] = []
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/sessions/exchange")) {
          return successEnvelope(tokenPair("initial", BASE_TIME))
        }
        if (
          path.endsWith(
            `/session/conversations/${SECOND_CONVERSATION_ID}/select`
          )
        ) {
          switchRequestHeaders.push(new Headers(init?.headers))
          return successEnvelope({
            ...tokenPair("selected", BASE_TIME),
            conversation_id: SECOND_CONVERSATION_ID,
          })
        }
        if (path.endsWith("/api/v1/embed/session")) {
          sessionRequestHeaders.push(new Headers(init?.headers))
          return successEnvelope({ ok: true })
        }
        throw new Error(`Unexpected request: ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = new EmbedSessionClient(ORIGIN, {
      onAuthenticationRequired: vi.fn(),
      onConnectionStateChange: vi.fn(),
    })

    await client.acceptTicket(`lst_${"t".repeat(64)}`)
    await client.changeConversation(
      `/api/v1/embed/session/conversations/${SECOND_CONVERSATION_ID}/select`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }
    )
    await client.request("/api/v1/embed/session", z.unknown())

    expect(switchRequestHeaders[0]?.get("authorization")).toBe(
      `Bearer jwt_initial_${"a".repeat(64)}`
    )
    expect(sessionRequestHeaders[0]?.get("authorization")).toBe(
      `Bearer jwt_selected_${"a".repeat(64)}`
    )
    expect(sessionRequestHeaders[0]?.get("x-linksense-embed-session-id")).toBe(
      null
    )
    client.destroy()
  })

  it("streams public embed session events with session headers and resume cursor", async () => {
    const eventHeaders: Headers[] = []
    const streamedEvent = {
      id: "60000000-0000-4000-8000-000000000001",
      conversation_id: CONVERSATION_ID,
      turn_id: "60000000-0000-4000-8000-000000000002",
      sequence_no: 1,
      visibility: "user_visible",
      sse_event_id: `${CONVERSATION_ID}:1`,
      event_type: "conversation.message.delta",
      created_at: "2026-08-13T00:00:00.000Z",
      payload: {
        schema_version: 1,
        message_id: "60000000-0000-4000-8000-000000000003",
        role: "assistant",
        delta: "你好",
      },
    }
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path.endsWith("/public-sessions")) {
          return successEnvelope({
            session_id: SESSION_ID,
            session_expires_at: new Date(
              BASE_TIME.getTime() + 7 * 24 * 60 * 60_000
            ).toISOString(),
          })
        }
        if (path.endsWith("/api/v1/embed/session/events")) {
          eventHeaders.push(new Headers(init?.headers))
          const payload = [
            `id: ${streamedEvent.sse_event_id}`,
            `event: ${streamedEvent.event_type}`,
            `data: ${JSON.stringify(streamedEvent)}`,
            "",
            "",
          ].join("\n")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(payload))
                controller.close()
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } }
          )
        }
        throw new Error(`Unexpected request: ${path}`)
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const onEvent = vi.fn()
    const client = new EmbedSessionClient(ORIGIN, {
      onAuthenticationRequired: vi.fn(),
      onConnectionStateChange: vi.fn(),
    })

    await client.startPublicSession("lsa_application_identifier")
    const disconnect = client.connectEvents(
      "/api/v1/embed/session/events",
      { onEvent },
      { initialEventId: `${CONVERSATION_ID}:0` }
    )
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())
    disconnect()

    expect(eventHeaders[0]?.get("last-event-id")).toBe(`${CONVERSATION_ID}:0`)
    expect(eventHeaders[0]?.get("x-linksense-embed-app-id")).toBe(
      "lsa_application_identifier"
    )
    expect(eventHeaders[0]?.get("x-linksense-embed-session-id")).toBe(
      SESSION_ID
    )
    expect(eventHeaders[0]?.get("x-linksense-embed-origin")).toBe(ORIGIN)
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `${CONVERSATION_ID}:1`,
        type: "conversation.message.delta",
        turn_id: "60000000-0000-4000-8000-000000000002",
        sequence_no: 1,
      })
    )
    client.destroy()
  })
})

function tokenPair(label: string, issuedAt: Date) {
  return {
    access_token: `jwt_${label}_${"a".repeat(64)}`,
    renewal_token: `lsr_${label}_${"r".repeat(48)}`,
    access_token_expires_at: new Date(
      issuedAt.getTime() + 2 * 60 * 60_000
    ).toISOString(),
    renewal_token_expires_at: new Date(
      issuedAt.getTime() + 8 * 60 * 60_000
    ).toISOString(),
    session_expires_at: new Date(
      BASE_TIME.getTime() + 7 * 24 * 60 * 60_000
    ).toISOString(),
    session_id: SESSION_ID,
  }
}

function successEnvelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
