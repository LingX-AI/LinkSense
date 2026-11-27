import { useQuery, type QueryClient } from "@tanstack/react-query"

import type { ConversationMessage, TurnStartReceipt } from "@/api/contracts"

export type PendingConversationTurnSubmission = Readonly<{
  conversationId: string
  idempotencyKey: string
  message: ConversationMessage
  optimisticId?: string
  turnId?: string
  status?: TurnStartReceipt["status"]
  replacesTurnId?: string
  afterEventSequence?: number
  interruptRequested?: boolean
}>

function pendingConversationTurnSubmissionQueryKey(conversationId: string) {
  return ["conversation", conversationId, "pending-turn-submission"] as const
}

export function usePendingConversationTurnSubmission(conversationId: string) {
  return useQuery({
    queryKey: pendingConversationTurnSubmissionQueryKey(conversationId),
    queryFn: () => Promise.resolve(null),
    enabled: false,
    initialData: null as PendingConversationTurnSubmission | null,
    staleTime: Number.POSITIVE_INFINITY,
  }).data
}

export function getPendingConversationTurnSubmission(
  queryClient: QueryClient,
  conversationId: string
) {
  return queryClient.getQueryData<PendingConversationTurnSubmission>(
    pendingConversationTurnSubmissionQueryKey(conversationId)
  )
}

export function setPendingConversationTurnSubmission(
  queryClient: QueryClient,
  conversationId: string,
  submission: PendingConversationTurnSubmission
) {
  queryClient.setQueryData(
    pendingConversationTurnSubmissionQueryKey(conversationId),
    submission
  )
}

export function updatePendingConversationTurnSubmission(
  queryClient: QueryClient,
  conversationId: string,
  update: (
    current: PendingConversationTurnSubmission
  ) => PendingConversationTurnSubmission
) {
  queryClient.setQueryData<PendingConversationTurnSubmission | null>(
    pendingConversationTurnSubmissionQueryKey(conversationId),
    (current) => (current ? update(current) : current)
  )
}

export function movePendingConversationTurnSubmission(
  queryClient: QueryClient,
  sourceConversationId: string,
  targetConversationId: string
) {
  const pending = getPendingConversationTurnSubmission(
    queryClient,
    sourceConversationId
  )
  if (!pending) return
  setPendingConversationTurnSubmission(queryClient, targetConversationId, {
    ...pending,
    conversationId: targetConversationId,
  })
  queryClient.removeQueries({
    queryKey: pendingConversationTurnSubmissionQueryKey(sourceConversationId),
    exact: true,
  })
}

export function clearPendingConversationTurnSubmission(
  queryClient: QueryClient,
  conversationId: string
) {
  queryClient.setQueryData(
    pendingConversationTurnSubmissionQueryKey(conversationId),
    null
  )
}
