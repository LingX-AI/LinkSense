import type {
  Conversation,
  ConversationActivity,
  ConversationEvent,
  ConversationMessage,
  ConversationTurn,
  NativeCodexItem,
  NativeSubAgentDetail,
} from "@/api/contracts"

type SubAgentConversationInput = {
  conversationId: string
  agentName: string
}

function epochMilliseconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null
  }
  return value < 10_000_000_000 ? value * 1_000 : value
}

function detailTurnStatus(
  status: NativeSubAgentDetail["status"]
): ConversationTurn["status"] {
  if (status === "pendingInit" || status === "running") return "running"
  if (status === "completed") return "completed"
  if (status === "interrupted" || status === "shutdown") return "interrupted"
  return "failed"
}

function itemRunning(item: NativeCodexItem) {
  return "status" in item && item.status === "inProgress"
}

function timelineWindow(
  detail: NativeSubAgentDetail,
  nowMs: number
): { startedAtMs: number; completedAtMs: number | null } {
  const durationMs = detail.turns.reduce(
    (total, turn) => total + (turn.durationMs ?? 0),
    0
  )
  const explicitStarts = detail.turns
    .map((turn) => epochMilliseconds(turn.startedAt))
    .filter((value): value is number => value !== null)
  const explicitCompletions = detail.turns
    .map((turn) => epochMilliseconds(turn.completedAt))
    .filter((value): value is number => value !== null)
  const explicitStart =
    explicitStarts.length > 0 ? Math.min(...explicitStarts) : null
  const explicitCompletion =
    explicitCompletions.length > 0 ? Math.max(...explicitCompletions) : null
  const running = detail.status === "pendingInit" || detail.status === "running"
  const completedAtMs = running
    ? null
    : (explicitCompletion ??
      (explicitStart !== null ? explicitStart + durationMs : nowMs))
  const fallbackEndMs = completedAtMs ?? nowMs
  let startedAtMs = explicitStart ?? fallbackEndMs - durationMs
  if (completedAtMs !== null && startedAtMs > completedAtMs) {
    startedAtMs = completedAtMs - durationMs
  }
  return { startedAtMs, completedAtMs }
}

function normalizedItem(
  item: NativeCodexItem,
  turnIndex: number,
  itemIndex: number
): NativeCodexItem {
  return {
    ...item,
    id: `subagent-item-${turnIndex + 1}-${itemIndex + 1}`,
  }
}

export function buildSubAgentConversation(
  detail: NativeSubAgentDetail,
  input: SubAgentConversationInput,
  nowMs = Date.now()
): Conversation {
  const syntheticTurnId = `subagent-${detail.agentKey}`
  const syntheticThreadId = `${syntheticTurnId}-thread`
  const status = detailTurnStatus(detail.status)
  const { startedAtMs, completedAtMs } = timelineWindow(detail, nowMs)
  const startedAt = new Date(startedAtMs).toISOString()
  const completedAt =
    completedAtMs === null ? null : new Date(completedAtMs).toISOString()
  const messages: ConversationMessage[] = []
  const events: ConversationEvent[] = []
  const activities: ConversationActivity[] = []
  const itemCount = detail.turns.reduce(
    (total, turn) => total + turn.items.length,
    0
  )
  let sequence = 0
  let visitedItems = 0

  const createdAtForSequence = () =>
    new Date(startedAtMs + Math.max(sequence - 1, 0)).toISOString()

  detail.turns.forEach((turn, turnIndex) => {
    turn.items.forEach((rawItem, itemIndex) => {
      sequence += 1
      visitedItems += 1
      const item = normalizedItem(rawItem, turnIndex, itemIndex)
      const createdAt = createdAtForSequence()
      const liveItem =
        status === "running" &&
        turn.status === "inProgress" &&
        visitedItems === itemCount

      if (item.type === "agentMessage" || item.type === "plan") {
        messages.push({
          id: `subagent-message-${turnIndex + 1}-${itemIndex + 1}`,
          role: "assistant",
          content: item.text,
          turn_id: syntheticTurnId,
          item_id: item.id,
          phase: item.type === "agentMessage" ? item.phase : "commentary",
          created_at: createdAt,
          event_sequence_no: sequence,
          streaming: liveItem,
        })
        return
      }

      const method =
        liveItem && itemRunning(item) ? "item/started" : "item/completed"
      events.push({
        id: `subagent-event-${turnIndex + 1}-${itemIndex + 1}`,
        type: method,
        turn_id: syntheticTurnId,
        sequence_no: sequence,
        created_at: createdAt,
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method,
          params: {
            threadId: syntheticThreadId,
            turnId: syntheticTurnId,
            item,
          },
        },
      })
    })

    const hasLaterTurn = turnIndex < detail.turns.length - 1
    if (
      hasLaterTurn &&
      (turn.status === "interrupted" || turn.status === "failed")
    ) {
      sequence += 1
      activities.push({
        id: `subagent-boundary-${turnIndex + 1}`,
        turn_id: syntheticTurnId,
        type: `subagent_${turn.status}`,
        message_key:
          turn.status === "interrupted"
            ? "conversation.subAgentActivities.continuedAfterInterruption"
            : "conversation.subAgentActivities.continuedAfterFailure",
        created_at: createdAtForSequence(),
        sequence_no: sequence,
      })
    }
  })

  const turn: ConversationTurn = {
    id: syntheticTurnId,
    status,
    collaboration_mode: "default",
    started_at: startedAt,
    completed_at: completedAt,
    interrupted_at: status === "interrupted" ? completedAt : null,
    error_code: status === "failed" ? "subagent_execution_failed" : null,
  }

  return {
    id: input.conversationId,
    title: input.agentName,
    archived: false,
    updated_at: completedAt ?? new Date(nowMs).toISOString(),
    execution_status: status,
    has_unread_completion: false,
    has_automation: false,
    collaboration_mode: "default",
    user_input_requests: [],
    messages,
    turns: [turn],
    running_turn: status === "running" ? turn : null,
    activities,
    events,
  }
}
