import { createContext, useContext, type RefObject } from "react"
import { Popover } from "@base-ui/react/popover"

export type SidebarConversationPreview = {
  title: string
  updatedAt: string
  relativeUpdatedAt: string
}

export type SidebarConversationOverlayState = {
  preview: Popover.Handle<SidebarConversationPreview>
  previewTriggerId: RefObject<string | null>
  alwaysShowActions: boolean
}

export function createSidebarConversationOverlayHandles(): Pick<
  SidebarConversationOverlayState,
  "preview"
> {
  return {
    preview: Popover.createHandle<SidebarConversationPreview>(),
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
