import { hostFetch } from "@/adapters/desktop/desktop-adapter"
import {
  buildApiUrl,
  isDefinitiveAuthenticationError,
  refreshSession,
  ApiError,
  prepareClientBuildRequest,
  validateResponseBuild,
} from "@/api/client"
import { parseSseFrame } from "@/api/sse"
import { waitForSseReconnectDelay } from "@/api/sse-reconnect-delay"
import {
  getAccessToken,
  getLoginSessionBoundary,
  isLoginSessionCurrent,
  setAccessToken,
  subscribeToLoginSession,
} from "@/api/session"
import {
  knowledgeBaseEventSchema,
  type KnowledgeBaseEvent,
} from "@/features/knowledge-bases/knowledge-base-contracts"

import { isKnowledgeUiDemoEnabled } from "./knowledge-ui-demo-mode"

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
  // UI samples have static processing states and never open a live SSE stream.
  if (import.meta.env.DEV && isKnowledgeUiDemoEnabled()) return () => undefined
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
      const headers = new Headers({ Accept: "text/event-stream" })
      const token = getAccessToken()
      if (token) headers.set("Authorization", `Bearer ${token}`)

      try {
        prepareClientBuildRequest(headers)
        let response = await hostFetch(
          buildApiUrl(`/knowledge-bases/${knowledgeBaseId}/events`),
          {
            headers,
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          }
        )

        // The response belongs to the login that sent the request. Checking
        // first also prevents a stale response from triggering the global
        // build/desktop-update side effects of validateResponseBuild.
        if (isAbandonedLogin()) {
          controller.abort()
          return
        }
        validateResponseBuild(response.headers)
        if (response.status === 401) {
          try {
            await refreshSession(token, loginSessionBoundary)
          } catch (error) {
            if (isAbandonedLogin()) {
              controller.abort()
              return
            }
            if (isDefinitiveAuthenticationError(error)) setAccessToken(null)
            throw error
          }
          if (isAbandonedLogin()) {
            controller.abort()
            return
          }
          const refreshedToken = getAccessToken()
          if (refreshedToken) {
            headers.set("Authorization", `Bearer ${refreshedToken}`)
          }
          response = await hostFetch(
            buildApiUrl(`/knowledge-bases/${knowledgeBaseId}/events`),
            {
              headers,
              credentials: "include",
              cache: "no-store",
              signal: controller.signal,
            }
          )
          if (isAbandonedLogin()) {
            controller.abort()
            return
          }
          validateResponseBuild(response.headers)
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
            throw new Error("KNOWLEDGE_SSE_FRAME_TOO_LARGE")
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
          handlers.shouldReconnect?.(controller.signal) ?? true
        ).catch(() => true)
        if (isAbandonedLogin()) {
          controller.abort()
          return
        }
        if (controller.signal.aborted || !shouldReconnect) return
        handlers.onConnectionChange?.("reconnecting")
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
