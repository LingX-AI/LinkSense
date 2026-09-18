import { useEffect, useEffectEvent, useState } from "react"

import {
  connectConversationEvents,
  type ConversationEventHandlers,
} from "@/api/sse"
import type { ConversationEvent } from "@/api/contracts"
import { isStreamOnlyNativeEvent } from "@/features/conversations/conversation-live-events"
import { recordFirstTextReceived } from "./response-latency"

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
  initialEventId?: string,
  onReplayEvent?: (event: ConversationEvent) => void
) {
  const [connectionState, setConnectionState] = useState<{
    conversationId: string | undefined
    state: "connected" | "reconnecting"
  }>({ conversationId, state: "connected" })
  const [warningConversationId, setWarningConversationId] = useState<
    string | null
  >(null)
  const dispatchEvent = useEffectEvent(onEvent)
  const dispatchReplayEvent = useEffectEvent((event: ConversationEvent) =>
    onReplayEvent?.(event)
  )
  const replayFromStart = Boolean(onReplayEvent)
  const readInitialEventId = useEffectEvent(() => initialEventId)
  const readActiveConversationId = useEffectEvent(() => conversationId)

  useEffect(() => {
    if (!conversationId) return
    let active = true
    let connectionGeneration = 0
    let disconnect: (() => void) | null = null
    const initialCursor = readInitialEventId() ?? ""
    const snapshotSequence = initialCursor.startsWith(`${conversationId}:`)
      ? Number(initialCursor.slice(conversationId.length + 1))
      : -1
    let resumeCursor = replayFromStart ? "" : initialCursor
    let reconnecting = false
    let warningTimer: number | null = null
    let streamFrame: number | null = null
    let streamFallbackTimer: number | null = null
    let pendingStreamEvents: Array<{
      event: ConversationEvent
      commitCursor?: () => void
    }> = []
    const isActiveConversation = () =>
      active && readActiveConversationId() === conversationId
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
    const commitEvent = (
      event: ConversationEvent,
      commitCursor?: () => void
    ) => {
      commitCursor?.()
      resumeCursor = event.id
    }
    const flushStreamEvents = () => {
      if (!isActiveConversation()) {
        pendingStreamEvents = []
        cancelStreamFlush()
        return
      }
      if (pendingStreamEvents.length === 0) {
        cancelStreamFlush()
        return
      }
      const pendingEvents = pendingStreamEvents
      pendingStreamEvents = []
      cancelStreamFlush()
      for (const { event, commitCursor } of pendingEvents) {
        dispatchEvent(event)
        commitEvent(event, commitCursor)
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
      if (!isActiveConversation()) return false
      if (replayFromStart) {
        dispatchReplayEvent(event)
        // The app needs historical business events. Chat already has its
        // detail snapshot and must not reapply older execution transitions.
        if (event.sequence_no <= snapshotSequence) {
          commitEvent(event, commitCursor)
          return false
        }
      }
      recordFirstTextReceived(conversationId, event)
      if (shouldBufferUntilAnimationFrame(event)) {
        pendingStreamEvents.push({ event, commitCursor })
        scheduleStreamFlush()
        return false
      }
      // Lifecycle events must observe every earlier token before applying
      // completion or error state, without an intermediate React commit.
      flushStreamEvents()
      dispatchEvent(event)
      commitEvent(event, commitCursor)
      return false
    }
    const handleConnectionChange: NonNullable<
      ConversationEventHandlers["onConnectionChange"]
    > = (nextState) => {
      if (!isActiveConversation()) return
      if (nextState === "reconnecting") flushStreamEvents()
      setConnectionState((current) =>
        current.conversationId === conversationId && current.state === nextState
          ? current
          : { conversationId, state: nextState }
      )
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
        if (!isActiveConversation()) return
        setWarningConversationId(conversationId)
      }, conversationReconnectingWarningDelayMs)
    }
    const connect = () => {
      if (disconnect || document.visibilityState === "hidden") return
      const generation = ++connectionGeneration
      disconnect = connectConversationEvents(
        conversationId,
        {
          onEvent: (event, commitCursor) =>
            generation === connectionGeneration
              ? handleEvent(event, commitCursor)
              : false,
          onConnectionChange: (state) => {
            if (generation === connectionGeneration)
              handleConnectionChange(state)
          },
        },
        { initialEventId: resumeCursor }
      )
    }
    const releaseConnection = () => {
      connectionGeneration += 1
      disconnect?.()
      disconnect = null
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") {
        connect()
        return
      }
      // HTTP/1.1 sockets are shared across tabs. Hidden pages must release
      // their streams so ordinary API and preview requests can still run.
      try {
        flushStreamEvents()
      } finally {
        releaseConnection()
        handleConnectionChange("connected")
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    connect()
    return () => {
      active = false
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      clearWarningTimer()
      cancelStreamFlush()
      pendingStreamEvents = []
      releaseConnection()
    }
  }, [conversationId, replayFromStart])

  return {
    connectionState:
      connectionState.conversationId === conversationId
        ? connectionState.state
        : "connected",
    reconnectingWarningVisible: warningConversationId === conversationId,
  }
}
