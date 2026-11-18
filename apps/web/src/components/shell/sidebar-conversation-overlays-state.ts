import { createContext, useContext, type RefObject } from "react"
import { Popover } from "@base-ui/react/popover"
import { Tooltip } from "@base-ui/react/tooltip"

export type SidebarConversationPreview = {
  title: string
  updatedAt: string
  relativeUpdatedAt: string
}

export type SidebarConversationOverlayState = {
  preview: Popover.Handle<SidebarConversationPreview>
  tooltip: Tooltip.Handle<string>
  previewTriggerId: RefObject<string | null>
  tooltipTriggerId: RefObject<string | null>
  alwaysShowActions: boolean
}

export function createSidebarConversationOverlayHandles(): Pick<
  SidebarConversationOverlayState,
  "preview" | "tooltip"
> {
  return {
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
