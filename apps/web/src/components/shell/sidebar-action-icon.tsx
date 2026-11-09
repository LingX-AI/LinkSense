import type { ReactNode } from "react"

export function SidebarActionIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--app-sidebar-action)] transition-colors duration-150 group-hover/button:bg-[var(--app-sidebar-action-hover)] group-hover/button:text-[var(--app-text)] group-focus-visible/button:bg-[var(--app-sidebar-action-hover)] group-aria-expanded/button:bg-[var(--app-sidebar-action-hover)] group-aria-expanded/button:text-[var(--app-text)] motion-reduce:transition-none"
    >
      {children}
    </span>
  )
}
