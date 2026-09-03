import type { Conversation, ConversationMessage } from "@/api/contracts"

export function projectConversationForSharing(
  conversation: Conversation
): Conversation {
  const sourceMessages = conversation.messages ?? []
  const sourceTurns = conversation.turns ?? []
  const finalMessageIdByTurn = new Map<string | null, string>()
  const excludedAssistantMessageIds = new Set<string>()
  const assistantMessagesByTurn = new Map<
    string | null,
    ConversationMessage[]
  >()

  for (const message of sourceMessages) {
    if (message.role !== "assistant") continue
    const turnId = message.turn_id ?? null
    const messages = assistantMessagesByTurn.get(turnId) ?? []
    messages.push(message)
    assistantMessagesByTurn.set(turnId, messages)
    if (message.phase === "final_answer") {
      finalMessageIdByTurn.set(turnId, message.id)
    } else if (
      message.phase === "commentary" ||
      message.output_kind === "plan"
    ) {
      excludedAssistantMessageIds.add(message.id)
    }
  }

  const turnStatusById = new Map(
    sourceTurns.map((turn) => [turn.id, turn.status])
  )
  for (const [turnId, messages] of assistantMessagesByTurn) {
    if (finalMessageIdByTurn.has(turnId)) continue
    if (turnId && turnStatusById.get(turnId) === "running") continue
    const fallback = [...messages]
      .reverse()
      .find((message) => !excludedAssistantMessageIds.has(message.id))
    if (fallback) finalMessageIdByTurn.set(turnId, fallback.id)
  }

  const finalMessageIds = new Set(finalMessageIdByTurn.values())
  const sharedTurnIds = new Set<string>()
  const messages: ConversationMessage[] = []
  for (const message of sourceMessages) {
    if (message.role === "system") continue
    if (message.role !== "assistant") {
      messages.push({ ...message, created_at: undefined })
      continue
    }
    if (!finalMessageIds.has(message.id)) continue
    if (message.turn_id) sharedTurnIds.add(message.turn_id)
    messages.push({
      ...message,
      created_at: undefined,
      phase: "final_answer",
      output_kind: "agent_message",
    })
  }

  return {
    ...conversation,
    messages,
    turns: sourceTurns
      .filter((turn) => sharedTurnIds.has(turn.id))
      .map((turn) => ({
        ...turn,
        model: null,
        reasoning_effort: null,
      })),
    running_turn: null,
    activities: [],
    events: [],
    pending_requests: [],
    user_input_requests: [],
    plan_reviews: [],
    loaded_capabilities: [],
    priority_capabilities: [],
    used_capabilities: [],
  }
}
