import { useState, type ComponentPropsWithRef, type ReactNode } from "react"

import { useSidebarConversationOverlays } from "./sidebar-conversation-overlays-state"

export function SidebarConversationRow({
  actions,
  children,
  onPointerEnter,
  onFocusCapture,
  ...props
}: ComponentPropsWithRef<"div"> & { actions: ReactNode }) {
  const { alwaysShowActions } = useSidebarConversationOverlays()
  const [activated, setActivated] = useState(false)
  return (
    <div
      {...props}
      onPointerEnter={(event) => {
        setActivated(true)
        onPointerEnter?.(event)
      }}
      onFocusCapture={(event) => {
        setActivated(true)
        onFocusCapture?.(event)
      }}
    >
      {children}
      {/* Keep an activated control mounted for focus restoration and open menus. */}
      {(activated || alwaysShowActions) && actions}
    </div>
  )
}
