import { HeaderIcon } from "@/components/ui/header-icon-button"
import { SidebarActionIcon } from "@/components/shell/sidebar-action-icon"

export function SidebarMoreIcon() {
  return (
    <SidebarActionIcon>
      <HeaderIcon name="more" className="size-4" />
    </SidebarActionIcon>
  )
}
