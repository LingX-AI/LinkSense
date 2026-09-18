import {
  webSitePageSchema,
  webSiteSchema,
  webSiteSourcesSchema,
  type WebSiteCreate,
  type WebSiteStatus,
  type WebSiteUpdate,
} from "@linksense/shared"
import { apiRequest, downloadApiFile } from "@/api/client"
import { z } from "zod"

export const webSiteKeys = {
  all: ["web-sites"] as const,
  list: (input: {
    search?: string
    status?: WebSiteStatus
    conversationId?: string
  }) => ["web-sites", "list", input] as const,
  sources: (id: string) => ["web-sites", "sources", id] as const,
}
export function listWebSites(input: {
  search?: string
  status?: WebSiteStatus
  conversationId?: string
  cursor?: string | null
  signal?: AbortSignal
}) {
  return apiRequest("/web-sites", {
    schema: webSitePageSchema,
    signal: input.signal,
    query: {
      search: input.search,
      status: input.status,
      conversation_id: input.conversationId,
      cursor: input.cursor,
      limit: 30,
    },
  })
}
export function createWebSite(input: WebSiteCreate) {
  return apiRequest("/web-sites", {
    method: "POST",
    body: input,
    schema: webSiteSchema,
  })
}
export function updateWebSite(id: string, input: WebSiteUpdate) {
  return apiRequest(`/web-sites/${id}`, {
    method: "PATCH",
    body: input,
    schema: webSiteSchema,
  })
}
export function publishWebSite(id: string, fileId: string) {
  return apiRequest(`/web-sites/${id}/releases`, {
    method: "POST",
    body: { file_id: fileId },
    schema: webSiteSchema,
  })
}
export function deleteWebSite(id: string) {
  return apiRequest(`/web-sites/${id}`, { method: "DELETE", schema: z.null() })
}
export function getWebSiteSources(id: string, signal: AbortSignal) {
  return apiRequest(`/web-sites/${id}/sources`, {
    schema: webSiteSourcesSchema,
    signal,
  })
}
export function downloadWebSite(id: string) {
  return downloadApiFile(`/web-sites/${id}/download`)
}
