import { createContext } from "react"
import type { Conversation } from "@/api/contracts"
import type { ConversationInsertionEdge } from "./conversation-order"

export type SidebarConversationDropTarget =
  | { kind: "category"; id: string; edge: "after" }
  | { kind: "reorder"; id: string; edge: ConversationInsertionEdge }
  | { kind: "category-reorder"; id: string; edge: ConversationInsertionEdge }

export const SidebarConversationDropTargetContext =
  createContext<SidebarConversationDropTarget | null>(null)

export const SidebarConversationDragState = createContext<{
  disabled: boolean
  categoriesDisabled: boolean
  pendingOrder: string[] | null
  pendingCategoryOrder: string[] | null
}>({
  disabled: true,
  categoriesDisabled: true,
  pendingOrder: null,
  pendingCategoryOrder: null,
})

export const taskCategoryDropId = (id: string): string => `task-category:${id}`

export function inSameConversationOrderGroup(
  left: Conversation,
  right: Conversation
): boolean {
  if (left.pinned_at || right.pinned_at)
    return Boolean(left.pinned_at && right.pinned_at)
  return left.category_id === right.category_id
}
