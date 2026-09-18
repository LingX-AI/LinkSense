import { useQuery } from "@tanstack/react-query"
import { z } from "zod"
import {
  applicationCenterReleaseSchema,
  applicationDistributionSummarySchema,
  applicationInstallationUpdateSchema,
  applicationDistributionSettingsSchema,
  type ApplicationDistributionChannel,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { paginatedSchema } from "@/api/contracts"

export const applicationDistributionKeys = {
  all: ["applications", "distribution"] as const,
  summaries: () => ["applications", "distribution", "summaries"] as const,
  mine: ["applications", "distribution", "mine"] as const,
  publishable: (search: string) =>
    ["applications", "distribution", "publishable", search] as const,
  settings: (applicationId: string) =>
    ["applications", "distribution", "settings", applicationId] as const,
  publicationReadiness: (applicationId: string) =>
    ["applications", "publication-readiness", applicationId] as const,
  details: (applicationId: string, channel: ApplicationDistributionChannel) =>
    [
      "applications",
      "distribution",
      "details",
      applicationId,
      channel,
    ] as const,
  center: (search: string) =>
    ["applications", "distribution", "center", search] as const,
  releases: (applicationId: string) =>
    ["applications", "distribution", "releases", applicationId] as const,
  update: (applicationId: string) =>
    ["applications", "distribution", "update", applicationId] as const,
  reviews: ["admin", "application-center"] as const,
}

export function useApplicationDistributionSettings(
  applicationId: string,
  enabled = true
) {
  return useQuery({
    queryKey: applicationDistributionKeys.settings(applicationId),
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}/distribution/settings`, {
        schema: applicationDistributionSettingsSchema,
        signal,
      }),
    enabled: enabled && Boolean(applicationId),
    refetchOnMount: "always",
  })
}
export const applicationCenterPageSchema = paginatedSchema(
  applicationCenterReleaseSchema
)
const summariesSchema = z.strictObject({
  items: z.array(applicationDistributionSummarySchema),
})

export function useApplicationDistributionSummaries() {
  return useQuery({
    queryKey: applicationDistributionKeys.summaries(),
    queryFn: ({ signal }) =>
      apiRequest("/applications/distribution", {
        schema: summariesSchema,
        signal,
      }),
  })
}

export function useApplicationInstallationUpdate(applicationId: string) {
  return useQuery({
    queryKey: applicationDistributionKeys.update(applicationId),
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}/installation/update`, {
        schema: applicationInstallationUpdateSchema,
        signal,
      }),
  })
}

export function useAdminApplicationReleases() {
  return useQuery({
    queryKey: applicationDistributionKeys.reviews,
    queryFn: ({ signal }) =>
      apiRequest("/admin/application-center", {
        schema: applicationCenterPageSchema,
        signal,
      }),
  })
}
