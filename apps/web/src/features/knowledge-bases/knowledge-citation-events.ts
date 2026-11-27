import { knowledgeCitationEventSchema } from "@linksense/shared"

import { apiEventStreamRequest, ApiError } from "@/api/client"
import { parseSseFrame } from "@/api/sse"
import { waitForSseReconnectDelay } from "@/api/sse-reconnect-delay"
import {
  getLoginSessionBoundary,
  isLoginSessionCurrent,
  subscribeToLoginSession,
} from "@/api/session"

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
  // Each connector belongs to the login that started it. A replacement login
  // must not inherit its refresh, reconnect decision, or token clear.
  const loginSessionBoundary = getLoginSessionBoundary()
  const isAbandonedLogin = () => !isLoginSessionCurrent(loginSessionBoundary)
  let reconnectDelay = 1_000
  let unsubscribeLoginSession: (() => void) | null = null
  const terminate = () => {
    unsubscribeLoginSession?.()
    unsubscribeLoginSession = null
    controller.abort()
  }
  unsubscribeLoginSession = subscribeToLoginSession(() => {
    if (isAbandonedLogin()) terminate()
  })

  const connect = async () => {
    while (!controller.signal.aborted) {
      try {
        // The shared request routine owns refresh, retry, build validation,
        // and login-session ownership for the authenticated stream.
        const response = await apiEventStreamRequest(
          `/knowledge-citations/${encodeURIComponent(citationId)}/events`,
          {
            signal: controller.signal,
            loginSessionBoundary,
          }
        )
        if (isAbandonedLogin()) {
          controller.abort()
          return
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
          // A chunk (or EOF) that arrives after the login was replaced must
          // not be handled or replayed for the new login.
          if (isAbandonedLogin()) {
            controller.abort()
            return
          }
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })
          if (buffer.length > MAX_SSE_BUFFER_CHARACTERS) {
            await reader.cancel()
            throw new Error("KNOWLEDGE_CITATION_SSE_FRAME_TOO_LARGE")
          }
          const frames = buffer.split(/\r?\n\r?\n/u)
          buffer = frames.pop() ?? ""
          for (const rawFrame of frames) {
            if (isAbandonedLogin()) {
              controller.abort()
              return
            }
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
        if (isAbandonedLogin()) {
          controller.abort()
          return
        }
        if (
          error instanceof ApiError &&
          ["CLIENT_UPDATE_REQUIRED", "DESKTOP_UPDATE_REQUIRED"].includes(error.errorCode)
        ) {
          controller.abort()
          return
        }
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === "AbortError") return
      }

      if (!controller.signal.aborted) {
        if (isAbandonedLogin()) {
          controller.abort()
          return
        }
        const shouldReconnect = await Promise.resolve(
          handlers.shouldReconnect(controller.signal)
        ).catch(() => true)
        if (isAbandonedLogin()) {
          controller.abort()
          return
        }
        if (controller.signal.aborted || !shouldReconnect) return
        await waitForSseReconnectDelay(reconnectDelay, controller.signal)
        if (isAbandonedLogin()) {
          controller.abort()
          return
        }
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000)
      }
    }
  }

  void connect().finally(terminate)
  return terminate
}
