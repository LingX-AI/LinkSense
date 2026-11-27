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
  const actionsVisible = activated || alwaysShowActions
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
      {/* Keep mouse-only controls in the DOM for layout stability, but hide them
          from the accessibility tree until the row is hovered, focused or touch. */}
      <div
        aria-hidden={actionsVisible ? undefined : true}
        inert={!actionsVisible}
      >
        {actions}
      </div>
    </div>
  )
}
