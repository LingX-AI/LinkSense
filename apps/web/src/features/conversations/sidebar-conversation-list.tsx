import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import { SortableContext, type SortingStrategy } from "@dnd-kit/sortable"
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type { Conversation } from "@/api/contracts"

// The DnD coordinator keeps the complete task order. Native sortable geometry
// only needs mounted rows; full-history arrays otherwise multiply per-row work.
const stationaryStrategy: SortingStrategy = () => null

type SidebarConversationListProps = {
  conversations: readonly Conversation[]
  totalConversationCount?: number
  children: (conversation: Conversation, index: number) => ReactNode
}

export function SidebarConversationList(props: SidebarConversationListProps) {
  const ids = useMemo(
    () => props.conversations.map((conversation) => conversation.id),
    [props.conversations]
  )
  // Small sections don't need virtualizer observers or an extra scroll window.
  return (props.totalConversationCount ?? props.conversations.length) <= 40 ? (
    <SortableContext items={ids} strategy={stationaryStrategy}>
      {props.conversations.map(props.children)}
    </SortableContext>
  ) : (
    <VirtualSidebarConversationList {...props} />
  )
}

function VirtualSidebarConversationList({
  conversations,
  children,
}: SidebarConversationListProps) {
  "use no memo"
  // TanStack Virtual owns a mutable instance, as in the message virtualizer.
  const hostRef = useRef<HTMLDivElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [retainedConversationId, setRetainedConversationId] = useState<string>()
  const retainedIndex = conversations.findIndex(
    (conversation) => conversation.id === retainedConversationId
  )
  const getItemKey = useCallback(
    (index: number) => conversations[index].id,
    [conversations]
  )
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: conversations.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 32,
    getItemKey,
    gap: 2,
    overscan: 5,
    scrollMargin,
    // Let React batch the shared scroll-area and virtual-window updates.
    useFlushSync: false,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      // Keep the focused/menu/drag source mounted even after it scrolls away.
      return retainedIndex < 0
        ? indexes
        : [...new Set([...indexes, retainedIndex])].sort((a, b) => a - b)
    },
    directDomUpdates: true,
    directDomUpdatesMode: "position",
  })
  const setHost = useCallback(
    (element: HTMLDivElement | null) => {
      hostRef.current = element
      virtualizer.containerRef(element)
    },
    [virtualizer]
  )

  useLayoutEffect(() => {
    setScrollElement(
      hostRef.current?.closest<HTMLElement>(".sidebar-conversation-scroll") ??
        null
    )
  }, [])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !scrollElement) return
    const updateMargin = () => {
      setScrollMargin(
        host.getBoundingClientRect().top -
          scrollElement.getBoundingClientRect().top +
          scrollElement.scrollTop
      )
    }
    updateMargin()
    // Observe the shared content too: folding or loading an earlier group
    // changes this group's offset without resizing the viewport or this list.
    const observer = new ResizeObserver(updateMargin)
    observer.observe(scrollElement)
    if (scrollElement.firstElementChild)
      observer.observe(scrollElement.firstElementChild)
    return () => observer.disconnect()
  }, [conversations, scrollElement])

  const items = virtualizer.getVirtualItems()
  const sortableIds = items.map((item) => conversations[item.index].id)

  return (
    <SortableContext items={sortableIds} strategy={stationaryStrategy}>
      <div
        ref={setHost}
        role="list"
        className="sidebar-virtual-conversations relative w-full"
      >
        {items.map((item) => {
          const conversation = conversations[item.index]
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              data-sidebar-conversation-id={conversation.id}
              role="listitem"
              aria-posinset={item.index + 1}
              aria-setsize={conversations.length}
              className="absolute top-0 left-0 w-full"
              onFocusCapture={() => setRetainedConversationId(conversation.id)}
              onPointerDownCapture={() =>
                setRetainedConversationId(conversation.id)
              }
            >
              {children(conversation, item.index)}
            </div>
          )
        })}
      </div>
    </SortableContext>
  )
}
