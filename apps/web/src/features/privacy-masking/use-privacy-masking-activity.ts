import { useInfiniteQuery } from "@tanstack/react-query"

import { privacyMaskingActivityResponseSchema } from "@linksense/shared"

import { apiRequest } from "@/api/client"
import { privacyMaskingQueryKey } from "@/features/privacy-masking/use-privacy-masking"

export function usePrivacyMaskingActivity(days: 7 | 30) {
  return useInfiniteQuery({
    queryKey: [...privacyMaskingQueryKey, "activity", days],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ days: String(days) })
      if (pageParam) params.set("before", pageParam)
      return apiRequest(`/me/privacy-masking-activity?${params.toString()}`, {
        schema: privacyMaskingActivityResponseSchema,
        signal,
      })
    },
    getNextPageParam: (last) => last.next_before,
    staleTime: 30_000,
  })
}
