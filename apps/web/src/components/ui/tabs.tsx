import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
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

function TabsList({
  className,
  children,
  id,
  variant = "segmented",
  ...props
}: TabsPrimitive.List.Props & {
  variant?: "segmented" | "navigation"
}) {
  const navigation = variant === "navigation"
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
        "group/tabs-list relative isolate inline-flex w-fit max-w-full items-center justify-start gap-2 overflow-x-auto overflow-y-hidden bg-transparent text-muted-foreground [scrollbar-width:none] group-data-horizontal/tabs:min-h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col [&::-webkit-scrollbar]:hidden",
        !navigation && "rounded-xl p-1",
        navigation &&
          "w-full gap-4 border-b border-border group-data-horizontal/tabs:min-h-11",
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
                    "pointer-events-none absolute top-0 left-0 z-0",
                    navigation ? "bg-primary" : "rounded-md bg-card"
                  )}
                  initial={initialBackground}
                  animate={{
                    x: activeTabPosition.left,
                    y: navigation
                      ? activeTabPosition.top + activeTabSize.height - 2
                      : activeTabPosition.top,
                    width: activeTabSize.width,
                    height: navigation ? 2 : activeTabSize.height,
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
        "relative z-10 inline-flex h-auto min-h-9 flex-none items-center justify-center gap-1.5 rounded-lg border border-transparent! px-3 py-1.5 text-sm font-normal whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-[variant=navigation]/tabs-list:h-11 group-data-[variant=navigation]/tabs-list:rounded-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:text-link-foreground forced-colors:data-active:border-[Highlight]! [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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

export { Tabs, TabsList, TabsTrigger, TabsContent }
