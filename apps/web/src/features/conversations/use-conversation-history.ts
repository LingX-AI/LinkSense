import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CONVERSATION_HISTORY_PAGE_TURN_LIMIT } from "@linksense/shared"

import { apiRequest } from "@/api/client"
import { conversationDetailSchema, type Conversation } from "@/api/contracts"
import { mergeConversationHistory } from "@/features/conversations/conversation-history"

export type ConversationHistoryControl = {
  failedTurnIds: ReadonlySet<string>
  loadTurn: (turnId: string, retry?: boolean) => Promise<void>
}

export function useConversationHistory(
  conversation: Conversation | undefined
): ConversationHistoryControl {
  const queryClient = useQueryClient()
  const inFlight = useRef(new Map<string, Promise<void>>())
  const [failures, setFailures] = useState<Record<string, string[]>>({})
  const conversationId = conversation?.id
  const scopeId = conversation?.history?.scope_id
  const scopeKey = JSON.stringify([conversationId, scopeId])
  useEffect(
    () => () => {
      if (conversationId)
        void queryClient.cancelQueries({
          queryKey: ["conversation-history", conversationId, scopeId],
        })
    },
    [conversationId, scopeId, queryClient]
  )

  const failedTurnIds = new Set(failures[scopeKey] ?? [])
  const loadTurn = async (turnId: string, retry = false): Promise<void> => {
    if (!conversationId) return
    const current = queryClient.getQueryData<Conversation>([
      "conversation",
      conversationId,
    ])
    if (!current?.history || current.history.scope_id !== scopeId) return
    const index = current.history.index.findIndex(
      (item) => item.turn_id === turnId
    )
    if (
      index < 0 ||
      current.history.turn_ids.includes(turnId) ||
      (!retry && failedTurnIds.has(turnId))
    )
      return
    const start =
      Math.floor(index / CONVERSATION_HISTORY_PAGE_TURN_LIMIT) *
      CONVERSATION_HISTORY_PAGE_TURN_LIMIT
    const page = current.history.index.slice(
      start,
      start + CONVERSATION_HISTORY_PAGE_TURN_LIMIT
    )
    const sequence = page[0].sequence_no
    const key = JSON.stringify([scopeKey, sequence])
    const pending = inFlight.current.get(key)
    if (pending) return pending
    const pageIds = page.map((item) => item.turn_id)
    const updateFailures = (failed: boolean) =>
      setFailures((previous) => ({
        ...previous,
        [scopeKey]: failed
          ? [...new Set([...(previous[scopeKey] ?? []), ...pageIds])]
          : (previous[scopeKey] ?? []).filter((id) => !pageIds.includes(id)),
      }))
    const request = queryClient
      .fetchQuery({
        queryKey: ["conversation-history", conversationId, scopeId, sequence],
        gcTime: 0,
        retry: false,
        queryFn: ({ signal }) =>
          apiRequest(`/conversations/${conversationId}`, {
            query: { around_turn: sequence },
            schema: conversationDetailSchema,
            signal,
          }),
      })
      .then((page) => {
        queryClient.setQueryData<Conversation>(
          ["conversation", conversationId],
          (cached) =>
            cached ? mergeConversationHistory(cached, page, "older") : undefined
        )
        updateFailures(false)
      })
      .catch(() => {
        // Preserve the failed page for an explicit retry; scrolling never loops.
        updateFailures(true)
      })
      .finally(() => {
        inFlight.current.delete(key)
      })
    inFlight.current.set(key, request)
    return request
  }
  return { failedTurnIds, loadTurn }
}
