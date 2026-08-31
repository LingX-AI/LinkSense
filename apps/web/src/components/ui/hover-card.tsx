"use client"

import { Popover as HoverCardPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function HoverCard({ ...props }: HoverCardPrimitive.Root.Props) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({
  openOnHover = true,
  delay = 200,
  closeDelay = 120,
  ...props
}: HoverCardPrimitive.Trigger.Props) {
  return (
    <HoverCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      openOnHover={openOnHover}
      delay={delay}
      closeDelay={closeDelay}
      {...props}
    />
  )
}

function HoverCardContent({
  className,
  positionerClassName,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 8,
  ...props
}: HoverCardPrimitive.Popup.Props &
  Pick<
    HoverCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    positionerClassName?: string
  }) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className={cn("isolate z-50", positionerClassName)}
      >
        <HoverCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "z-50 w-72 origin-(--transform-origin) rounded-xl border border-[var(--app-border)] bg-[var(--app-popover)] p-3.5 text-sm text-[var(--app-text)] shadow-md outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </HoverCardPrimitive.Positioner>
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
