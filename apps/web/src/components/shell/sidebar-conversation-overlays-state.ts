import { createContext, useContext, type RefObject } from "react"
import { Menu } from "@base-ui/react/menu"
import { Popover } from "@base-ui/react/popover"
import { Tooltip } from "@base-ui/react/tooltip"

import type { SidebarConversationMenuPayload } from "./sidebar-conversation-actions"

export type SidebarConversationPreview = {
  title: string
  updatedAt: string
  relativeUpdatedAt: string
}

export type SidebarConversationOverlayState = {
  menu: Menu.Handle<SidebarConversationMenuPayload>
  preview: Popover.Handle<SidebarConversationPreview>
  tooltip: Tooltip.Handle<string>
  previewTriggerId: RefObject<string | null>
  tooltipTriggerId: RefObject<string | null>
  alwaysShowActions: boolean
}

export function createSidebarConversationOverlayHandles(): Pick<
  SidebarConversationOverlayState,
  "menu" | "preview" | "tooltip"
> {
  return {
    menu: Menu.createHandle<SidebarConversationMenuPayload>(),
    preview: Popover.createHandle<SidebarConversationPreview>(),
    tooltip: Tooltip.createHandle<string>(),
  }
}

export const SidebarConversationOverlayContext =
  createContext<SidebarConversationOverlayState | null>(null)

export function useSidebarConversationOverlays(): SidebarConversationOverlayState {
  const handles = useContext(SidebarConversationOverlayContext)
  if (!handles)
    throw new Error("Sidebar conversation overlays require a provider")
  return handles
}
