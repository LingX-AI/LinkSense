import { type QueryClient } from "@tanstack/react-query"
import { z } from "zod"
import {
  interactiveApplicationFileSchema,
  interactiveApplicationFilesResultSchema,
  type InteractiveApplicationFile,
} from "@linksense/shared"

import { apiRequest } from "@/api/client"

type InteractiveApplicationFilesClient = {
  readonly busy: boolean
  upload(params: unknown): Promise<InteractiveApplicationFile>
  list(): Promise<{ items: InteractiveApplicationFile[] }>
  remove(params: unknown): Promise<{ removed: true }>
}

export const interactiveApplicationFilesKey = (conversationId: string) =>
  ["conversation", conversationId, "interactive-files"] as const

export function createInteractiveApplicationFiles({
  queryClient,
  conversationId,
}: {
  queryClient: QueryClient
  conversationId: string
}): InteractiveApplicationFilesClient {
  let pending = 0
  const key = interactiveApplicationFilesKey(conversationId)
  const path = `/conversations/${conversationId}/interactive-attachments`
  const refreshConversation = () => {
    void queryClient.invalidateQueries(
      { queryKey: ["conversation", conversationId], exact: true },
      { throwOnError: false }
    )
  }
  const update = (
    apply: (items: InteractiveApplicationFile[]) => InteractiveApplicationFile[]
  ) => {
    queryClient.setQueryData<{ items: InteractiveApplicationFile[] }>(
      key,
      (current) => ({
        items: apply(current?.items ?? []),
      })
    )
    refreshConversation()
  }
  return {
    get busy() {
      return pending > 0
    },
    async upload(params: unknown) {
      const { file } = z
        .strictObject({ file: z.instanceof(File) })
        .parse(params)
      const body = new FormData()
      body.append("file", file, file.name)
      pending += 1
      try {
        const uploaded = await apiRequest(path, {
          method: "POST",
          body,
          schema: interactiveApplicationFileSchema,
        })
        update((items) => [
          ...items.filter((item) => item.id !== uploaded.id),
          uploaded,
        ])
        return uploaded
      } finally {
        pending -= 1
      }
    },
    async list() {
      const result = await apiRequest(path, {
        schema: interactiveApplicationFilesResultSchema,
      })
      queryClient.setQueryData(key, result)
      return result
    },
    async remove(params: unknown) {
      const { file_id: fileId } = z
        .strictObject({ file_id: z.string().uuid() })
        .parse(params)
      pending += 1
      try {
        await apiRequest(`${path}/${fileId}`, {
          method: "DELETE",
          schema: z.unknown(),
        })
        update((items) => items.filter((item) => item.id !== fileId))
        return { removed: true }
      } finally {
        pending -= 1
      }
    },
  }
}
