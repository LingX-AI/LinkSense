import {
  knowledgeBaseSourceSchema,
  sharePointConnectionSettingsSchema,
  type UpdateSharePointConnectionSettings,
} from "@linksense/shared"
import { z } from "zod"

import { apiRequest } from "@/api/client"

const updateResultSchema = z.strictObject({
  code: z.string(),
  settings: sharePointConnectionSettingsSchema,
})

export const knowledgeSourceQueryKeys = {
  sharePointSettings: [
    "admin",
    "knowledge-source-settings",
    "sharepoint",
  ] as const,
  source: (knowledgeBaseId: string) =>
    ["knowledge-base", knowledgeBaseId, "source"] as const,
}

export function getSharePointSettings(signal?: AbortSignal) {
  return apiRequest("/admin/knowledge-source-settings/sharepoint", {
    schema: sharePointConnectionSettingsSchema,
    signal,
  })
}

export function updateSharePointSettings(
  input: UpdateSharePointConnectionSettings
) {
  return apiRequest("/admin/knowledge-source-settings/sharepoint", {
    method: "PUT",
    body: input,
    schema: updateResultSchema,
  })
}

export function getKnowledgeBaseSource(
  knowledgeBaseId: string,
  signal?: AbortSignal
) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}/source`, {
    schema: knowledgeBaseSourceSchema,
    signal,
  })
}

export function syncKnowledgeBaseSource(knowledgeBaseId: string) {
  return apiRequest(`/knowledge-bases/${knowledgeBaseId}/source/sync`, {
    method: "POST",
    schema: knowledgeBaseSourceSchema,
  })
}
