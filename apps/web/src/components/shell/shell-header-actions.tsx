import { useContext, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { ShellHeaderActionsContext } from "./shell-header-actions-context"

export function ShellHeaderActionsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [fallbackTarget, setFallbackTarget] = useState<HTMLDivElement | null>(
    null
  )
  // Header registration must not rerender the task list or route content.
  return (
    <ShellHeaderActionsContext.Provider
      value={{ target, setTarget, fallbackTarget, setFallbackTarget }}
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
  const target = context?.target ?? context?.fallbackTarget
  return target ? createPortal(children, target) : null
}

export function ShellHeaderActions({
  fallback = false,
}: {
  fallback?: boolean
}) {
  const context = useContext(ShellHeaderActionsContext)
  const setTarget = fallback ? context?.setFallbackTarget : context?.setTarget
  return setTarget ? (
    <div
      ref={setTarget}
      data-slot="shell-header-actions"
      hidden={fallback && Boolean(context?.target)}
      className={cn(
        "flex shrink-0 items-center",
        fallback && "absolute top-0 right-4 z-30 h-16.5 md:right-7"
      )}
    />
  ) : null
}
