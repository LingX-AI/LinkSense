import type { ReactNode } from "react"
import { ScrollArea } from "@base-ui/react/scroll-area"

export function SidebarTaskScrollArea({ children }: { children: ReactNode }) {
  return (
    <ScrollArea.Root className="sidebar-conversation-region relative -mr-3 flex min-h-[72px] min-w-0 flex-1 flex-col overflow-hidden before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-[var(--app-divider)] before:opacity-0 before:transition-opacity before:duration-150 data-[overflow-y-start]:before:opacity-100 motion-reduce:before:transition-none">
      <ScrollArea.Viewport className="sidebar-conversation-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden! overflow-y-auto! [mask-image:linear-gradient(to_bottom,transparent,black_min(24px,var(--scroll-area-overflow-y-start,0px)),black_calc(100%_-_min(24px,var(--scroll-area-overflow-y-end,0px))),transparent)] mask-no-repeat pr-3.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <ScrollArea.Content className="flex w-full min-w-0! flex-col gap-3">
          {children}
        </ScrollArea.Content>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="absolute inset-y-0 right-0 flex w-[7px] touch-none opacity-0 transition-opacity duration-300 select-none hover:opacity-100 has-[:active]:opacity-100 data-[scrolling]:opacity-100 motion-reduce:transition-none">
        <ScrollArea.Thumb className="w-full rounded-full bg-[color-mix(in_srgb,var(--app-sidebar-muted)_22%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-sidebar-muted)_34%,transparent)]" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}
