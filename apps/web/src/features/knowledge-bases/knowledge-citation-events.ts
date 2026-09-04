import { knowledgeCitationEventSchema } from "@linksense/shared"

import {
  buildApiUrl,
  isDefinitiveAuthenticationError,
  refreshSession,
} from "@/api/client"
import { parseSseFrame } from "@/api/sse"
import { waitForSseReconnectDelay } from "@/api/sse-reconnect-delay"
import { getAccessToken, setAccessToken } from "@/api/session"

type KnowledgeCitationEventHandlers = {
  onSourceChanged: (signal: AbortSignal) => void
  /** Returning false treats the closed stream as an authoritative stop. */
  shouldReconnect: (signal: AbortSignal) => boolean | Promise<boolean>
}

const MAX_SSE_BUFFER_CHARACTERS = 1_000_000

export function connectKnowledgeCitationEvents(
  citationId: string,
  handlers: KnowledgeCitationEventHandlers
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
          buildApiUrl(
            `/knowledge-citations/${encodeURIComponent(citationId)}/events`
          ),
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
            buildApiUrl(
              `/knowledge-citations/${encodeURIComponent(citationId)}/events`
            ),
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
          throw new Error("KNOWLEDGE_CITATION_SSE_CONNECTION_FAILED")
        }

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
            throw new Error("KNOWLEDGE_CITATION_SSE_FRAME_TOO_LARGE")
          }
          const frames = buffer.split(/\r?\n\r?\n/u)
          buffer = frames.pop() ?? ""
          for (const rawFrame of frames) {
            const frame = parseSseFrame(rawFrame)
            if (!frame?.data) continue
            try {
              const parsed = knowledgeCitationEventSchema.safeParse(
                JSON.parse(frame.data) as unknown
              )
              if (!parsed.success) continue
              if (
                frame.event !== undefined &&
                frame.event !== "message" &&
                frame.event !== parsed.data.type
              ) {
                continue
              }
              handlers.onSourceChanged(controller.signal)
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
          handlers.shouldReconnect(controller.signal)
        ).catch(() => true)
        if (controller.signal.aborted || !shouldReconnect) return
        await waitForSseReconnectDelay(reconnectDelay, controller.signal)
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000)
      }
    }
  }

  void connect()
  return () => controller.abort()
}
