import {
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { ShellHeaderActionsContext } from "./shell-header-actions-context"

const compactViewportQuery = "(max-width: 767px)"

function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(compactViewportQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function isCompactViewport() {
  return window.matchMedia(compactViewportQuery).matches
}

function serverCompactViewport() {
  return false
}

export function ShellHeaderActionsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [sidebarTarget, setSidebarTarget] = useState<HTMLDivElement | null>(
    null
  )
  const [mobileSidebarTarget, setMobileSidebarTarget] =
    useState<HTMLDivElement | null>(null)
  // Sidebar slot registration must not rerender the task list or route content.
  return (
    <ShellHeaderActionsContext.Provider
      value={{
        sidebarTarget,
        setSidebarTarget,
        mobileSidebarTarget,
        setMobileSidebarTarget,
      }}
    >
      {children}
    </ShellHeaderActionsContext.Provider>
  )
}

export function ShellHeaderActionsPortal({
  children,
}: {
  children: ReactNode
}) {
  const context = useContext(ShellHeaderActionsContext)
  const compact = useSyncExternalStore(
    subscribeToViewport,
    isCompactViewport,
    serverCompactViewport
  )
  const target =
    context?.mobileSidebarTarget ?? (!compact ? context?.sidebarTarget : null)
  return target ? createPortal(children, target) : null
}

export function ShellSidebarActions({
  mobile = false,
  active = true,
}: {
  mobile?: boolean
  active?: boolean
}) {
  const context = useContext(ShellHeaderActionsContext)
  const setTarget = mobile
    ? context?.setMobileSidebarTarget
    : context?.setSidebarTarget
  return active && setTarget ? (
    <div
      ref={setTarget}
      data-slot="shell-sidebar-actions"
      className="flex shrink-0 items-center empty:hidden [&_button:active]:bg-(--app-sidebar-hover) [&_button:hover]:bg-(--app-sidebar-hover)"
    />
  ) : null
}
