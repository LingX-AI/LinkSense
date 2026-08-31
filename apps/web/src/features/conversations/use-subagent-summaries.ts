import { useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { referencedRunnerCodexSubAgentKeys } from "@linksense/shared"

import { apiRequest } from "@/api/client"
import {
  getNativeCodexPayload,
  nativeSubAgentSummariesSchema,
  type ConversationEvent,
  type NativeSubAgentSummaries,
  type NativeSubAgentSummary,
} from "@/api/contracts"

const subAgentSummaryRefreshIntervalMs = 1_500

function isDefinitiveMissingSummary(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  )
}

export function subAgentSummariesRefetchInterval(
  summaries: NativeSubAgentSummaries | undefined,
  expectedAgentCount: number,
  error?: unknown
) {
  if (isDefinitiveMissingSummary(error)) return false
  if (
    expectedAgentCount > 0 &&
    (!summaries || summaries.agents.length < expectedAgentCount)
  ) {
    return subAgentSummaryRefreshIntervalMs
  }
  return summaries?.agents.some(
    (agent) => agent.status === "pendingInit" || agent.status === "running"
  )
    ? subAgentSummaryRefreshIntervalMs
    : false
}

function referencedSubAgentKeys(event: ConversationEvent) {
  const payload = getNativeCodexPayload(event)
  if (
    !payload ||
    (payload.method !== "item/started" && payload.method !== "item/completed")
  ) {
    return []
  }
  return referencedRunnerCodexSubAgentKeys(payload.params.item)
}

export function useSubAgentSummaries({
  conversationId,
  events,
}: {
  conversationId?: string
  events: readonly ConversationEvent[]
}): ReadonlyMap<string, readonly NativeSubAgentSummary[]> {
  const turnInputs = useMemo(() => {
    const agentKeysByTurnId = new Map<string, Set<string>>()
    const latestEventRevisionByTurnId = new Map<string, string>()
    for (const event of events) {
      if (!event.turn_id) continue
      const agentKeys = referencedSubAgentKeys(event)
      if (agentKeys.length === 0) continue
      const knownAgentKeys =
        agentKeysByTurnId.get(event.turn_id) ?? new Set<string>()
      for (const agentKey of agentKeys) knownAgentKeys.add(agentKey)
      agentKeysByTurnId.set(event.turn_id, knownAgentKeys)
      latestEventRevisionByTurnId.set(event.turn_id, event.id)
    }
    return [...agentKeysByTurnId].map(([turnId, agentKeys]) => ({
      turnId,
      agentKeys: [...agentKeys],
      expectedAgentCount: agentKeys.size,
      eventRevision: latestEventRevisionByTurnId.get(turnId) ?? "unknown",
    }))
  }, [events])
  const queries = useQueries({
    queries: turnInputs.map(
      ({ turnId, expectedAgentCount, eventRevision }) => ({
        queryKey: ["subagent-summaries", conversationId, turnId, eventRevision],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiRequest(
            `/conversations/${conversationId}/turns/${turnId}/subagents`,
            { schema: nativeSubAgentSummariesSchema, signal }
          ),
        enabled: Boolean(conversationId),
        refetchInterval: (query: {
          state: {
            data: NativeSubAgentSummaries | undefined
            error: unknown
          }
        }) =>
          subAgentSummariesRefetchInterval(
            query.state.data,
            expectedAgentCount,
            query.state.error
          ),
      })
    ),
  })

  return useMemo(() => {
    const summaries = new Map<string, readonly NativeSubAgentSummary[]>()
    turnInputs.forEach(({ turnId, agentKeys }, index) => {
      const query = queries[index]
      if (query?.data) {
        summaries.set(turnId, query.data.agents)
      } else if (isDefinitiveMissingSummary(query?.error)) {
        summaries.set(
          turnId,
          agentKeys.map((agentKey) => ({ agentKey, status: "notFound" }))
        )
      }
    })
    return summaries
  }, [queries, turnInputs])
}
