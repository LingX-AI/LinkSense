import { useMutation, useQuery } from "@tanstack/react-query"
import {
  skillEditDetailSchema,
  skillUpdatePreviewSchema,
  type SkillEditInput,
} from "@linksense/shared"
import { z } from "zod"
import { apiRequest, apiUploadRequest, downloadApiFile } from "@/api/client"
import {
  capabilityImportPreviewSchema,
  capabilitySummarySchema,
} from "@/api/contracts"

export const skillEditQueryKey = (id: string) =>
  ["capabilities", id, "skill-edit"] as const
const updatePreviewSchema = capabilityImportPreviewSchema.extend({
  operation: z.literal("update"),
  type: z.literal("skill"),
  skill_update: skillUpdatePreviewSchema,
})
export type SkillUpdateImportPreview = z.infer<typeof updatePreviewSchema>

export function useSkillEditDetail(id: string) {
  return useQuery({
    queryKey: skillEditQueryKey(id),
    queryFn: ({ signal }) =>
      apiRequest(`/capabilities/${id}/skill-edit`, {
        schema: skillEditDetailSchema,
        signal,
      }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  })
}

type SkillUpdateRequest =
  | { mode: "edit"; input: SkillEditInput }
  | { mode: "replace"; file: File; revision: string }

export function useSkillUpdatePreview(
  id: string,
  onUploadProgress: (percentage: number) => void
) {
  return useMutation({
    mutationFn: (request: SkillUpdateRequest) => {
      if (request.mode === "edit") {
        return apiRequest(`/capabilities/${id}/skill-edit`, {
          method: "POST",
          body: request.input,
          schema: updatePreviewSchema,
        })
      }
      const body = new FormData()
      body.append("file", request.file)
      body.append("type", "skill")
      body.append("base_revision", request.revision)
      return apiUploadRequest(`/capabilities/${id}/import`, {
        method: "POST",
        body,
        schema: updatePreviewSchema,
        onUploadProgress,
      })
    },
  })
}

export function useSkillUpdateConfirmation() {
  return useMutation({
    mutationFn: (preview: SkillUpdateImportPreview) =>
      apiRequest(`/capabilities/imports/${preview.preview_token}/confirm`, {
        method: "POST",
        schema: capabilitySummarySchema,
      }),
  })
}

export function useSkillPackageDownload(id: string) {
  return useMutation({
    mutationFn: () => downloadApiFile(`/capabilities/${id}/package`),
  })
}
