import {
  apiRequest,
  buildApiUrl,
  isDefinitiveAuthenticationError,
  refreshSession,
} from "@/api/client"
import {
  conversationEventHistoryPageSchema,
  sseEventSchema,
  type ConversationEvent,
  type ConversationEventHistoryPage,
} from "@/api/contracts"
import { getAccessToken, setAccessToken } from "@/api/session"
import { waitForSseReconnectDelay } from "@/api/sse-reconnect-delay"

export type ConversationEventHandlers = {
  /**
   * Return false only when delivery is intentionally deferred. The handler
   * must invoke commitCursor after it has actually consumed that event.
   */
  onEvent: (event: ConversationEvent, commitCursor?: () => void) => false | void
  onConnectionChange?: (state: "connected" | "reconnecting") => void
}

type ParsedSseFrame = {
  id?: string
  event?: string
  data?: string
  retry?: number
}

const MAX_SSE_FRAME_BUFFER_CHARACTERS = 4_000_000

export function fetchConversationEventHistory(
  conversationId: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}
): Promise<ConversationEventHistoryPage> {
  return apiRequest(`/conversations/${conversationId}/events/history`, {
    query: {
      cursor: options.cursor,
      limit: options.limit,
    },
    schema: conversationEventHistoryPageSchema,
    signal: options.signal,
  })
}

export function parseSseFrame(frame: string): ParsedSseFrame | null {
  const parsed: ParsedSseFrame = {}
  const data: string[] = []

  for (const rawLine of frame.split(/\r?\n/u)) {
    if (!rawLine || rawLine.startsWith(":")) continue
    const separator = rawLine.indexOf(":")
    const field = separator === -1 ? rawLine : rawLine.slice(0, separator)
    let value = separator === -1 ? "" : rawLine.slice(separator + 1)
    if (value.startsWith(" ")) value = value.slice(1)

    if (field === "data") data.push(value)
    if (field === "event") parsed.event = value
    if (field === "id" && !value.includes("\u0000")) parsed.id = value
    if (field === "retry" && /^\d+$/u.test(value)) parsed.retry = Number(value)
  }

  if (data.length) parsed.data = data.join("\n")
  return Object.keys(parsed).length ? parsed : null
}

function eventStorageKey(conversationId: string) {
  return `linksense.sse.${conversationId}.lastEventId`
}

function readLastEventId(conversationId: string) {
  try {
    return window.sessionStorage.getItem(eventStorageKey(conversationId)) ?? ""
  } catch {
    return ""
  }
}

function saveLastEventId(conversationId: string, id: string) {
  try {
    window.sessionStorage.setItem(eventStorageKey(conversationId), id)
  } catch {
    // A disabled storage backend must not break event delivery.
  }
}

export function connectConversationEvents(
  conversationId: string,
  handlers: ConversationEventHandlers,
  options?: { replayHistory?: boolean; initialEventId?: string }
) {
  const controller = new AbortController()
  let lastEventId = options?.replayHistory
    ? ""
    : (options?.initialEventId ?? readLastEventId(conversationId))
  if (lastEventId) saveLastEventId(conversationId, lastEventId)
  let reconnectDelay = 1_000

  const dispatch = (frame: ParsedSseFrame) => {
    if (!frame.data) return

    try {
      const payload: unknown = JSON.parse(frame.data)
      const parsed = sseEventSchema.safeParse(payload)
      if (!parsed.success) return
      if (frame.id !== undefined && frame.id !== parsed.data.id) return
      if (
        frame.event !== undefined &&
        frame.event !== "message" &&
        frame.event !== parsed.data.type
      ) {
        return
      }
      lastEventId = parsed.data.id
      let cursorCommitted = false
      const commitCursor = () => {
        if (cursorCommitted) return
        cursorCommitted = true
        saveLastEventId(conversationId, parsed.data.id)
      }
      if (handlers.onEvent(parsed.data, commitCursor) !== false) {
        commitCursor()
      }
    } catch {
      // Invalid SSE data is ignored at this untrusted network boundary.
    }
  }

  const connect = async () => {
    while (!controller.signal.aborted) {
      const headers = new Headers({ Accept: "text/event-stream" })
      const token = getAccessToken()
      if (token) headers.set("Authorization", `Bearer ${token}`)
      if (lastEventId) headers.set("Last-Event-ID", lastEventId)

      try {
        let response = await fetch(
          buildApiUrl(`/conversations/${conversationId}/events`, {
            last_event_id: lastEventId || undefined,
          }),
          {
            headers,
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          }
        )

        if (response.status === 401) {
          try {
            await refreshSession(token)
          } catch (error) {
            if (isDefinitiveAuthenticationError(error)) {
              setAccessToken(null)
            }
            throw error
          }
          const refreshedToken = getAccessToken()
          if (refreshedToken)
            headers.set("Authorization", `Bearer ${refreshedToken}`)
          response = await fetch(
            buildApiUrl(`/conversations/${conversationId}/events`, {
              last_event_id: lastEventId || undefined,
            }),
            {
              headers,
              credentials: "include",
              cache: "no-store",
              signal: controller.signal,
            }
          )
          if (response.status === 401) setAccessToken(null)
        }

        if (!response.ok || !response.body)
          throw new Error("SSE_CONNECTION_FAILED")
        handlers.onConnectionChange?.("connected")
        reconnectDelay = 1_000

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (!controller.signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })
          if (buffer.length > MAX_SSE_FRAME_BUFFER_CHARACTERS) {
            await reader.cancel()
            throw new Error("SSE_FRAME_TOO_LARGE")
          }
          const frames = buffer.split(/\r?\n\r?\n/u)
          buffer = frames.pop() ?? ""
          for (const rawFrame of frames) {
            const frame = parseSseFrame(rawFrame)
            if (!frame) continue
            if (frame.retry !== undefined) {
              reconnectDelay = Math.min(Math.max(frame.retry, 500), 30_000)
            }
            dispatch(frame)
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === "AbortError") return
      }

      if (!controller.signal.aborted) {
        handlers.onConnectionChange?.("reconnecting")
        await waitForSseReconnectDelay(reconnectDelay, controller.signal)
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000)
      }
    }
  }

  void connect()
  return () => controller.abort()
}
