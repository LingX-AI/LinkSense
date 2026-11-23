import { queryOptions } from "@tanstack/react-query"

import { ApiError, apiRequest } from "@/api/client"
import { isLoginSessionCurrent, type LoginSessionBoundary } from "@/api/session"
import { conversationDetailSchema, type Conversation } from "@/api/contracts"
import { mergeConversationHistory } from "@/features/conversations/conversation-history"
import { restoreStartingConversationTurn } from "./conversation-starting-turn"

export function isDefinitiveConversationUnavailableError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 403 || error.status === 404 || error.status === 410)
  )
}

export function conversationDetailQueryOptions(
  conversationId: string | undefined,
  options: { loginSessionBoundary?: LoginSessionBoundary } = {}
) {
  const { loginSessionBoundary } = options
  const assertLoginSessionCurrent = () => {
    if (
      loginSessionBoundary !== undefined &&
      !isLoginSessionCurrent(loginSessionBoundary)
    ) {
      throw new ApiError({
        status: 401,
        errorCode: "AUTH_SESSION_EXPIRED",
      })
    }
  }

  return queryOptions({
    queryKey: ["conversation", conversationId] as const,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: (failureCount, error) =>
      !isDefinitiveConversationUnavailableError(error) &&
      !(
        error instanceof ApiError &&
        error.status === 401 &&
        error.errorCode === "AUTH_SESSION_EXPIRED"
      ) &&
      failureCount < 1,
    queryFn: async ({ signal, client }) => {
      if (!conversationId) {
        throw new Error("Conversation id is required")
      }

      assertLoginSessionCurrent()
      const latest = await apiRequest(`/conversations/${conversationId}`, {
        schema: conversationDetailSchema,
        signal,
        ...(loginSessionBoundary !== undefined
          ? { loginSessionBoundary }
          : {}),
      })
      signal.throwIfAborted()
      assertLoginSessionCurrent()
      restoreStartingConversationTurn(client, latest)
      assertLoginSessionCurrent()
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
