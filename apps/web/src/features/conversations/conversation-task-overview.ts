import {
  getNativeCodexPayload,
  type ConversationEvent,
  type ConversationFile,
  type NativeSubAgentSummary,
} from "@/api/contracts"
import {
  buildNativeSubAgentRosterViewModels,
  type NativeSubAgentActivityEntry,
  type NativeSubAgentViewModel,
} from "@/features/conversations/native-subagent-activity"

export type ConversationTaskOverviewSubAgent = Pick<
  NativeSubAgentViewModel,
  "id" | "ordinal" | "label" | "status"
>

export type ConversationTaskOverview = {
  subAgents: ConversationTaskOverviewSubAgent[]
  subAgentCount: number
  subAgentCompletedCount: number
  outputFiles: ConversationFile[]
}

function toNativeSubAgentActivityEntry(
  event: ConversationEvent
): NativeSubAgentActivityEntry | null {
  const payload = getNativeCodexPayload(event)
  if (
    !payload ||
    (payload.method !== "item/started" && payload.method !== "item/completed")
  ) {
    return null
  }

  const { item } = payload.params
  if (item.type !== "collabAgentToolCall" && item.type !== "subAgentActivity") {
    return null
  }

  return {
    item,
    method: payload.method,
  }
}

/**
 * Derives the task overview entirely from the same Codex lifecycle events and
 * conversation file records already shown in the conversation timeline.
 */
export function buildConversationTaskOverview({
  events,
  files,
  summaries = [],
}: {
  events: readonly ConversationEvent[]
  files: readonly ConversationFile[]
  summaries?: readonly NativeSubAgentSummary[]
}): ConversationTaskOverview {
  const activities = events.flatMap((event) => {
    const activity = toNativeSubAgentActivityEntry(event)
    return activity ? [activity] : []
  })
  const subAgents = buildNativeSubAgentRosterViewModels(activities, {
    summaries,
  }).sort((agentA, agentB) => agentA.ordinal - agentB.ordinal)
  const subAgentCount = subAgents.length
  const subAgentCompletedCount = subAgents.filter(
    (agent) => agent.status === "completed"
  ).length

  const outputFiles = [
    ...new Map(
      files
        .filter((file) => file.kind === "artifact")
        .map((file) => [file.id, file])
    ).values(),
  ]

  return { subAgents, subAgentCount, subAgentCompletedCount, outputFiles }
}
