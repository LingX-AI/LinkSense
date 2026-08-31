import { useQuery } from "@tanstack/react-query"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import {
  applicationSchema,
  mcpServerSchema,
  paginatedSchema,
} from "@/api/contracts"

const applicationListSchema = paginatedSchema(applicationSchema)
const mcpServerListSchema = z.strictObject({
  items: z.array(mcpServerSchema),
})

export const conversationSlashCommandQueryKeys = {
  applications: ["applications", "all", ""] as const,
  mcpServers: ["mcp-servers"] as const,
}

export function useConversationSlashApplications() {
  return useQuery({
    queryKey: conversationSlashCommandQueryKeys.applications,
    queryFn: ({ signal }) =>
      apiRequest("/applications", {
        query: { scope: "all" },
        schema: applicationListSchema,
        signal,
      }),
    staleTime: 30_000,
  })
}

export function useConversationSlashMcpServers() {
  return useQuery({
    queryKey: conversationSlashCommandQueryKeys.mcpServers,
    queryFn: ({ signal }) =>
      apiRequest("/mcp-servers", {
        schema: mcpServerListSchema,
        signal,
      }),
    staleTime: 30_000,
  })
}
