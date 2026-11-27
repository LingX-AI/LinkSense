import { z } from "zod"
import {
  conversationShareReceiptSchema,
  conversationShareSnapshotSchema,
} from "@linksense/shared"

import { projectConversationShareSnapshot } from "@/features/conversations/conversation-share-content"

export { conversationShareReceiptSchema } from "@linksense/shared"
export { copyTextToClipboard as copyConversationShareUrl } from "@/lib/clipboard"

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
