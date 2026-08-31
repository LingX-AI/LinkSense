import { useEffect, useEffectEvent, useState } from "react"

import {
  connectConversationEvents,
  type ConversationEventHandlers,
} from "@/api/sse"
import type { ConversationEvent } from "@/api/contracts"
import { isStreamOnlyNativeEvent } from "@/features/conversations/conversation-live-events"

export const conversationReconnectingWarningDelayMs = 3_000
export const conversationStreamFrameFallbackDelayMs = 50

function shouldBufferUntilAnimationFrame(event: ConversationEvent) {
  return (
    event.type === "conversation.message.delta" ||
    isStreamOnlyNativeEvent(event)
  )
}

export function useConversationEvents(
  conversationId: string | undefined,
  onEvent: ConversationEventHandlers["onEvent"],
  initialEventId?: string
) {
  const [connectionState, setConnectionState] = useState<
    "connected" | "reconnecting"
  >("connected")
  const [warningConversationId, setWarningConversationId] = useState<
    string | null
  >(null)
  const dispatchEvent = useEffectEvent(onEvent)
  const readInitialEventId = useEffectEvent(() => initialEventId)

  useEffect(() => {
    if (!conversationId) return
    let reconnecting = false
    let warningTimer: number | null = null
    let streamFrame: number | null = null
    let streamFallbackTimer: number | null = null
    let pendingStreamEvents: Array<{
      event: ConversationEvent
      commitCursor?: () => void
    }> = []
    const clearWarningTimer = () => {
      if (warningTimer === null) return
      window.clearTimeout(warningTimer)
      warningTimer = null
    }
    const cancelStreamFlush = () => {
      if (streamFrame !== null) {
        window.cancelAnimationFrame(streamFrame)
        streamFrame = null
      }
      if (streamFallbackTimer !== null) {
        window.clearTimeout(streamFallbackTimer)
        streamFallbackTimer = null
      }
    }
    const flushStreamEvents = () => {
      if (pendingStreamEvents.length === 0) {
        cancelStreamFlush()
        return
      }
      const pendingEvents = pendingStreamEvents
      pendingStreamEvents = []
      cancelStreamFlush()
      for (const { event, commitCursor } of pendingEvents) {
        dispatchEvent(event)
        commitCursor?.()
      }
    }
    const scheduleStreamFlush = () => {
      if (streamFrame === null) {
        streamFrame = window.requestAnimationFrame(flushStreamEvents)
      }
      if (streamFallbackTimer === null) {
        streamFallbackTimer = window.setTimeout(
          flushStreamEvents,
          conversationStreamFrameFallbackDelayMs
        )
      }
    }
    const handleEvent: ConversationEventHandlers["onEvent"] = (
      event,
      commitCursor
    ) => {
      if (shouldBufferUntilAnimationFrame(event)) {
        pendingStreamEvents.push({ event, commitCursor })
        scheduleStreamFlush()
        return false
      }
      // Lifecycle events must observe every earlier token before applying
      // completion or error state, without an intermediate React commit.
      flushStreamEvents()
      dispatchEvent(event)
    }
    const handleConnectionChange: NonNullable<
      ConversationEventHandlers["onConnectionChange"]
    > = (nextState) => {
      if (nextState === "reconnecting") flushStreamEvents()
      setConnectionState(nextState)
      if (nextState === "connected") {
        reconnecting = false
        clearWarningTimer()
        setWarningConversationId((current) =>
          current === conversationId ? null : current
        )
        return
      }
      if (reconnecting) return
      reconnecting = true
      setWarningConversationId((current) =>
        current === conversationId ? null : current
      )
      warningTimer = window.setTimeout(() => {
        warningTimer = null
        setWarningConversationId(conversationId)
      }, conversationReconnectingWarningDelayMs)
    }
    const disconnect = connectConversationEvents(
      conversationId,
      {
        onEvent: handleEvent,
        onConnectionChange: handleConnectionChange,
      },
      // The detail snapshot owns the replay boundary. An empty boundary must
      // replay from the beginning instead of resuming a discarded UI cursor.
      { initialEventId: readInitialEventId() ?? "" }
    )
    return () => {
      clearWarningTimer()
      cancelStreamFlush()
      pendingStreamEvents = []
      disconnect()
    }
  }, [conversationId])

  return {
    connectionState,
    reconnectingWarningVisible: warningConversationId === conversationId,
  }
}
