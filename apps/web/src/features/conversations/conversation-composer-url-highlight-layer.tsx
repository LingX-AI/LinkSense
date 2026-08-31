import { forwardRef } from "react"
import { GlobeIcon } from "lucide-react"

import type { ConversationComposerInputSegment } from "@/features/conversations/conversation-composer-url-highlighting"
import { cn } from "@/lib/utils"

export const ConversationComposerUrlHighlightLayer = forwardRef<
  HTMLDivElement,
  Readonly<{ segments: readonly ConversationComposerInputSegment[] }>
>(function ConversationComposerUrlHighlightLayer({ segments }, ref) {
  const hasLeadingUrl = segments[0]?.kind === "url"

  return (
    <div
      ref={ref}
      className={cn(
        "composer-input-highlight",
        hasLeadingUrl && "composer-input-highlight-leading-url"
      )}
      data-testid="composer-url-highlights"
      aria-hidden="true"
    >
      {segments.map((segment) => {
        if (segment.kind === "text") {
          return (
            <span key={`${segment.start}-${segment.end}`}>{segment.value}</span>
          )
        }

        const hasLeadingIcon = segment.start === 0
        return (
          <span
            key={`${segment.start}-${segment.end}`}
            className={cn(
              "composer-url-highlight",
              hasLeadingIcon && "composer-url-highlight-leading"
            )}
            data-url-highlight={segment.value}
          >
            {hasLeadingIcon && (
              <GlobeIcon
                className="composer-url-highlight-icon"
                aria-hidden="true"
              />
            )}
            {segment.value}
          </span>
        )
      })}
    </div>
  )
})
