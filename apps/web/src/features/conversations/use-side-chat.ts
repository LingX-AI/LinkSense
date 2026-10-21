import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sideChatSchema, type SideChatSelection } from "@linksense/shared"

import { apiRequest } from "@/api/client"

const sideChatKey = (conversationId: string | undefined) =>
  ["conversation-side-chat", conversationId] as const

export function useSideChat(
  conversationId: string | undefined,
  enabled: boolean
) {
  const queryClient = useQueryClient()
  const [visibleParentId, setVisibleParentId] = useState<string | null>(null)
  const query = useQuery({
    queryKey: sideChatKey(conversationId),
    enabled: enabled && Boolean(conversationId),
    queryFn: ({ signal }) =>
      apiRequest(`/conversations/${conversationId}/side-chat`, {
        schema: sideChatSchema.nullable(),
        signal,
      }),
  })
  const mutation = useMutation({
    mutationFn: ({
      parentId,
      selection,
    }: {
      parentId: string
      selection: SideChatSelection
    }) =>
      apiRequest(`/conversations/${parentId}/side-chat`, {
        method: "POST",
        body: selection,
        schema: sideChatSchema,
      }),
    onMutate: ({ parentId }) => setVisibleParentId(parentId),
    onSuccess: async (result, { parentId }) => {
      await queryClient.cancelQueries({
        queryKey: sideChatKey(parentId),
        exact: true,
      })
      queryClient.setQueryData(sideChatKey(parentId), result)
    },
  })
  return {
    data: enabled ? query.data : null,
    open: enabled && visibleParentId === conversationId,
    pending:
      mutation.isPending && mutation.variables?.parentId === conversationId,
    failed: mutation.isError && mutation.variables?.parentId === conversationId,
    select: (selection: SideChatSelection) => {
      if (enabled && conversationId && !mutation.isPending)
        mutation.mutate({ parentId: conversationId, selection })
    },
    retry: () => {
      if (mutation.variables) mutation.mutate(mutation.variables)
    },
    show: () => {
      if (conversationId) setVisibleParentId(conversationId)
    },
    close: () => setVisibleParentId(null),
  }
}
