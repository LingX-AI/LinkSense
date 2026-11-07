import { useDeferredValue } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { z } from "zod"
import { apiRequest } from "@/api/client"

export type TaskReference = { id: string; title: string }
const pageSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      application: z.unknown().optional(),
    })
  ),
  next_cursor: z.string().nullable(),
})

export function useTaskReferenceOptions(
  currentConversationId: string | undefined,
  search: string,
  archived: boolean,
  enabled = true
) {
  const queryText = useDeferredValue(search.trim())
  const query = useInfiniteQuery({
    queryKey: [
      "task-references",
      currentConversationId ?? null,
      queryText,
      archived,
    ],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiRequest("/conversations", {
        query: {
          search: queryText || undefined,
          archived,
          cursor: pageParam,
          limit: 30,
        },
        schema: pageSchema,
        signal,
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const items = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? [])
        .filter(
          (task) => task.id !== currentConversationId && !task.application
        )
        .map((task) => [task.id, task])
    ).values(),
  ]
  return { ...query, items }
}
