import type { NativeCodexItem, NativeSubAgentSummary } from "@/api/contracts"

export const nativeSubAgentStates = [
  "pendingInit",
  "running",
  "interrupted",
  "completed",
  "errored",
  "shutdown",
  "notFound",
] as const

export type NativeSubAgentState = (typeof nativeSubAgentStates)[number]

export type NativeSubAgentDisplayStatus =
  NativeSubAgentState | "started" | "updated"

type NativeCollabAgentToolCallItem = Extract<
  NativeCodexItem,
  { type: "collabAgentToolCall" }
> & {
  agents?: Array<{
    agentKey: string
    agentLabel?: string
    status: NativeSubAgentState | null
  }>
}

type NativeSubAgentActivityItem = Extract<
  NativeCodexItem,
  { type: "subAgentActivity" }
> & {
  agentKey?: string
  /** Optional, explicitly safe display label projected by the runner. */
  agentLabel?: string
}

export type NativeSubAgentActivityEntry = {
  item: NativeCodexItem
  method: "item/started" | "item/completed"
}

export type NativeSubAgentViewModel = {
  id: string
  ordinal: number
  label: string | null
  status: NativeSubAgentDisplayStatus
}

export type NativeSubAgentActivityViewModel = {
  itemId: string
  source: "collaboration" | "activity"
  agents: NativeSubAgentViewModel[]
  status: NativeSubAgentDisplayStatus
  running: boolean
}

type KnownAgent = {
  ordinal: number
  label: string | null
}

function isNativeSubAgentState(value: unknown): value is NativeSubAgentState {
  return (
    typeof value === "string" &&
    nativeSubAgentStates.some((status) => status === value)
  )
}

function hasUnsafeAgentLabelCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (
      character === "/" ||
      character === "\\" ||
      (codePoint !== undefined && codePoint < 0x20)
    ) {
      return true
    }
  }
  return false
}

function safeAgentLabel(value: unknown) {
  if (typeof value !== "string") return null
  const label = value.trim()
  if (
    !label ||
    label.length > 80 ||
    hasUnsafeAgentLabelCharacter(label) ||
    label === "." ||
    label === ".."
  ) {
    return null
  }
  return label
}

function getKnownAgent(
  agentsById: Map<string, KnownAgent>,
  id: string,
  label?: unknown
) {
  const existing = agentsById.get(id)
  const normalizedLabel = safeAgentLabel(label)
  if (existing) {
    if (!existing.label && normalizedLabel) {
      existing.label = normalizedLabel
    }
    return existing
  }
  const next = {
    ordinal: agentsById.size + 1,
    label: normalizedLabel,
  }
  agentsById.set(id, next)
  return next
}

function collabAgents(item: NativeCollabAgentToolCallItem) {
  return item.agents?.filter((agent) => agent.agentKey.length > 0) ?? []
}

function activityStatus(item: NativeSubAgentActivityItem) {
  if (item.kind === "started") return "started" as const
  if (item.kind === "interacted") return "updated" as const
  if (item.kind === "completed") return "completed" as const
  return "interrupted" as const
}

function fallbackCollabStatus(item: NativeCollabAgentToolCallItem) {
  if (item.status === "failed") return "errored" as const
  if (item.status === "interrupted") return "interrupted" as const
  if (item.status === "inProgress") return "pendingInit" as const
  if (item.tool === "spawnAgent") return "running" as const
  return "updated" as const
}

function normalizeCollabAgentStatus(
  item: NativeCollabAgentToolCallItem,
  status: NativeSubAgentState | null
): NativeSubAgentDisplayStatus {
  const normalized = isNativeSubAgentState(status)
    ? status
    : fallbackCollabStatus(item)

  // app-server can expose notFound during the short spawn registration window.
  // A non-failed spawn is still initializing; a later started activity is the
  // authoritative proof that the child exists.
  if (
    item.tool === "spawnAgent" &&
    item.status !== "failed" &&
    normalized === "notFound"
  ) {
    return "pendingInit"
  }
  return normalized
}

export function isActiveNativeSubAgentStatus(
  status: NativeSubAgentDisplayStatus
) {
  return (
    status === "pendingInit" ||
    status === "running" ||
    status === "started" ||
    status === "updated"
  )
}

function isTerminalStatus(status: NativeSubAgentDisplayStatus) {
  return !isActiveNativeSubAgentStatus(status)
}

/**
 * Mirrors Codex Desktop's shared inline status priority. The name chips are
 * the grammatical subject and the status is rendered once after the group.
 */
export function nativeSubAgentGroupStatus(
  statuses: readonly NativeSubAgentDisplayStatus[]
): NativeSubAgentDisplayStatus {
  if (statuses.includes("errored")) return "errored"
  if (statuses.includes("interrupted")) return "interrupted"
  if (statuses.includes("shutdown")) return "shutdown"
  if (statuses.includes("notFound")) return "notFound"
  if (statuses.includes("updated")) return "updated"
  if (
    statuses.length > 0 &&
    statuses.every((status) => status === "completed")
  ) {
    return "completed"
  }
  return "started"
}

function mergeCurrentStatus(
  previous: NativeSubAgentDisplayStatus | undefined,
  next: NativeSubAgentDisplayStatus,
  allowTerminalExit = false
) {
  if (!previous) return next
  if (previous === "notFound" && isActiveNativeSubAgentStatus(next)) {
    return next
  }
  if (next === "notFound") return previous
  if (isTerminalStatus(next)) return next
  if (isTerminalStatus(previous) && !allowTerminalExit) return previous
  return next
}

/**
 * Creates display-only state transitions from native Codex collaboration items.
 * The caller supplies one turn's collapsed native lifecycle items so labels can
 * be resolved from safe runner projections even if the label arrives later.
 */
export function buildNativeSubAgentActivityViewModels(
  activities: NativeSubAgentActivityEntry[],
  { summaries = [] }: { summaries?: readonly NativeSubAgentSummary[] } = {}
) {
  return buildNativeSubAgentProjection(activities, summaries).activities
}

export function buildNativeSubAgentRosterViewModels(
  activities: NativeSubAgentActivityEntry[],
  { summaries = [] }: { summaries?: readonly NativeSubAgentSummary[] } = {}
) {
  return buildNativeSubAgentProjection(activities, summaries).agents
}

function collabAgentDisplayStatus(
  item: NativeCollabAgentToolCallItem,
  status: NativeSubAgentDisplayStatus
): NativeSubAgentDisplayStatus {
  if (item.status === "failed") return "errored"
  if (item.status === "interrupted") return "interrupted"
  if (isTerminalStatus(status)) return status
  if (
    item.tool === "sendInput" ||
    item.tool === "sendMessage" ||
    item.tool === "resumeAgent" ||
    item.tool === "followupTask" ||
    item.tool === "closeAgent" ||
    item.tool === "interruptAgent" ||
    item.tool === "listAgents"
  ) {
    return "updated"
  }
  return "started"
}

function buildNativeSubAgentProjection(
  activities: NativeSubAgentActivityEntry[],
  summaries: readonly NativeSubAgentSummary[]
) {
  const agentsById = new Map<string, KnownAgent>()
  const summaryByAgentId = new Map(
    summaries.map((summary) => [summary.agentKey, summary])
  )

  for (const activity of activities) {
    if (activity.item.type === "collabAgentToolCall") {
      const item: NativeCollabAgentToolCallItem = activity.item
      for (const agent of collabAgents(item)) {
        getKnownAgent(
          agentsById,
          agent.agentKey,
          summaryByAgentId.get(agent.agentKey)?.agentLabel ?? agent.agentLabel
        )
      }
      continue
    }
    if (activity.item.type === "subAgentActivity") {
      const item: NativeSubAgentActivityItem = activity.item
      if (item.agentKey) {
        getKnownAgent(
          agentsById,
          item.agentKey,
          summaryByAgentId.get(item.agentKey)?.agentLabel ?? item.agentLabel
        )
      }
    }
  }

  const currentStatusByAgentId = new Map<string, NativeSubAgentDisplayStatus>()
  for (const activity of activities) {
    if (activity.item.type === "collabAgentToolCall") {
      const item: NativeCollabAgentToolCallItem = activity.item
      for (const agent of collabAgents(item)) {
        const status = normalizeCollabAgentStatus(item, agent.status)
        currentStatusByAgentId.set(
          agent.agentKey,
          mergeCurrentStatus(
            currentStatusByAgentId.get(agent.agentKey),
            status,
            item.tool === "resumeAgent" || item.tool === "followupTask"
          )
        )
      }
      continue
    }
    if (activity.item.type === "subAgentActivity" && activity.item.agentKey) {
      const status = activityStatus(activity.item)
      currentStatusByAgentId.set(
        activity.item.agentKey,
        mergeCurrentStatus(
          currentStatusByAgentId.get(activity.item.agentKey),
          status
        )
      )
    }
  }
  for (const summary of summaries) {
    if (agentsById.has(summary.agentKey)) {
      currentStatusByAgentId.set(
        summary.agentKey,
        mergeCurrentStatus(
          currentStatusByAgentId.get(summary.agentKey),
          summary.status
        )
      )
    }
  }

  const namedActivityAgentIds = new Set(
    activities.flatMap((activity) => {
      if (
        activity.item.type !== "subAgentActivity" ||
        !activity.item.agentKey ||
        !agentsById.get(activity.item.agentKey)?.label
      ) {
        return []
      }
      return [activity.item.agentKey]
    })
  )
  const lastDisplayedCollabStatusByAgentId = new Map<
    string,
    NativeSubAgentDisplayStatus
  >()
  const models: NativeSubAgentActivityViewModel[] = []

  for (const activity of activities) {
    if (activity.item.type === "collabAgentToolCall") {
      const item: NativeCollabAgentToolCallItem = activity.item
      const projectedAgents = collabAgents(item).map((agent) => {
        const knownAgent = getKnownAgent(
          agentsById,
          agent.agentKey,
          summaryByAgentId.get(agent.agentKey)?.agentLabel ?? agent.agentLabel
        )
        const nativeStatus = normalizeCollabAgentStatus(item, agent.status)
        const status = collabAgentDisplayStatus(item, nativeStatus)
        return {
          id: agent.agentKey,
          ordinal: knownAgent.ordinal,
          label: knownAgent.label,
          status,
        }
      })
      const redundantCompletedSpawn =
        item.tool === "spawnAgent" &&
        item.status === "completed" &&
        projectedAgents.length > 0 &&
        projectedAgents.every((agent) => namedActivityAgentIds.has(agent.id))
      if (redundantCompletedSpawn) continue

      const agents = projectedAgents.filter((agent) => {
        if (
          item.tool !== "wait" &&
          item.tool !== "closeAgent" &&
          item.tool !== "interruptAgent"
        ) {
          return true
        }
        return lastDisplayedCollabStatusByAgentId.get(agent.id) !== agent.status
      })
      if (agents.length === 0) continue
      for (const agent of agents) {
        lastDisplayedCollabStatusByAgentId.set(agent.id, agent.status)
      }
      const status = nativeSubAgentGroupStatus(
        agents.map((agent) => agent.status)
      )
      models.push({
        itemId: item.id,
        source: "collaboration",
        agents,
        status,
        running: false,
      })
      continue
    }

    if (activity.item.type === "subAgentActivity") {
      const item: NativeSubAgentActivityItem = activity.item
      if (!item.agentKey) continue
      const knownAgent = getKnownAgent(
        agentsById,
        item.agentKey,
        summaryByAgentId.get(item.agentKey)?.agentLabel ?? item.agentLabel
      )
      const status = activityStatus(item)
      lastDisplayedCollabStatusByAgentId.set(item.agentKey, status)
      models.push({
        itemId: item.id,
        source: "activity",
        agents: [
          {
            id: item.agentKey,
            ordinal: knownAgent.ordinal,
            label: knownAgent.label,
            status,
          },
        ],
        status,
        running: false,
      })
    }
  }

  const lastModelIndexByAgentId = new Map<string, number>()
  models.forEach((model, modelIndex) => {
    for (const agent of model.agents) {
      lastModelIndexByAgentId.set(agent.id, modelIndex)
    }
  })

  const projectedActivities = models.map((model, modelIndex) => {
    const agents = model.agents.map((agent) => {
      const currentStatus = currentStatusByAgentId.get(agent.id)
      return {
        ...agent,
        status:
          lastModelIndexByAgentId.get(agent.id) === modelIndex &&
          currentStatus !== undefined &&
          isTerminalStatus(currentStatus)
            ? currentStatus
            : agent.status,
      }
    })
    const currentAgentsStillRunning = model.agents.some(
      (agent) =>
        lastModelIndexByAgentId.get(agent.id) === modelIndex &&
        isActiveNativeSubAgentStatus(
          currentStatusByAgentId.get(agent.id) ?? agent.status
        )
    )
    const status = nativeSubAgentGroupStatus(
      agents.map((agent) => agent.status)
    )
    return {
      ...model,
      agents,
      status,
      running:
        currentAgentsStillRunning && isActiveNativeSubAgentStatus(status),
    }
  })

  const agents = [...agentsById.entries()].map(([id, agent]) => ({
    id,
    ordinal: agent.ordinal,
    label: agent.label,
    status: currentStatusByAgentId.get(id) ?? ("pendingInit" as const),
  }))

  return { activities: projectedActivities, agents }
}
