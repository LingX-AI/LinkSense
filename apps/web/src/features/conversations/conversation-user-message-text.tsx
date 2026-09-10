import { useId, useLayoutEffect, useRef, useState } from "react"
import { ChevronDownIcon, ChevronUpIcon, GlobeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { getConversationComposerInputSegments } from "@/features/conversations/conversation-composer-url-highlighting"
import { cn } from "@/lib/utils"

const collapsedLineCount = 15

export function ConversationUserMessageText({ content }: { content: string }) {
  const { t } = useTranslation()
  const contentId = useId()
  const contentRef = useRef<HTMLParagraphElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const segments = getConversationComposerInputSegments(content)

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
      const bounds = element.getBoundingClientRect()
      if (bounds.width > 0 && Number.isFinite(lineHeight)) {
        setOverflowing(bounds.height > lineHeight * collapsedLineCount + 1)
      }
    }
    measure()
    // Observe the unclipped paragraph so wrapping and font changes are measured
    // even while its parent is limited to fifteen lines.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [content])

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

  const collapsed = overflowing && !expanded
  const toggleLabel = t(
    expanded ? "conversation.showLess" : "conversation.showMore"
  )

  return (
    <div className="min-w-0">
      <div
        className={cn(
          collapsed &&
            "max-h-[15lh] overflow-hidden mask-b-from-80% mask-b-to-100%"
        )}
      >
        {text}
      </div>
      {overflowing && (
        <div className="-mb-1 flex justify-start pt-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="-ml-2 text-muted-foreground hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground"
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            {toggleLabel}
            {expanded ? (
              <ChevronUpIcon data-icon="inline-end" aria-hidden="true" />
            ) : (
              <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
