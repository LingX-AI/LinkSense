import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva } from "class-variance-authority"
import { motion, useReducedMotion } from "framer-motion"
import { useState } from "react"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      orientation={orientation}
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex min-w-0 gap-3 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list relative isolate inline-flex w-fit max-w-full [scrollbar-width:none] items-center justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-xl bg-muted p-1 text-muted-foreground group-data-horizontal/tabs:min-h-10 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col [&::-webkit-scrollbar]:hidden"
)

function TabsList({
  className,
  children,
  id,
  variant = "segmented",
  ...props
}: TabsPrimitive.List.Props & {
  variant?: "segmented" | "navigation" | "pills"
}) {
  const reducedMotion = useReducedMotion()
  const [initialBackground] = useState<
    false | { x: number; y: number; width: number; height: number }
  >(() => {
    if (!id || typeof document === "undefined") return false
    // Capture the outgoing control before React replaces its route.
    const previousList = document.getElementById(id)
    const previous = previousList?.querySelector('[data-slot="tabs-indicator"]')
    if (!previousList || !previous) return false
    const track = previousList.getBoundingClientRect()
    const background = previous.getBoundingClientRect()
    if (!background.width || !background.height) return false
    return {
      x:
        background.left -
        track.left +
        previousList.scrollLeft -
        previousList.clientLeft,
      y:
        background.top -
        track.top +
        previousList.scrollTop -
        previousList.clientTop,
      width: background.width,
      height: background.height,
    }
  })
  return (
    <TabsPrimitive.List
      id={id}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        tabsListVariants(),
        variant === "pills" &&
          "gap-2 rounded-none bg-transparent p-0 group-data-horizontal/tabs:min-h-9 [&_[data-active]]:text-link-foreground [&_[data-slot=tabs-trigger]]:min-h-9 [&_[data-slot=tabs-trigger]]:font-normal",
        variant === "navigation" &&
          "w-full gap-4 rounded-none border-b border-border bg-transparent p-0 group-data-horizontal/tabs:min-h-11 [&_[data-active]]:text-link-foreground [&_[data-slot=tabs-trigger]]:h-11 [&_[data-slot=tabs-trigger]]:flex-none [&_[data-slot=tabs-trigger]]:rounded-none [&_[data-slot=tabs-trigger]]:font-normal",
        className
      )}
      render={
        <motion.div
          layout
          layoutScroll
          transition={{ layout: { duration: 0 } }}
        />
      }
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        className="contents"
        render={(indicatorProps, { activeTabPosition, activeTabSize }) => (
          <span {...indicatorProps}>
            {activeTabPosition &&
              activeTabSize &&
              activeTabSize.width > 0 &&
              activeTabSize.height > 0 && (
                <motion.span
                  data-slot="tabs-indicator"
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute top-0 left-0 z-0 rounded-lg bg-background shadow-sm",
                    variant === "pills" && "bg-accent shadow-none",
                    variant === "navigation" &&
                      "rounded-none bg-primary shadow-none"
                  )}
                  initial={initialBackground}
                  animate={{
                    x: activeTabPosition.left,
                    y:
                      variant === "navigation"
                        ? activeTabPosition.top + activeTabSize.height - 2
                        : activeTabPosition.top,
                    width: activeTabSize.width,
                    height: variant === "navigation" ? 2 : activeTabSize.height,
                  }}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: "spring", duration: 0.28, bounce: 0 }
                  }
                />
              )}
          </span>
        )}
      />
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative z-10 inline-flex h-auto min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-transparent! px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground not-data-active:hover:bg-hover focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:text-foreground forced-colors:data-active:border-[Highlight]! [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
