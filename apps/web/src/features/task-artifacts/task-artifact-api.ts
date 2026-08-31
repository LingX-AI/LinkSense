import { z } from "zod"

import { apiRequest } from "@/api/client"

const taskArtifactSchema = z
  .object({
    id: z.string(),
    conversation_id: z.string(),
    turn_id: z.string().nullable(),
    kind: z.literal("artifact"),
    source: z.enum(["agent_generated", "system_generated"]),
    status: z.literal("registered"),
    filename: z.string().min(1),
    mime_type: z.string().nullable(),
    size_bytes: z.number().int().nonnegative(),
    storage_backend: z.literal("minio"),
    downloadable: z.literal(true),
    created_at: z.string(),
    updated_at: z.string(),
    task: z.object({
      id: z.string(),
      title: z.string().min(1),
      archive_status: z.enum(["active", "archived"]),
    }),
  })
  .transform((value) => ({
    ...value,
    name: value.filename,
    size: value.size_bytes,
    download_available: value.downloadable,
  }))

const taskArtifactPageSchema = z.object({
  items: z.array(taskArtifactSchema),
  next_cursor: z.string().nullable(),
})

const artifactPreviewLinkSchema = z.object({
  url: z.url(),
  expires_at: z.string().datetime({ offset: true }),
})

export type TaskArtifact = z.infer<typeof taskArtifactSchema>
export type TaskArtifactPage = z.infer<typeof taskArtifactPageSchema>

export function getTaskArtifacts(input: {
  search?: string
  cursor?: string | null
  limit?: number
  signal?: AbortSignal
}) {
  return apiRequest("/conversations/artifacts", {
    query: {
      search: input.search,
      cursor: input.cursor,
      limit: input.limit ?? 50,
    },
    schema: taskArtifactPageSchema,
    signal: input.signal,
  })
}

export function getTaskArtifactPreviewLink(
  file: TaskArtifact,
  signal: AbortSignal
) {
  return apiRequest(
    `/conversations/${file.conversation_id}/files/${file.id}/preview`,
    {
      method: "POST",
      schema: artifactPreviewLinkSchema,
      signal,
    }
  )
}
