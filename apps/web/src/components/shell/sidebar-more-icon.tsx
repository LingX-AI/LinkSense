import { EllipsisIcon } from "lucide-react"
import { SidebarActionIcon } from "@/components/shell/sidebar-action-icon"

export function SidebarMoreIcon() {
  return (
    <SidebarActionIcon>
      <EllipsisIcon className="size-3.5" />
    </SidebarActionIcon>
  )
}
