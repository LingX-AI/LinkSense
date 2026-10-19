import { useQuery } from "@tanstack/react-query"

import { apiRequest } from "@/api/client"
import { personalizationSettingsSchema } from "@/api/contracts"

export const personalizationQueryKey = ["me", "personalization"] as const

export function usePersonalization() {
  return useQuery({
    queryKey: personalizationQueryKey,
    queryFn: ({ signal }) =>
      apiRequest("/me/personalization", {
        schema: personalizationSettingsSchema,
        signal,
      }),
    staleTime: Number.POSITIVE_INFINITY,
  })
}
