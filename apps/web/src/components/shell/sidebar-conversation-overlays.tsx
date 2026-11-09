import {
  useMemo,
  useEffect,
  useId,
  useState,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { DropdownMenu } from "@/components/ui/dropdown-menu"
import { Tooltip, ActionTooltipContent } from "@/components/ui/tooltip"
import { SidebarConversationMenu } from "./sidebar-conversation-actions"
import {
  createSidebarConversationOverlayHandles,
  SidebarConversationOverlayContext,
  useSidebarConversationOverlays,
  type SidebarConversationPreview,
} from "./sidebar-conversation-overlays-state"

const touchActionsQuery = "(hover: none)"
const getTouchActions = () => window.matchMedia(touchActionsQuery).matches
const getServerTouchActions = () => false
function subscribeTouchActions(onChange: () => void) {
  const media = window.matchMedia(touchActionsQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

export function SidebarConversationOverlays({
  children,
}: {
  children: ReactNode
}) {
  const [handles] = useState(createSidebarConversationOverlayHandles)
  const previewTriggerId = useRef<string | null>(null)
  const tooltipTriggerId = useRef<string | null>(null)
  const alwaysShowActions = useSyncExternalStore(
    subscribeTouchActions,
    getTouchActions,
    getServerTouchActions
  )
  const state = useMemo(
    () => ({
      ...handles,
      previewTriggerId,
      tooltipTriggerId,
      alwaysShowActions,
    }),
    [handles, alwaysShowActions]
  )
  return (
    <SidebarConversationOverlayContext.Provider value={state}>
      {children}
      <HoverCard
        handle={handles.preview}
        onOpenChange={(open, details) => {
          if (
            details.reason === "trigger-press" &&
            details.event.detail !== 0
          ) {
            details.cancel()
            return
          }
          previewTriggerId.current = open ? (details.trigger?.id ?? null) : null
        }}
      >
        {({ payload }) =>
          payload && (
            <HoverCardContent
              side="right"
              sideOffset={8}
              align="start"
              aria-label={payload.title}
              initialFocus={false}
              finalFocus={false}
              className="sidebar-conversation-preview flex w-75! max-w-[calc(100vw-1rem)] flex-col items-stretch gap-2 p-3! shadow-[var(--app-dialog-shadow)]!"
            >
              <span className="sidebar-conversation-preview-title w-full min-w-0 text-sm leading-[var(--app-line-22)] font-normal break-words whitespace-normal">
                {payload.title}
              </span>
              <time
                dateTime={payload.updatedAt}
                className="sidebar-conversation-preview-time block w-full text-left text-xs leading-[var(--app-line-18)] font-normal text-muted-foreground"
              >
                {payload.relativeUpdatedAt}
              </time>
            </HoverCardContent>
          )
        }
      </HoverCard>
      <DropdownMenu handle={handles.menu}>
        {({ payload }) => payload && <SidebarConversationMenu {...payload} />}
      </DropdownMenu>
      <Tooltip
        handle={handles.tooltip}
        onOpenChange={(open, details) => {
          tooltipTriggerId.current = open ? (details.trigger?.id ?? null) : null
        }}
      >
        {({ payload }) => (
          <ActionTooltipContent side="top">{payload}</ActionTooltipContent>
        )}
      </Tooltip>
    </SidebarConversationOverlayContext.Provider>
  )
}

export function SidebarConversationPreviewTrigger({
  preview,
  ...props
}: Omit<ComponentProps<typeof HoverCardTrigger>, "handle" | "payload"> & {
  preview: SidebarConversationPreview
}) {
  const handles = useSidebarConversationOverlays()
  const generatedId = useId()
  const triggerId = props.id ?? generatedId
  const { preview: previewHandle, previewTriggerId } = handles
  useEffect(
    () => () => {
      // A detached popup outlives virtual rows. Only its owning trigger may close it.
      if (previewTriggerId.current === triggerId) previewHandle.close()
    },
    [previewHandle, previewTriggerId, triggerId]
  )
  return (
    <HoverCardTrigger
      handle={previewHandle}
      payload={preview}
      {...props}
      id={triggerId}
    />
  )
}
