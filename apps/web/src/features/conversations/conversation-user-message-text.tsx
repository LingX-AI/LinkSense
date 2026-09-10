import { useId, useLayoutEffect, useRef, useState } from "react"
import { ChevronDownIcon, ChevronUpIcon, GlobeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { getConversationComposerInputSegments } from "@/features/conversations/conversation-composer-url-highlighting"
import { cn } from "@/lib/utils"

export function ConversationUserMessageText({
  content,
  collapsible = false,
}: {
  content: string
  collapsible?: boolean
}) {
  const { t } = useTranslation()
  const contentId = useId()
  const contentRef = useRef<HTMLParagraphElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const segments = getConversationComposerInputSegments(content)

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!collapsible || !element) return
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
      const bounds = element.getBoundingClientRect()
      if (bounds.width > 0 && Number.isFinite(lineHeight)) {
        setOverflowing(bounds.height > lineHeight * 5 + 1)
      }
    }
    measure()
    // Observe the unclipped paragraph so wrapping and font changes are measured
    // even while its parent is limited to five lines.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [collapsible, content])

  const text = (
    <p ref={contentRef} id={contentId} className="whitespace-pre-wrap">
      {segments.map((segment) =>
        segment.kind === "url" ? (
          <span
            key={`${segment.start}-${segment.end}`}
            className="user-message-url"
            data-user-message-url={segment.value}
          >
            <GlobeIcon className="user-message-url-icon" aria-hidden="true" />
            {segment.value}
          </span>
        ) : (
          <span key={`${segment.start}-${segment.end}`}>{segment.value}</span>
        )
      )}
    </p>
  )

  if (!collapsible) return text
  const collapsed = overflowing && !expanded
  const toggleLabel = t(
    expanded ? "conversation.collapseMessage" : "conversation.expandMessage"
  )

  return (
    <div className="min-w-0">
      <div
        className={cn(
          !expanded && "max-h-[5lh] overflow-hidden",
          collapsed && "mask-b-from-70% mask-b-to-100%"
        )}
      >
        {text}
      </div>
      {overflowing && (
        <div className="-my-1 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground"
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronUpIcon data-icon="inline-start" aria-hidden="true" />
            ) : (
              <ChevronDownIcon data-icon="inline-start" aria-hidden="true" />
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
