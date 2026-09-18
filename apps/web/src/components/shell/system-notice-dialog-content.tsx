import type { ComponentProps, ReactNode } from "react"
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MaintenanceNoticeHero } from "./maintenance-notice-hero"

export function SystemNoticeDialogContent({
  title,
  description,
  heroIcon,
  notice,
  children,
  footer,
  closeControl,
  initialFocus,
}: {
  title: string
  description: string
  heroIcon?: ReactNode
  notice?: ReactNode
  children?: ReactNode
  footer: ReactNode
  closeControl?: ReactNode
  initialFocus?: ComponentProps<typeof DialogContent>["initialFocus"]
}) {
  return (
    <DialogContent
      showCloseButton={false}
      initialFocus={initialFocus}
      overlayClassName="supports-backdrop-filter:backdrop-blur-none"
      className="max-h-[calc(100dvh-2rem)] grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl"
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <MaintenanceNoticeHero icon={heroIcon} />
        <div className="flex flex-col items-center gap-6 px-6 py-7 sm:px-10 sm:py-8">
          {notice}
          <DialogHeader className="items-center gap-3 text-center">
            <DialogTitle className="text-xl leading-snug font-semibold tracking-tight sm:text-2xl">
              {title}
            </DialogTitle>
            <DialogDescription className="max-w-md leading-relaxed">
              {description}
            </DialogDescription>
          </DialogHeader>
          {children}
        </div>
      </div>
      <DialogFooter className="gap-3 px-6 pb-7 sm:justify-center sm:px-10 sm:pb-8">
        {footer}
      </DialogFooter>
      {closeControl}
    </DialogContent>
  )
}
