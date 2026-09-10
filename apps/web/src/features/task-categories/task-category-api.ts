import {
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import {
  taskCategoryListSchema,
  taskCategorySchema,
  taskCategoryOrderSchema,
  type TaskCategory,
  type TaskCategoryInput,
} from "@linksense/shared"

import { z } from "zod"

import { apiRequest } from "@/api/client"
import { conversationSchema, type Conversation } from "@/api/contracts"

export const taskCategoryKeys = { all: ["task-categories"] as const }

export function useTaskCategories(): UseQueryResult<TaskCategory[], Error> {
  return useQuery({
    queryKey: taskCategoryKeys.all,
    queryFn: ({ signal }) =>
      apiRequest("/task-categories", {
        schema: taskCategoryListSchema,
        signal,
      }),
  })
}

export function saveTaskCategory(
  input: TaskCategoryInput,
  id?: string
): Promise<TaskCategory> {
  return apiRequest(id ? `/task-categories/${id}` : "/task-categories", {
    method: id ? "PATCH" : "POST",
    body: input,
    schema: taskCategorySchema,
  })
}

export function deleteTaskCategory(id: string): Promise<null> {
  return apiRequest(`/task-categories/${id}`, {
    method: "DELETE",
    schema: z.null(),
  })
}

export function reorderTaskCategories(
  categoryIds: string[]
): Promise<TaskCategory[]> {
  return apiRequest("/task-categories/order", {
    method: "PUT",
    body: taskCategoryOrderSchema.parse({ category_ids: categoryIds }),
    schema: taskCategoryListSchema,
  })
}

export function moveTaskToCategory(
  id: string,
  categoryId: string | null
): Promise<Conversation> {
  return apiRequest(`/conversations/${id}`, {
    method: "PATCH",
    body: { category_id: categoryId },
    schema: conversationSchema,
  })
}

export async function refreshTaskCategories(
  client: QueryClient
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: taskCategoryKeys.all }),
    client.invalidateQueries({ queryKey: ["conversations"] }),
    client.invalidateQueries({ queryKey: ["conversation"] }),
  ])
}
