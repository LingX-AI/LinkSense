import { apiEventStreamRequest, ApiError } from "@/api/client"
import { parseSseFrame } from "@/api/sse"
import { waitForSseReconnectDelay } from "@/api/sse-reconnect-delay"
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
  let reconnectDelay = 1_000

  const connect = async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await apiEventStreamRequest(
          `/knowledge-bases/${knowledgeBaseId}/events`,
          { signal: controller.signal }
        )

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
        if (
          error instanceof ApiError &&
          error.errorCode === "CLIENT_UPDATE_REQUIRED"
        ) {
          controller.abort()
          return
        }
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
