import { useQuery } from "@tanstack/react-query"
import { applicationPublicationReadinessSchema } from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { applicationDistributionKeys } from "./application-distribution-queries"

export function useApplicationPublicationReadiness(applicationId: string) {
  return useQuery({
    queryKey: applicationDistributionKeys.publicationReadiness(applicationId),
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}/publication-readiness`, {
        schema: applicationPublicationReadinessSchema,
        signal,
      }),
    enabled: Boolean(applicationId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
    retry: false,
  })
}
