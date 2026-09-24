import { z } from "zod"

import { apiRequest } from "@/api/client"
import { conversationFileSchema } from "@/api/contracts"

const referenceableFileSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  kind: z.enum(["attachment", "artifact"]),
  filename: z.string().min(1),
  mime_type: z.string().nullable(),
  size_bytes: z.number().int().nonnegative(),
  created_at: z.string(),
  task: z.object({
    id: z.string().uuid(),
    title: z.string().min(1),
    archive_status: z.enum(["active", "archived"]),
  }),
})

const referenceableFilePageSchema = z.object({
  items: z.array(referenceableFileSchema),
  next_cursor: z.string().nullable(),
})

export type ReferenceableFile = z.infer<typeof referenceableFileSchema>

export const referenceFileKeys = {
  list: (currentConversationId: string | undefined, search: string) =>
    ["referenceable-files", currentConversationId ?? null, search] as const,
}

export function getReferenceableFiles(input: {
  search?: string
  excludeConversationId?: string
  cursor?: string | null
  signal?: AbortSignal
}): Promise<z.infer<typeof referenceableFilePageSchema>> {
  return apiRequest("/conversations/referenceable-files", {
    query: {
      search: input.search,
      exclude_conversation_id: input.excludeConversationId,
      cursor: input.cursor,
      limit: 50,
    },
    schema: referenceableFilePageSchema,
    signal: input.signal,
  })
}

export function referenceConversationFile(
  conversationId: string,
  sourceFileId: string
): Promise<z.infer<typeof conversationFileSchema>> {
  return apiRequest(`/conversations/${conversationId}/attachments/references`, {
    method: "POST",
    body: { source_file_id: sourceFileId },
    schema: conversationFileSchema,
  })
}
