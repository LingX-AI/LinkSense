import {
  conversationSchema,
  toConversationTimelineEvent,
  type Conversation,
  type ConversationEvent,
  type ConversationActivity,
} from "@/api/contracts"
import { publicKnowledgeConversationDetailSchema } from "@linksense/shared"
import dayjs from "dayjs"
import type { StreamingAssistantMessages } from "@/features/conversations/streaming-messages"
import { applyPublicMessageEvent } from "./event-messages"
import { z } from "zod"

/** Adapt public Q&A records for the existing chat UI without using private conversation APIs. */
export function projectPublicKnowledgeConversation(
  detail: z.infer<typeof publicKnowledgeConversationDetailSchema>,
  liveEvents: readonly ConversationEvent[] = [],
  liveMessages: StreamingAssistantMessages = {}
): Conversation {
  const publicTurns = detail.turns.map((turn) => ({
    ...turn,
    completed_at:
      turn.status !== "queued" &&
      turn.status !== "running" &&
      turn.duration_ms !== null
        ? dayjs(turn.created_at)
            .add(turn.duration_ms, "millisecond")
            .toISOString()
        : null,
  }))
  const turns = publicTurns
    .filter((turn) => turn.status !== "queued")
    .map((turn) => ({
      id: turn.id,
      status: turn.status,
      started_at: turn.created_at,
      completed_at: turn.completed_at,
      model: turn.model,
      error_code: turn.error_code,
    }))
  const latest = detail.turns.at(-1)
  const knownTurns = new Set(detail.turns.map((turn) => turn.id))
  const events = [
    ...new Map(
      [...detail.events.map(toConversationTimelineEvent), ...liveEvents]
        .filter(
          (event) =>
            event.id.startsWith(`${detail.conversation.id}:`) &&
            event.turn_id &&
            knownTurns.has(event.turn_id)
        )
        .map((event) => [event.id, event])
    ).values(),
  ].sort((a, b) => a.sequence_no - b.sequence_no)
  let streamed = liveMessages
  const activities: ConversationActivity[] = []
  for (const event of events) {
    if (
      event.type === "conversation.step.started" ||
      event.type === "conversation.step.completed"
    ) {
      const step = z
        .object({
          item_id: z.string(),
          action: z.enum(["knowledge_search", "knowledge_search_failed"]),
        })
        .safeParse(event.payload)
      if (step.success) {
        const status =
          step.data.action === "knowledge_search_failed"
            ? "failed"
            : event.type.endsWith("started")
              ? "running"
              : "completed"
        activities.push({
          id: event.id,
          turn_id: event.turn_id,
          item_id: step.data.item_id,
          type: "knowledge_search",
          status,
          created_at: event.created_at,
          sequence_no: event.sequence_no,
          message_key: `conversation.nativeActivities.${status === "running" ? "knowledgeSearchRunning" : status === "failed" ? "knowledgeSearchFailed" : "knowledgeSearchCompleted"}`,
        })
      }
    }
    streamed = applyPublicMessageEvent(streamed, event)
  }
  const messagesByTurn = new Map<
    string,
    Array<StreamingAssistantMessages[string]>
  >()
  for (const message of Object.values(streamed).sort(
    (a, b) => (a.event_sequence_no ?? 0) - (b.event_sequence_no ?? 0)
  ))
    if (message.turn_id) {
      const items = messagesByTurn.get(message.turn_id) ?? []
      items.push(message)
      messagesByTurn.set(message.turn_id, items)
    }
  return conversationSchema.parse({
    id: detail.conversation.id,
    title: detail.conversation.title,
    project_id: null,
    created_at: detail.conversation.created_at,
    updated_at: detail.conversation.updated_at,
    execution_status:
      latest?.status === "queued" ? "pending" : (latest?.status ?? "idle"),
    turns,
    running_turn: turns.find((turn) => turn.status === "running") ?? null,
    activities,
    events,
    messages: publicTurns.flatMap((turn) => {
      const nativeMessages = messagesByTurn.get(turn.id) ?? []
      const last =
        nativeMessages
          .filter((message) => message.phase === "final_answer")
          .at(-1) ??
        (turn.status !== "running"
          ? nativeMessages
              .filter((message) => message.phase !== "commentary")
              .at(-1)
          : undefined)
      const messages = nativeMessages.map((message) =>
        message === last && turn.status !== "running" && turn.output_text
          ? {
              ...message,
              content: turn.output_text,
              streaming: false,
              phase: "final_answer" as const,
            }
          : message
      )
      return [
        {
          id: `${turn.id}:question`,
          role: "user",
          content: turn.input_text,
          turn_id: turn.id,
          created_at: turn.created_at,
        },
        ...messages,
        ...(turn.output_text && !last
          ? [
              {
                id: `${turn.id}:answer`,
                role: "assistant",
                content: turn.output_text,
                turn_id: turn.id,
                created_at: turn.completed_at ?? turn.created_at,
                phase: "final_answer",
              },
            ]
          : []),
      ]
    }),
  })
}
