import {
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import {
  projectListSchema,
  projectSchema,
  projectOrderSchema,
  type Project,
  type ProjectInput,
} from "@linksense/shared"

import { z } from "zod"

import { apiRequest } from "@/api/client"
import { conversationSchema, type Conversation } from "@/api/contracts"

export const projectKeys = { all: ["projects"] as const }

export function useProjects(): UseQueryResult<Project[], Error> {
  return useQuery({
    queryKey: projectKeys.all,
    queryFn: ({ signal }) =>
      apiRequest("/projects", {
        schema: projectListSchema,
        signal,
      }),
  })
}

export function saveProject(
  input: ProjectInput,
  id?: string
): Promise<Project> {
  return apiRequest(id ? `/projects/${id}` : "/projects", {
    method: id ? "PATCH" : "POST",
    body: input,
    schema: projectSchema,
  })
}

export function deleteProject(id: string): Promise<null> {
  return apiRequest(`/projects/${id}`, {
    method: "DELETE",
    schema: z.null(),
  })
}

export function reorderProjects(projectIds: string[]): Promise<Project[]> {
  return apiRequest("/projects/order", {
    method: "PUT",
    body: projectOrderSchema.parse({ project_ids: projectIds }),
    schema: projectListSchema,
  })
}

export async function moveTaskToProject(
  conversation: Pick<Conversation, "id" | "pinned_at">,
  projectId: string | null
): Promise<Conversation> {
  return apiRequest(`/conversations/${conversation.id}`, {
    method: "PATCH",
    body: {
      project_id: projectId,
      ...(conversation.pinned_at ? { pinned: false } : {}),
    },
    schema: conversationSchema,
  })
}

export async function refreshProjects(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: projectKeys.all }),
    client.invalidateQueries({ queryKey: ["conversations"] }),
    client.invalidateQueries({ queryKey: ["conversation"] }),
  ])
}
