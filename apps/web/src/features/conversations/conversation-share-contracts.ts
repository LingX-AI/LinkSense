import { z } from "zod"
import {
  conversationShareReceiptSchema,
  conversationShareSnapshotSchema,
} from "@linksense/shared"

import { projectConversationShareSnapshot } from "@/features/conversations/conversation-share-content"

export { conversationShareReceiptSchema } from "@linksense/shared"

export const publicConversationShareSchema =
  conversationShareReceiptSchema.extend({
    snapshot: conversationShareSnapshotSchema.transform(
      projectConversationShareSnapshot
    ),
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
