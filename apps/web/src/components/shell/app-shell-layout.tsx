import { useState, type CSSProperties, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { SidebarResizer } from "@/components/shell/sidebar-resizer"
import {
  persistSidebarWidth,
  readStoredSidebarWidth,
} from "@/components/shell/sidebar-width"

// Keep frequently changing layout state below the owner of the task list and
// route content, so resizing reuses their children instead of rendering them.
export function AppShellLayout({
  sidebarCollapsed,
  children,
}: Readonly<{
  sidebarCollapsed: boolean
  children: ReactNode
}>) {
  const { t } = useTranslation()
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const shellStyle = {
    "--app-sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties

  return (
    <div
      className="app-shell"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : undefined}
      data-sidebar-resizing={sidebarResizing ? "true" : undefined}
      style={shellStyle}
    >
      {children}
      {!sidebarCollapsed && (
        <SidebarResizer
          label={t("nav.resizeSidebar")}
          value={sidebarWidth}
          onResize={setSidebarWidth}
          onResizeStart={() => setSidebarResizing(true)}
          onResizeEnd={(width) => {
            setSidebarResizing(false)
            persistSidebarWidth(width)
          }}
        />
      )}
    </div>
  )
}
