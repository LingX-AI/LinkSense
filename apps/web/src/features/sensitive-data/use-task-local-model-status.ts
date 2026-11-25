import { useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { sensitiveDataTaskStatusSchema } from "@linksense/shared"

import { apiRequest } from "@/api/client"
import { sensitiveDataTaskQueryKey } from "./query-keys"

export function useTaskLocalModelStatus(
  ownerId: string | undefined,
  conversationId: string | undefined,
  active: boolean
) {
  const enabled = Boolean(ownerId && conversationId)
  const { data, refetch } = useQuery({
    queryKey: sensitiveDataTaskQueryKey(ownerId, conversationId),
    queryFn: ({ signal }) =>
      apiRequest(`/conversations/${conversationId}/sensitive-data`, {
        schema: sensitiveDataTaskStatusSchema,
        signal,
      }),
    enabled,
    refetchInterval: (query) =>
      active || query.state.data?.status === "waiting" ? 1_500 : false,
    retry: false,
  })
  const wasActive = useRef(active)
  useEffect(() => {
    const finished = wasActive.current && !active
    wasActive.current = active
    if (finished && enabled) void refetch()
  }, [active, enabled, refetch])
  return data
}
