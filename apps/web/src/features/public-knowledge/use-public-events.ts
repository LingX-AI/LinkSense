import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { connectConversationEvents } from "@/api/sse"
import { getNativeCodexPayload, type ConversationEvent } from "@/api/contracts"
import type { StreamingAssistantMessages } from "@/features/conversations/streaming-messages"
import {
  appendStreamingReasoningSummaryDelta,
  type StreamingReasoningSummaries,
} from "@/features/conversations/streaming-reasoning-summaries"
import { applyPublicMessageEvent } from "./event-messages"
import type { PublicKnowledgeClient } from "./api"
import type { z } from "zod"
import type { publicKnowledgeConversationDetailSchema } from "@linksense/shared"

type Detail = z.infer<typeof publicKnowledgeConversationDetailSchema>
type LiveView = {
  events: readonly ConversationEvent[]
  messages: StreamingAssistantMessages
  reasoning: StreamingReasoningSummaries
}
const emptyLiveView: LiveView = { events: [], messages: {}, reasoning: {} }

/** The ordinary SSE transport/rendering pipeline, with anonymous credentials. */
export function usePublicKnowledgeEvents(
  client: PublicKnowledgeClient,
  detail: Detail | undefined,
  onAuthenticationError: () => void
): LiveView {
  const queryClient = useQueryClient()
  const scope = detail?.conversation.id ?? ""
  const snapshot = useRef(detail)
  const onExpired = useRef(onAuthenticationError)
  const completedSnapshot = useRef({
    ids: new Set<string | null>(),
    sequence: 0,
  })
  const [view, setView] = useState<LiveView & { scope: string }>({
    ...emptyLiveView,
    scope: "",
  })
  useEffect(() => {
    snapshot.current = detail
    onExpired.current = onAuthenticationError
    completedSnapshot.current = {
      ids: new Set(
        detail?.events
          .filter((event) => event.event_type === "turn/completed")
          .map((event) => event.turn_id)
      ),
      sequence: detail?.events.at(-1)?.sequence_no ?? 0,
    }
  }, [detail, onAuthenticationError])
  useEffect(() => {
    if (!scope || !client.eventToken) return
    const events = new Map<string, ConversationEvent>()
    let messages: StreamingAssistantMessages = {},
      reasoning: StreamingReasoningSummaries = {},
      prunedAt = 0
    let frame: number | null = null
    const flush = () => {
      frame = null
      setView({ scope, events: [...events.values()], messages, reasoning })
    }
    const disconnect = connectConversationEvents(
      scope,
      {
        onEvent: (event) => {
          if (!event.id.startsWith(`${scope}:`)) return
          const { ids: completed, sequence: last } = completedSnapshot.current
          if (last > prunedAt) {
            for (const [id, previous] of events)
              if (
                completed.has(previous.turn_id) &&
                previous.sequence_no <= last
              )
                events.delete(id)
            messages = Object.fromEntries(
              Object.entries(messages).filter(
                ([, message]) =>
                  !message.turn_id ||
                  !completed.has(message.turn_id) ||
                  message.last_applied_sequence_no > last
              )
            )
            reasoning = Object.fromEntries(
              Object.entries(reasoning).filter(
                ([, summary]) =>
                  !summary.turnId ||
                  !completed.has(summary.turnId) ||
                  summary.sequence > last
              )
            )
            prunedAt = last
          }
          messages = applyPublicMessageEvent(messages, event)
          const native = getNativeCodexPayload(event)
          if (native?.method === "item/reasoning/summaryTextDelta")
            reasoning = appendStreamingReasoningSummaryDelta(reasoning, {
              itemId: native.params.itemId,
              turnId: event.turn_id,
              summaryIndex: native.params.summaryIndex,
              delta: native.params.delta,
              createdAt: event.created_at,
              sequence: event.sequence_no,
            })
          // Deltas are consumed once by the shared reducers; history holds the
          // authoritative completed items instead of replaying all text per frame.
          if (
            native?.method !== "item/agentMessage/delta" &&
            native?.method !== "item/reasoning/summaryTextDelta"
          )
            events.set(event.id, event)
          if (frame === null) frame = requestAnimationFrame(flush)
          if (
            [
              "conversation.step.started",
              "turn/started",
              "turn/completed",
              "conversation.completed",
              "conversation.interrupted",
              "conversation.error",
            ].includes(event.type)
          )
            void queryClient.invalidateQueries({
              queryKey: ["public-knowledge-visitor", client.publicId],
            })
        },
      },
      {
        initialEventId: snapshot.current?.event_cursor ?? `${scope}:0`,
        publicSession: {
          path: client.eventPath(scope),
          token: client.eventToken,
          onAuthenticationError: () => onExpired.current(),
        },
      }
    )
    return () => {
      disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [client, scope, queryClient])
  return view.scope === scope ? view : emptyLiveView
}
