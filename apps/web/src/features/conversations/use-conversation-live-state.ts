import { useCallback, useRef, useState, type SetStateAction } from "react"

import type { ConversationActivity, ConversationEvent } from "@/api/contracts"
import type { StreamingAssistantMessages } from "@/features/conversations/streaming-messages"
import type { StreamingReasoningSummaries } from "@/features/conversations/streaming-reasoning-summaries"

type ConversationLiveState = {
  streamedMessages: StreamingAssistantMessages
  reasoningSummaries: StreamingReasoningSummaries
  activities: ConversationActivity[]
  events: ConversationEvent[]
}

const emptyConversationLiveState: ConversationLiveState = {
  streamedMessages: {},
  reasoningSummaries: {},
  activities: [],
  events: [],
}

function resolveStateAction<State>(
  current: State,
  action: SetStateAction<State>
): State {
  return typeof action === "function"
    ? (action as (previous: State) => State)(current)
    : action
}

function cacheConversationLiveStateField<
  Field extends keyof ConversationLiveState,
>(
  cache: Map<string, ConversationLiveState>,
  conversationId: string,
  field: Field,
  value: ConversationLiveState[Field]
) {
  const next = {
    ...(cache.get(conversationId) ?? emptyConversationLiveState),
    [field]: value,
  }
  if (
    Object.keys(next.streamedMessages).length === 0 &&
    Object.keys(next.reasoningSummaries).length === 0 &&
    next.activities.length === 0 &&
    next.events.length === 0
  ) {
    cache.delete(conversationId)
    return
  }
  cache.set(conversationId, next)
}

export function useConversationLiveState(
  initialConversationId: string | undefined
) {
  const [streamedMessages, setStreamedMessagesState] =
    useState<StreamingAssistantMessages>({})
  const [reasoningSummaries, setReasoningSummariesState] =
    useState<StreamingReasoningSummaries>({})
  const [activities, setActivitiesState] = useState<ConversationActivity[]>([])
  const [events, setEventsState] = useState<ConversationEvent[]>([])
  const [conversationId, setConversationId] = useState(initialConversationId)
  const conversationIdRef = useRef(initialConversationId)
  const cacheRef = useRef(new Map<string, ConversationLiveState>())

  const setStreamedMessages = useCallback(
    (action: SetStateAction<StreamingAssistantMessages>) => {
      const scopedConversationId = conversationIdRef.current
      setStreamedMessagesState((current) => {
        const next = resolveStateAction(current, action)
        if (scopedConversationId) {
          cacheConversationLiveStateField(
            cacheRef.current,
            scopedConversationId,
            "streamedMessages",
            next
          )
        }
        return next
      })
    },
    []
  )
  const setReasoningSummaries = useCallback(
    (action: SetStateAction<StreamingReasoningSummaries>) => {
      const scopedConversationId = conversationIdRef.current
      setReasoningSummariesState((current) => {
        const next = resolveStateAction(current, action)
        if (scopedConversationId) {
          cacheConversationLiveStateField(
            cacheRef.current,
            scopedConversationId,
            "reasoningSummaries",
            next
          )
        }
        return next
      })
    },
    []
  )
  const setActivities = useCallback(
    (action: SetStateAction<ConversationActivity[]>) => {
      const scopedConversationId = conversationIdRef.current
      setActivitiesState((current) => {
        const next = resolveStateAction(current, action)
        if (scopedConversationId) {
          cacheConversationLiveStateField(
            cacheRef.current,
            scopedConversationId,
            "activities",
            next
          )
        }
        return next
      })
    },
    []
  )
  const setEvents = useCallback(
    (action: SetStateAction<ConversationEvent[]>) => {
      const scopedConversationId = conversationIdRef.current
      setEventsState((current) => {
        const next = resolveStateAction(current, action)
        if (scopedConversationId) {
          cacheConversationLiveStateField(
            cacheRef.current,
            scopedConversationId,
            "events",
            next
          )
        }
        return next
      })
    },
    []
  )

  const switchConversation = useCallback(
    (nextConversationId: string | undefined) => {
      if (conversationIdRef.current === nextConversationId) return
      const restoredState = nextConversationId
        ? cacheRef.current.get(nextConversationId)
        : undefined
      conversationIdRef.current = nextConversationId
      setConversationId(nextConversationId)
      setStreamedMessagesState(
        restoredState?.streamedMessages ??
          emptyConversationLiveState.streamedMessages
      )
      setReasoningSummariesState(
        restoredState?.reasoningSummaries ??
          emptyConversationLiveState.reasoningSummaries
      )
      setActivitiesState(
        restoredState?.activities ?? emptyConversationLiveState.activities
      )
      setEventsState(restoredState?.events ?? emptyConversationLiveState.events)
    },
    []
  )

  const promoteConversation = useCallback(
    (placeholderConversationId: string, promotedConversationId: string) => {
      if (conversationIdRef.current !== placeholderConversationId) return false
      const placeholderState = cacheRef.current.get(placeholderConversationId)
      if (placeholderState) {
        cacheRef.current.set(promotedConversationId, placeholderState)
        cacheRef.current.delete(placeholderConversationId)
      }
      conversationIdRef.current = promotedConversationId
      setConversationId(promotedConversationId)
      return true
    },
    []
  )

  const hasConversationLiveState = useCallback(
    (candidateConversationId: string | undefined) =>
      candidateConversationId
        ? cacheRef.current.has(candidateConversationId)
        : false,
    []
  )

  const clearConversationLiveState = useCallback(
    (targetConversationId: string | undefined) => {
      if (!targetConversationId) return
      cacheRef.current.delete(targetConversationId)
      if (conversationIdRef.current !== targetConversationId) return
      setStreamedMessagesState(emptyConversationLiveState.streamedMessages)
      setReasoningSummariesState(emptyConversationLiveState.reasoningSummaries)
      setActivitiesState(emptyConversationLiveState.activities)
      setEventsState(emptyConversationLiveState.events)
    },
    []
  )

  return {
    conversationId,
    conversationIdRef,
    streamedMessages,
    setStreamedMessages,
    reasoningSummaries,
    setReasoningSummaries,
    activities,
    setActivities,
    events,
    setEvents,
    switchConversation,
    promoteConversation,
    hasConversationLiveState,
    clearConversationLiveState,
  }
}
