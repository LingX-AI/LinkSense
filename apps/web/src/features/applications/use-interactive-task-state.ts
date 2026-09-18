import { useCallback, useEffect, useMemo, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  interactiveApplicationTaskStateSchema,
  type InteractiveApplicationTaskState,
} from "@linksense/shared"
import { ApiError, apiRequest } from "@/api/client"
import type { ConversationEvent } from "@/api/contracts"

// These notifications change existing persisted state. Token/tool deltas do not.
export function refreshesInteractiveTaskState(
  event: ConversationEvent
): boolean {
  return (
    event.type === "conversation.started" ||
    event.type === "conversation.completed" ||
    event.type === "conversation.interrupted" ||
    event.type === "conversation.error" ||
    event.type === "conversation.status.changed" ||
    event.type.startsWith("conversation.user_input_request.") ||
    event.type.startsWith("conversation.plan_review.") ||
    event.type.startsWith("conversation.pending_request.") ||
    event.type === "turn/started" ||
    event.type === "turn/completed"
  )
}

export function useInteractiveTaskState({
  conversationId,
  enabled,
  post,
}: {
  conversationId: string
  enabled: boolean
  post: (message: Record<string, unknown>) => void
}) {
  const client = useQueryClient()
  const publication = useRef({ revision: 0, signature: "" })
  const options = useMemo(
    () => ({
      queryKey: [
        "conversation",
        conversationId,
        "interactive-task-state",
      ] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiRequest(`/conversations/${conversationId}/interactive-task-state`, {
          schema: interactiveApplicationTaskStateSchema,
          signal,
        }),
      staleTime: 0,
      retry: 1,
    }),
    [conversationId]
  )
  const query = useQuery({
    ...options,
    enabled,
    // Recover silent startup/reconnect gaps; never resubmit work. Stop when idle/terminal.
    refetchInterval: (query) =>
      query.state.data?.can_submit === false ? 5_000 : false,
  })
  const publish = useCallback(
    (state: InteractiveApplicationTaskState) => {
      const signature = JSON.stringify(state)
      if (publication.current.signature !== signature) {
        publication.current = {
          revision: publication.current.revision + 1,
          signature,
        }
        post({
          type: "task-state",
          revision: publication.current.revision,
          state,
        })
      }
      return { revision: publication.current.revision, state }
    },
    [post]
  )
  useEffect(() => {
    if (!enabled) return
    if (query.isError) {
      const error =
        query.error instanceof ApiError
          ? query.error.errorCode
          : "LINKSENSE_SDK_REQUEST_FAILED"
      const signature = `error:${error}`
      if (publication.current.signature !== signature) {
        publication.current = {
          revision: publication.current.revision + 1,
          signature,
        }
        post({
          type: "task-state-error",
          revision: publication.current.revision,
          error,
        })
      }
    } else if (query.data) publish(query.data)
  }, [enabled, query.data, query.isError, query.error, publish, post])
  const getState = useCallback(
    async () => publish(await client.fetchQuery(options)),
    [client, options, publish]
  )
  const refresh = useCallback(async () => {
    // Even an initial read may have started before admission or completion.
    // Cancel it before refetching so its old snapshot cannot be published later.
    await client.cancelQueries({ queryKey: options.queryKey, exact: true })
    await client.invalidateQueries({ queryKey: options.queryKey, exact: true })
  }, [client, options])
  return useMemo(() => ({ getState, refresh }), [getState, refresh])
}
