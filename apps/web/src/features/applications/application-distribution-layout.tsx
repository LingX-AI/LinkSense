import type { ReactNode } from "react"
import { DialogFooter } from "@/components/ui/dialog"

export function ApplicationDistributionLayout({
  children,
  actions,
}: {
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <>
      <div
        data-slot="application-distribution-body"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-6 py-6"
      >
        {children}
      </div>
      <DialogFooter className="shrink-0 flex-row justify-end px-6 pb-6">
        {actions}
      </DialogFooter>
    </>
  )
}
