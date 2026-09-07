import {
  buildApiUrl,
  isDefinitiveAuthenticationError,
  refreshSession,
} from "@/api/client"
import { parseSseFrame } from "@/api/sse"
import { waitForSseReconnectDelay } from "@/api/sse-reconnect-delay"
import { getAccessToken, setAccessToken } from "@/api/session"
import {
  knowledgeBaseEventSchema,
  type KnowledgeBaseEvent,
} from "@/features/knowledge-bases/knowledge-base-contracts"

export type KnowledgeBaseEventHandlers = {
  onEvent: (event: KnowledgeBaseEvent) => void
  onConnectionChange?: (state: "connected" | "reconnecting") => void
  /**
   * Runs after a stream closes or cannot be opened. Returning false marks the
   * closure as authoritative (for example, revoked/disabled/archived access)
   * and permanently stops this connector instead of starting another loop.
   */
  shouldReconnect?: (signal: AbortSignal) => boolean | Promise<boolean>
}

const MAX_SSE_BUFFER_CHARACTERS = 1_000_000

export function connectKnowledgeBaseEvents(
  knowledgeBaseId: string,
  handlers: KnowledgeBaseEventHandlers
) {
  const controller = new AbortController()
  let reconnectDelay = 1_000

  const connect = async () => {
    while (!controller.signal.aborted) {
      const headers = new Headers({ Accept: "text/event-stream" })
      const token = getAccessToken()
      if (token) headers.set("Authorization", `Bearer ${token}`)

      try {
        let response = await fetch(
          buildApiUrl(`/knowledge-bases/${knowledgeBaseId}/events`),
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
            if (isDefinitiveAuthenticationError(error)) setAccessToken(null)
            throw error
          }
          const refreshedToken = getAccessToken()
          if (refreshedToken) {
            headers.set("Authorization", `Bearer ${refreshedToken}`)
          }
          response = await fetch(
            buildApiUrl(`/knowledge-bases/${knowledgeBaseId}/events`),
            {
              headers,
              credentials: "include",
              cache: "no-store",
              signal: controller.signal,
            }
          )
          if (response.status === 401) setAccessToken(null)
        }

        if (!response.ok || !response.body) {
          throw new Error("KNOWLEDGE_SSE_CONNECTION_FAILED")
        }

        handlers.onConnectionChange?.("connected")
        reconnectDelay = 1_000
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (!controller.signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })
          if (buffer.length > MAX_SSE_BUFFER_CHARACTERS) {
            await reader.cancel()
            throw new Error("KNOWLEDGE_SSE_FRAME_TOO_LARGE")
          }
          const frames = buffer.split(/\r?\n\r?\n/u)
          buffer = frames.pop() ?? ""
          for (const rawFrame of frames) {
            const frame = parseSseFrame(rawFrame)
            if (!frame?.data) continue
            try {
              const payload: unknown = JSON.parse(frame.data)
              const event = knowledgeBaseEventSchema.safeParse(payload)
              if (!event.success) continue
              if (
                frame.event !== undefined &&
                frame.event !== "message" &&
                frame.event !== event.data.type
              ) {
                continue
              }
              if (event.data.knowledge_base_id !== knowledgeBaseId) continue
              handlers.onEvent(event.data)
            } catch {
              // Untrusted or partial event frames are ignored.
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === "AbortError") return
      }

      if (!controller.signal.aborted) {
        const shouldReconnect = await Promise.resolve(
          handlers.shouldReconnect?.(controller.signal) ?? true
        ).catch(() => true)
        if (controller.signal.aborted || !shouldReconnect) return
        handlers.onConnectionChange?.("reconnecting")
        await waitForSseReconnectDelay(reconnectDelay, controller.signal)
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000)
      }
    }
  }

  void connect()
  return () => controller.abort()
}
