import { useQuery, type QueryClient } from "@tanstack/react-query"

export type PendingConversationExecution = Readonly<{
  turnId: string | null
}>

function pendingConversationExecutionQueryKey(conversationId: string) {
  return ["conversation", conversationId, "pending-execution"] as const
}

export function usePendingConversationExecution(conversationId: string) {
  return useQuery({
    queryKey: pendingConversationExecutionQueryKey(conversationId),
    queryFn: () => Promise.resolve(null),
    enabled: false,
    initialData: null as PendingConversationExecution | null,
    staleTime: Number.POSITIVE_INFINITY,
  }).data
}

export function getPendingConversationExecution(
  queryClient: QueryClient,
  conversationId: string
) {
  return queryClient.getQueryData<PendingConversationExecution>(
    pendingConversationExecutionQueryKey(conversationId)
  )
}

export function markConversationExecutionPending(
  queryClient: QueryClient,
  conversationId: string
) {
  queryClient.setQueryData<PendingConversationExecution>(
    pendingConversationExecutionQueryKey(conversationId),
    { turnId: null }
  )
}

export function bindPendingConversationTurn(
  queryClient: QueryClient,
  conversationId: string,
  turnId: string
) {
  queryClient.setQueryData<PendingConversationExecution | null>(
    pendingConversationExecutionQueryKey(conversationId),
    (current) => (current ? { turnId } : current)
  )
}

export function movePendingConversationExecution(
  queryClient: QueryClient,
  sourceConversationId: string,
  targetConversationId: string
) {
  const pending = getPendingConversationExecution(
    queryClient,
    sourceConversationId
  )
  if (!pending) return
  queryClient.setQueryData(
    pendingConversationExecutionQueryKey(targetConversationId),
    pending
  )
  queryClient.removeQueries({
    queryKey: pendingConversationExecutionQueryKey(sourceConversationId),
    exact: true,
  })
}

export function clearPendingConversationExecution(
  queryClient: QueryClient,
  conversationId: string
) {
  queryClient.setQueryData(
    pendingConversationExecutionQueryKey(conversationId),
    null
  )
}
