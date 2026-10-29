import { htmlPreviewSourceSchema } from "@linksense/shared"
import { apiRequest } from "@/api/client"

export function openHtmlPreview(
  conversationId: string,
  fileId: string,
  signal: AbortSignal,
  sessionId?: string
) {
  return apiRequest(
    `/conversations/${conversationId}/files/${fileId}/html-preview`,
    {
      method: "POST",
      body: sessionId ? { session_id: sessionId } : {},
      schema: htmlPreviewSourceSchema,
      signal,
    }
  )
}
