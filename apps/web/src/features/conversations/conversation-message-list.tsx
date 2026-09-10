import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ConversationHistoryControl } from "@/features/conversations/use-conversation-history"
import { useVisibleConversationMessages } from "@/features/conversations/use-visible-conversation-messages"

export type { ConversationHistoryControl } from "@/features/conversations/use-conversation-history"

export type ConversationMessageRow = {
  key: string
  messageIds: string[]
  turnId?: string
  loaded?: boolean
  render: () => ReactNode
}

export type ConversationThreadNavigation = {
  scrollToMessage: (messageId: string) => boolean
  scrollToLatest: (behavior: ScrollBehavior) => boolean
}

type MessageListProps = {
  rows: ConversationMessageRow[]
  navigationRef?: Ref<ConversationThreadNavigation>
  onVisibleMessageChange?: (ids: string[]) => void
  history?: ConversationHistoryControl
  pinnedMessageId?: string | null
}

export function ConversationMessageList(props: MessageListProps) {
  return props.history || props.rows.length > 30 ? (
    <VirtualMessageList {...props} />
  ) : (
    <StaticMessageList {...props} />
  )
}

function StaticMessageList({
  rows,
  navigationRef,
  onVisibleMessageChange,
}: MessageListProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(
    navigationRef,
    () => ({ scrollToMessage: () => false, scrollToLatest: () => false }),
    []
  )
  useVisibleConversationMessages({ hostRef, onVisibleMessageChange })
  return (
    <div ref={hostRef}>
      {rows.map((row) => (
        <div
          key={row.key}
          className="flow-root"
          data-conversation-row={row.key}
          data-message-ids={row.messageIds.join(" ")}
        >
          {row.render()}
        </div>
      ))}
    </div>
  )
}

function VirtualMessageList({
  rows,
  navigationRef,
  onVisibleMessageChange,
  history,
  pinnedMessageId,
}: MessageListProps) {
  "use no memo"
  // TanStack Virtual exposes a mutable instance; React Compiler must not memoize it.
  const hostRef = useRef<HTMLDivElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [scrollPaddingStart, setScrollPaddingStart] = useState(0)
  const getItemKey = useCallback((index: number) => rows[index].key, [rows])
  const pinnedIndex = pinnedMessageId
    ? rows.findIndex((row) => row.messageIds.includes(pinnedMessageId))
    : -1
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 420,
    getItemKey,
    overscan: 3,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      return pinnedIndex < 0
        ? indexes
        : [...new Set([...indexes, pinnedIndex])].sort((a, b) => a - b)
    },
    anchorTo: "end",
    scrollMargin,
    scrollPaddingStart,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
  })
  useLayoutEffect(() => {
    const host = hostRef.current
    const scroller = host?.closest<HTMLElement>(".conversation-scroll")
    if (!host || !scroller) return
    setScrollElement(scroller)
    const header = scroller
      .closest(".conversation-workspace")
      ?.querySelector(".conversation-top-bar")
    const updateMargin = () => {
      setScrollMargin(
        host.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop
      )
      setScrollPaddingStart(
        Math.max(
          0,
          (header?.getBoundingClientRect().bottom ?? 0) -
            scroller.getBoundingClientRect().top
        )
      )
    }
    updateMargin()
    const observer = new ResizeObserver(updateMargin)
    observer.observe(scroller)
    if (header) observer.observe(header)
    return () => observer.disconnect()
  }, [])
  useImperativeHandle(
    navigationRef,
    () => ({
      scrollToMessage: (id) => {
        const index = rows.findIndex((row) => row.messageIds.includes(id))
        if (index < 0) return false
        virtualizer.scrollToIndex(index, { align: "start", behavior: "auto" })
        return true
      },
      scrollToLatest: (behavior) => {
        if (!scrollElement || !rows.length) return false
        virtualizer.scrollToEnd({ behavior })
        return true
      },
    }),
    [rows, scrollElement, virtualizer]
  )
  useVisibleConversationMessages({
    hostRef,
    onVisibleMessageChange,
    loadTurn: history?.loadTurn,
  })
  return (
    <div
      ref={hostRef}
      className="relative w-full"
      data-testid="conversation-virtual-list"
    >
      <div
        // Commit height before restoring the anchor, so a large prepend cannot be
        // clamped to the old container's maximum scroll position.
        ref={(element) => virtualizer.containerRef(element)}
        className="relative w-full"
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 flow-root w-full"
              data-conversation-row={row.key}
              data-message-ids={row.messageIds.join(" ")}
              data-turn-id={row.turnId}
              data-loaded={row.loaded !== false}
            >
              {row.loaded === false && row.turnId && history ? (
                <ConversationHistoryPlaceholder
                  turnId={row.turnId}
                  history={history}
                />
              ) : (
                row.render()
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ConversationHistoryPlaceholder({
  turnId,
  history,
}: {
  turnId: string
  history: ConversationHistoryControl
}) {
  const { t } = useTranslation()
  const failed = history.failedTurnIds.has(turnId)
  return (
    <div className="flex h-[420px] flex-col gap-6 py-8" aria-busy={!failed}>
      <Skeleton className="h-10 w-2/5 self-end" />
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-5 w-3/5" />
      <div className="flex justify-center" role="status">
        {failed ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void history.loadTurn(turnId, true)}
          >
            {t("conversation.historyRetry")}
          </Button>
        ) : (
          t("conversation.historyLoading")
        )}
      </div>
    </div>
  )
}
