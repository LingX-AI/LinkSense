import { queryOptions } from "@tanstack/react-query"

import { ApiError, apiRequest } from "@/api/client"
import { conversationDetailSchema, type Conversation } from "@/api/contracts"
import { mergeConversationHistory } from "@/features/conversations/conversation-history"

export function isDefinitiveConversationUnavailableError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 403 || error.status === 404 || error.status === 410)
  )
}

export function conversationDetailQueryOptions(
  conversationId: string | undefined
) {
  return queryOptions({
    queryKey: ["conversation", conversationId] as const,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: (failureCount, error) =>
      !isDefinitiveConversationUnavailableError(error) && failureCount < 1,
    queryFn: async ({ signal, client }) => {
      if (!conversationId) {
        throw new Error("Conversation id is required")
      }

      const latest = await apiRequest(`/conversations/${conversationId}`, {
        schema: conversationDetailSchema,
        signal,
      })
      return mergeConversationHistory(
        client.getQueryData<Conversation>(["conversation", conversationId]),
        latest,
        "latest"
      )
    },
  })
}

export function selectFreshConversationEventSubscriptionId({
  conversationId,
  isNew,
  isSuccess,
  isFetchedAfterMount,
  hasReusableReplayBoundary = false,
}: {
  conversationId: string | undefined
  isNew: boolean
  isSuccess: boolean
  isFetchedAfterMount: boolean
  hasReusableReplayBoundary?: boolean
}) {
  if (
    isNew ||
    !conversationId ||
    !isSuccess ||
    (!isFetchedAfterMount && !hasReusableReplayBoundary)
  ) {
    return undefined
  }
  return conversationId
}
