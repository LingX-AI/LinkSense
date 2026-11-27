import { useInfiniteQuery } from "@tanstack/react-query"

import { privacyMaskingActivityResponseSchema } from "@linksense/shared"

import { ApiError, apiRequest } from "@/api/client"
import { privacyMaskingQueryKey } from "@/features/privacy-masking/use-privacy-masking"

type ActivityCursor = { before: string; beforeId?: string }

export function usePrivacyMaskingActivity(days: 7 | 30) {
  return useInfiniteQuery({
    queryKey: [...privacyMaskingQueryKey, "activity", days],
    initialPageParam: null as ActivityCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ days: String(days) })
      if (pageParam) params.set("before", pageParam.before)
      if (pageParam?.beforeId) params.set("before_id", pageParam.beforeId)
      const list = () =>
        apiRequest(`/me/privacy-masking-activity?${params.toString()}`, {
          schema: privacyMaskingActivityResponseSchema,
          signal,
        })
      try {
        return await list()
      } catch (error) {
        if (!(pageParam?.beforeId && error instanceof ApiError && error.errorCode === "VALIDATION_ERROR")) {
          throw error
        }
        params.delete("before_id")
        return list()
      }
    },
    getNextPageParam: (last) => {
      if (!last.next_before) return null
      const beforeId = last.records.at(-1)?.id
      return beforeId
        ? { before: last.next_before, beforeId }
        : { before: last.next_before }
    },
    staleTime: 30_000,
  })
}
