import { z } from "zod"
import {
  publicKnowledgeManagementSchema,
  publicKnowledgeConversationPageSchema,
  publicKnowledgeConversationDetailSchema,
  publicKnowledgeTurnSchema,
  publicKnowledgeSessionSchema,
  publicKnowledgeConversationSchema,
  publicKnowledgeUsageSchema,
  type PublicKnowledgeSettings,
} from "@linksense/shared"
import { apiRequest, ApiError, buildApiUrl } from "@/api/client"

export const publicKnowledgeKeys = {
  management: (id: string) => ["applications", "public-knowledge", id] as const,
  usage: (id: string, from: string, to: string) =>
    ["public-knowledge-usage", id, from, to] as const,
  conversations: (
    id: string,
    search: string,
    from: string,
    to: string,
    status: string
  ) =>
    ["public-knowledge-conversations", id, search, from, to, status] as const,
  detail: (id: string, conversationId: string) =>
    ["public-knowledge-detail", id, conversationId] as const,
}
export const getPublicKnowledgeManagement = (
  id: string,
  signal?: AbortSignal
) =>
  apiRequest(`/applications/${id}/public-knowledge`, {
    schema: publicKnowledgeManagementSchema,
    signal,
  })
export const savePublicKnowledge = (
  settings: PublicKnowledgeSettings,
  id?: string
) =>
  apiRequest(
    id
      ? `/applications/${id}/public-knowledge`
      : "/applications/public-knowledge",
    {
      method: id ? "PUT" : "POST",
      body: settings,
      schema: publicKnowledgeManagementSchema,
    }
  )
export const setPublicKnowledgeEnabled = (id: string, enabled: boolean) =>
  apiRequest(`/applications/${id}/public-knowledge/status`, {
    method: "PATCH",
    body: { enabled },
    schema: publicKnowledgeManagementSchema,
  })
export const getPublicKnowledgeUsage = (
  id: string,
  query: Record<string, string | undefined>,
  signal?: AbortSignal
) =>
  apiRequest(`/applications/${id}/public-knowledge/usage`, {
    query,
    signal,
    schema: publicKnowledgeUsageSchema,
  })
export const getPublicKnowledgeConversations = (
  id: string,
  query: Record<string, string | undefined>,
  signal?: AbortSignal
) =>
  apiRequest(`/applications/${id}/public-knowledge/conversations`, {
    schema: publicKnowledgeConversationPageSchema,
    query,
    signal,
  })
export const getPublicKnowledgeDetail = (
  id: string,
  conversationId: string,
  signal?: AbortSignal
) =>
  apiRequest(
    `/applications/${id}/public-knowledge/conversations/${conversationId}`,
    { schema: publicKnowledgeConversationDetailSchema, signal }
  )

/** Anonymous requests never use the signed-in user's session or refresh flow. */
export class PublicKnowledgeClient {
  readonly publicId: string
  private readonly token: string | null
  constructor(publicId: string, token: string | null = null) {
    this.publicId = publicId
    this.token = token
  }
  private async request<T extends z.ZodType>(
    path: string,
    schema: T,
    body?: unknown
  ) {
    const response = await fetch(
      buildApiUrl(`/public-knowledge/${this.publicId}${path}`),
      {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
        credentials: "omit",
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(220_000),
      }
    )
    if (response.status === 204) return schema.parse(undefined)
    const payload: unknown = await response.json()
    if (!response.ok) {
      const error = z
        .object({ error_code: z.string(), message: z.string().optional() })
        .safeParse(payload)
      throw new ApiError({
        status: response.status,
        errorCode: error.success ? error.data.error_code : "RUNNER_UNAVAILABLE",
        ...(error.success && error.data.message
          ? { message: error.data.message }
          : {}),
      })
    }
    return schema.parse(
      z.object({ success: z.literal(true), data: z.unknown() }).parse(payload)
        .data
    )
  }
  start(origin: string) {
    return this.request("/sessions", publicKnowledgeSessionSchema, { origin })
  }
  list() {
    return this.request("/conversations", publicKnowledgeConversationPageSchema)
  }
  create() {
    return this.request("/conversations", publicKnowledgeConversationSchema, {})
  }
  detail(id: string) {
    return this.request(
      `/conversations/${id}`,
      publicKnowledgeConversationDetailSchema
    )
  }
  get eventToken(): string | null {
    return this.token
  }
  eventPath(id: string): string {
    return `/public-knowledge/${this.publicId}/conversations/${id}/events`
  }
  ask(id: string, inputText: string, requestId: string) {
    return this.request(
      `/conversations/${id}/turns`,
      publicKnowledgeTurnSchema,
      { input_text: inputText, request_id: requestId }
    )
  }
  interrupt(id: string, turnId: string) {
    return this.request(
      `/conversations/${id}/turns/${turnId}/interrupt`,
      z.undefined(),
      {}
    )
  }
}
