import type { NativeCodexItem } from "@/api/contracts"

const hiddenConversationActivityTypes = new Set([
  "conversation.capability.attached",
  "capability_attached",
])

export function shouldDisplayConversationActivity(type: string): boolean {
  return !hiddenConversationActivityTypes.has(type)
}

export function shouldDisplayNativeActivity(item: NativeCodexItem): boolean {
  return item.type !== "reasoning"
}
