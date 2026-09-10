import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  feedbackDetailsSchema,
  feedbackSubmissionResultSchema,
  myFeedbackPageSchema,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export type FeedbackScope = "admin" | "personal"
export const feedbackKeys = {
  all: ["feedback"] as const,
  reply: (id: string) => ["feedback", "reply", id] as const,
  lists: (scope: FeedbackScope) => ["feedback", scope, "list"] as const,
  list: (scope: FeedbackScope, cursor?: string) =>
    ["feedback", scope, "list", cursor] as const,
  details: (scope: FeedbackScope, id: string) =>
    ["feedback", scope, "details", id] as const,
}
export function feedbackPath(scope: FeedbackScope): string {
  return scope === "admin" ? "/admin/feedback" : "/feedback"
}
export function useMyFeedback(cursor?: string) {
  return useQuery({
    queryKey: feedbackKeys.list("personal", cursor),
    queryFn: ({ signal }) =>
      apiRequest("/feedback", {
        schema: myFeedbackPageSchema,
        query: { cursor, limit: 20 },
        signal,
      }),
  })
}
export function useFeedbackDetails(scope: FeedbackScope, id: string) {
  return useQuery({
    queryKey: feedbackKeys.details(scope, id),
    queryFn: ({ signal }) =>
      apiRequest(`${feedbackPath(scope)}/${id}`, {
        schema: feedbackDetailsSchema,
        signal,
      }),
  })
}
export function useReplyToFeedback(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: feedbackKeys.reply(id),
    mutationFn: (input: { content: string; images: File[] }) => {
      const body = new FormData()
      body.append("content", input.content)
      input.images.forEach((image) => body.append("images", image))
      return apiRequest(`/admin/feedback/${id}/replies`, {
        method: "POST",
        body,
        schema: feedbackSubmissionResultSchema,
      })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: feedbackKeys.all })
    },
  })
}
