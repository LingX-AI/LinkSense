import { createContext } from "react"
import type { Conversation } from "@/api/contracts"
import type { ConversationInsertionEdge } from "./conversation-order"

export type SidebarConversationDropTarget =
  | { kind: "project"; id: string; edge: "after" }
  | { kind: "reorder"; id: string; edge: ConversationInsertionEdge }
  | { kind: "project-reorder"; id: string; edge: ConversationInsertionEdge }

export const SidebarConversationDropTargetContext =
  createContext<SidebarConversationDropTarget | null>(null)

export const SidebarConversationDragState = createContext<{
  disabled: boolean
  projectsDisabled: boolean
  pendingOrder: string[] | null
  pendingProjectOrder: string[] | null
}>({
  disabled: true,
  projectsDisabled: true,
  pendingOrder: null,
  pendingProjectOrder: null,
})

export const projectDropId = (id: string): string => `project:${id}`

export function inSameConversationOrderGroup(
  left: Conversation,
  right: Conversation
): boolean {
  if (left.pinned_at || right.pinned_at)
    return Boolean(left.pinned_at && right.pinned_at)
  return left.project_id === right.project_id
}
