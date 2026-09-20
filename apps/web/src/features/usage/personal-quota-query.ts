import { useQuery } from "@tanstack/react-query"
import {
  personalQuotaReportSchema,
  type PersonalQuotaQuery,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export const personalQuotaKeys = {
  report: (userId: string | undefined, query: PersonalQuotaQuery) =>
    ["me", "quota", userId, query] as const,
}
export function usePersonalQuota(
  userId: string | undefined,
  query: PersonalQuotaQuery
) {
  return useQuery({
    queryKey: personalQuotaKeys.report(userId, query),
    queryFn: ({ signal }) =>
      apiRequest("/me/usage/quota", {
        schema: personalQuotaReportSchema,
        query,
        signal,
      }),
    enabled: Boolean(userId),
    refetchInterval: 60_000,
  })
}
