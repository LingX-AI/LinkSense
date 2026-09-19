import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  applicationDevelopmentSchema,
  type ApplicationDevelopmentDiagnostic,
  type InteractiveDependencyType,
  applicationDevelopmentMetadataUpdateSchema,
  type ApplicationDevelopmentMetadataUpdate,
} from "@linksense/shared"
import { z } from "zod"
import { apiRequest } from "@/api/client"

export const applicationDevelopmentKeys = {
  capabilities: (userId: string | undefined, id: string) =>
    ["application-development", userId, "capabilities", id] as const,
  capabilityOptions: (
    userId: string | undefined,
    type: InteractiveDependencyType,
    search: string
  ) =>
    [
      "application-development",
      userId,
      "capability-options",
      type,
      search,
    ] as const,
  tests: (userId: string | undefined, id: string) =>
    ["application-development", userId, "tests", id] as const,
  conversation: (
    userId: string | undefined,
    conversationId: string | undefined
  ) =>
    [
      "application-development",
      userId,
      "conversation",
      conversationId,
    ] as const,
  preview: (userId: string | undefined, id: string) =>
    ["application-development", userId, "preview", id] as const,
}
export const syncApplicationDevelopment = (id: string, signal?: AbortSignal) =>
  apiRequest(`/application-developments/${id}/sync`, {
    method: "POST",
    signal,
    schema: applicationDevelopmentSchema,
  })
export const installApplicationDevelopment = (
  id: string,
  sourceHash: string,
  release: import("@linksense/shared").ApplicationVersionInput
) =>
  apiRequest(`/application-developments/${id}/install`, {
    method: "POST",
    body: { source_hash: sourceHash, ...release },
    schema: applicationDevelopmentSchema,
  })
export const updateApplicationDevelopmentMetadata = (
  id: string,
  input: ApplicationDevelopmentMetadataUpdate
) =>
  apiRequest(`/application-developments/${id}/metadata`, {
    method: "PATCH",
    body: applicationDevelopmentMetadataUpdateSchema.parse(input),
    schema: applicationDevelopmentSchema,
  })
export const reportApplicationDiagnostics = (
  id: string,
  revision: number,
  diagnostics: ApplicationDevelopmentDiagnostic[]
) =>
  apiRequest(`/application-developments/${id}/diagnostics`, {
    method: "PUT",
    body: { revision, diagnostics },
    schema: z.object({ success: z.literal(true) }),
  })

export function useDeleteApplicationDevelopment() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/application-developments/${id}`, {
        method: "DELETE",
        schema: z.object({ success: z.literal(true) }),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["applications"] }),
        client.invalidateQueries({ queryKey: ["conversations"] }),
        client.invalidateQueries({ queryKey: ["application-development"] }),
      ])
    },
  })
}
