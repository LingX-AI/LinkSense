import { z } from "zod"

import { conversationDetailSchema } from "@/api/contracts"

export const conversationShareReceiptSchema = z.strictObject({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  title: z.string(),
  url_path: z.string().startsWith("/share/"),
  created_at: z.string(),
  updated_at: z.string(),
})

export const publicConversationShareSchema = conversationShareReceiptSchema
  .omit({ url_path: true })
  .extend({
    url_path: z.string().startsWith("/share/"),
    snapshot: conversationDetailSchema,
  })

export type PublicConversationShare = z.infer<
  typeof publicConversationShareSchema
>

export function buildConversationShareUrl(
  urlPath: string,
  origin = window.location.origin
) {
  return new URL(urlPath, origin).toString()
}

export async function copyConversationShareUrl(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  if (!copied) throw new Error("clipboard_unavailable")
}
