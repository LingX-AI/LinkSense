import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ScrollArea } from "@base-ui/react/scroll-area"
import { LightbulbIcon, ChevronRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Marker, MarkerIcon } from "@/components/ui/marker"
import { ReasoningSummaryMarkdown } from "@/features/conversations/reasoning-summary-markdown"
import { extractReasoningActivityText } from "@/features/conversations/reasoning-activity-summary"
import { useConversationScroll } from "@/features/conversations/use-conversation-scroll"
import { cn } from "@/lib/utils"

export function ReasoningActivity({
  content,
  turnRunning,
  running = false,
  streaming = false,
  shimmer = false,
  live = false,
  capabilityName,
}: Readonly<{
  content: string
  turnRunning: boolean
  running?: boolean
  streaming?: boolean
  shimmer?: boolean
  live?: boolean
  capabilityName?: string
}>) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const reasoningId = useId()
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const disclosureRef = useRef<HTMLButtonElement>(null)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const { scrollContainerRef, contentRef, scrollToBottom, pauseAutoFollow } =
    useConversationScroll(reasoningId, {
      interactionRef: scrollAreaRef,
      followBehavior: turnRunning ? "smooth" : "auto",
    })

  const registerViewport = useCallback(
    (element: HTMLDivElement | null) => {
      viewportRef.current = element
      scrollContainerRef(element)
      setViewport(element)
    },
    [scrollContainerRef]
  )
  const preview = useMemo(
    () =>
      expanded
        ? null
        : extractReasoningActivityText(content, turnRunning ? "last" : "first"),
    [content, turnRunning, expanded]
  )

  useLayoutEffect(() => {
    if (!viewport) return
    if (turnRunning) {
      scrollToBottom("auto")
    } else {
      pauseAutoFollow()
      if (viewportRef.current) viewportRef.current.scrollTop = 0
    }
  }, [viewport, turnRunning, pauseAutoFollow, scrollToBottom])

  return (
    <div className="reasoning-activity w-full min-w-0">
      <Marker
        className={cn(
          "activity-item native-activity-item conversation-marker reasoning-activity-row w-full min-w-0 pr-2",
          live && "live-reasoning-summary"
        )}
        data-expanded={expanded}
        data-running={running || undefined}
        aria-busy={running || undefined}
        role={running ? "status" : undefined}
        aria-live={running ? "polite" : undefined}
        aria-atomic={running ? "false" : undefined}
      >
        {live && (
          <span className="sr-only">{t("conversation.currentActivity")}</span>
        )}
        <MarkerIcon className="reasoning-activity-icon">
          <LightbulbIcon className="size-4" aria-hidden="true" />
        </MarkerIcon>
        <div className="conversation-marker-content reasoning-activity-content">
          <div
            id={reasoningId}
            role="region"
            aria-label={t("conversation.reasoningActivity.label")}
            className="reasoning-activity-panel"
          >
            {!expanded ? (
              <Button
                variant="plain"
                className="h-auto w-full min-w-0 justify-start rounded-none border-0 p-0 text-left text-[length:inherit] leading-[inherit] text-inherit"
                aria-controls={reasoningId}
                aria-expanded={false}
                onClick={() => {
                  setExpanded(true)
                  disclosureRef.current?.focus()
                }}
              >
                <span
                  className={cn(
                    "reasoning-activity-preview m-0 min-w-0 truncate",
                    shimmer && "shimmer"
                  )}
                >
                  {preview ?? t("conversation.reasoningActivity.label")}
                </span>
              </Button>
            ) : (
              <ScrollArea.Root
                ref={scrollAreaRef}
                className="relative w-full min-w-0 overflow-hidden"
              >
                <ScrollArea.Viewport
                  ref={registerViewport}
                  className="reasoning-activity-viewport max-h-[min(20rem,40dvh)] min-w-0 overflow-x-hidden! overflow-y-auto! overscroll-contain [overflow-anchor:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <ScrollArea.Content
                    ref={contentRef}
                    className="min-w-0! pr-3"
                  >
                    <ReasoningSummaryMarkdown
                      content={content}
                      className={cn(
                        live
                          ? "live-reasoning-summary-text"
                          : "native-activity-summary",
                        shimmer && "shimmer"
                      )}
                      streaming={streaming}
                    />
                  </ScrollArea.Content>
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar className="absolute inset-y-0 right-0 flex w-[var(--app-scrollbar-size)] touch-none opacity-0 transition-opacity duration-300 select-none hover:opacity-100 has-[:active]:opacity-100 data-[scrolling]:opacity-100 motion-reduce:transition-none">
                  <ScrollArea.Thumb className="w-full rounded-[var(--app-scrollbar-radius)] bg-[var(--app-scrollbar-thumb)] hover:bg-[var(--app-scrollbar-thumb-hover)]" />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
            )}
          </div>
          {capabilityName && (
            <span className="trace-chip">{capabilityName}</span>
          )}
        </div>
        <Button
          ref={disclosureRef}
          variant="plain"
          size="icon-xs"
          className="reasoning-activity-trigger group mt-[calc(6px+(var(--app-ui-copy-line-height)-24px)/2)]"
          aria-controls={reasoningId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          aria-label={t(
            expanded
              ? "conversation.reasoningActivity.collapse"
              : "conversation.reasoningActivity.expand"
          )}
        >
          <ChevronRightIcon
            className="transition-transform group-aria-expanded:rotate-90"
            aria-hidden="true"
          />
        </Button>
      </Marker>
    </div>
  )
}
