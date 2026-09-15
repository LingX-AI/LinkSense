import { useContext } from "react"
import { cn } from "@/lib/utils"
import { SidebarConversationDropTargetContext } from "./sidebar-conversation-drag-state"

export function SidebarDropIndicator({
  targetId,
  scope = "task",
}: {
  targetId: string
  scope?: "task" | "project"
}) {
  const target = useContext(SidebarConversationDropTargetContext)
  if (target?.id !== targetId) return null
  if ((target.kind === "project-reorder") !== (scope === "project"))
    return null
  return (
    <span
      aria-hidden="true"
      data-slot="sidebar-drop-indicator"
      data-edge={target.edge}
      className={cn(
        "pointer-events-none absolute right-2 flex h-1.5 items-center text-[var(--app-brand)]",
        scope === "project"
          ? "left-2"
          : "left-[calc(8px+var(--sidebar-conversation-indent,0px))]",
        target.edge === "before" ? "top-0" : "bottom-0"
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full border-2 border-current bg-[var(--app-sidebar)]" />
      <span className="h-0.5 flex-1 bg-current" />
    </span>
  )
}
