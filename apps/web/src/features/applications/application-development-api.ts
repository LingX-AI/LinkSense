import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
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

export function useOpenApplicationDevelopment() {
  const navigate = useNavigate()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (
      input:
        { name: string } | { applicationId: string } | { developmentId: string }
    ) =>
      "developmentId" in input
        ? apiRequest(
            `/application-developments/${input.developmentId}/resume`,
            {
              method: "POST",
              schema: applicationDevelopmentSchema.extend({
                conversation_id: z.uuid(),
              }),
            }
          )
        : "applicationId" in input
          ? apiRequest(
              `/application-developments/by-application/${input.applicationId}`,
              {
                method: "POST",
                schema: applicationDevelopmentSchema.extend({
                  conversation_id: z.uuid(),
                }),
              }
            )
          : apiRequest("/application-developments", {
              method: "POST",
              body: input,
              schema: applicationDevelopmentSchema.extend({
                conversation_id: z.uuid(),
              }),
            }),
    onSuccess: async (project) => {
      await client.invalidateQueries({ queryKey: ["conversations"] })
      await client.invalidateQueries({ queryKey: ["applications"] })
      navigate(`/conversations/${project.conversation_id}`)
    },
  })
}

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
