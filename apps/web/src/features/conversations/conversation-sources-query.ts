import { queryOptions } from "@tanstack/react-query"
import {
  conversationSourcesSchema,
  type ConversationSources,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export function conversationSourcesQueryKey(
  conversationId: string | undefined
) {
  return ["conversation", conversationId, "sources"] as const
}

export function conversationSourcesQueryOptions(
  conversationId: string | undefined,
  scopeId: string | null = null,
  revision: string | null = null
) {
  return queryOptions<ConversationSources>({
    queryKey: [
      ...conversationSourcesQueryKey(conversationId),
      scopeId,
      revision,
    ] as const,
    // A refreshed detail also covers missed completion events after reconnect.
    placeholderData: (previous, query) =>
      query &&
      query.queryKey[1] === conversationId &&
      query.queryKey[3] === scopeId
        ? previous
        : undefined,
    queryFn: ({ signal }) => {
      if (!conversationId) throw new Error("Conversation id is required")
      return apiRequest(`/conversations/${conversationId}/sources`, {
        schema: conversationSourcesSchema,
        signal,
      })
    },
    enabled: Boolean(conversationId),
    retry: false,
    staleTime: 30_000,
    gcTime: 0,
  })
}
