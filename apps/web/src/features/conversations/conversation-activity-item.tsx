import { useId, useState, type ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import {
  useActivitySummary,
  type ActivitySummary,
} from "@/features/conversations/use-activity-summary"
import { cn } from "@/lib/utils"

export function ConversationActivityItem({
  summary,
  deferred = false,
  expandable = false,
  open,
  onOpenChange,
  className,
  detailClassName,
  capabilityName,
  children,
}: {
  summary: ActivitySummary
  deferred?: boolean
  expandable?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  detailClassName?: string
  capabilityName?: string
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)
  const previewId = useId()
  const displayed = useActivitySummary(summary, deferred)
  const canExpand = expandable && !displayed.thinking
  const resolvedOpen = canExpand && (open ?? internalOpen)
  // A held header must not keep showing a finished tool's command preview.
  const displayedDetail =
    displayed.key === summary.key ? displayed.detail : null
  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <Collapsible
      open={resolvedOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        "activity-item native-activity-collapsible",
        className,
        displayed.thinking && "live-reasoning-summary turn-thinking-activity"
      )}
      data-running={displayed.running || undefined}
      aria-busy={displayed.running || undefined}
    >
      <CollapsibleTrigger
        disabled={!canExpand}
        role={canExpand ? undefined : "presentation"}
        tabIndex={canExpand ? undefined : -1}
        className="native-activity-trigger group"
        aria-describedby={canExpand && displayedDetail ? previewId : undefined}
        aria-label={
          canExpand
            ? t(
                resolvedOpen
                  ? "conversation.nativeActivityDetails.collapse"
                  : "conversation.nativeActivityDetails.expand",
                { activity: displayed.label }
              )
            : undefined
        }
      >
        <Marker
          render={<span />}
          className="activity-item-main conversation-marker min-h-4 w-fit max-w-full"
          aria-busy={displayed.running || undefined}
          role={displayed.running ? "status" : undefined}
          aria-live={displayed.running ? "polite" : undefined}
          aria-atomic={displayed.running || undefined}
        >
          {displayed.icon && <MarkerIcon>{displayed.icon}</MarkerIcon>}
          <MarkerContent className="conversation-marker-content">
            <span
              className={cn(
                "native-activity-summary min-w-0 truncate",
                displayed.running && "shimmer"
              )}
            >
              <span>{displayed.label}</span>
              {displayedDetail && (
                <>
                  {" "}
                  <span id={previewId} className="native-activity-preview">
                    {displayedDetail}
                  </span>
                </>
              )}
            </span>
            {capabilityName &&
              !displayed.thinking &&
              displayed.key === summary.key && (
                <span className="trace-chip">{capabilityName}</span>
              )}
          </MarkerContent>
          {canExpand && (
            <MarkerIcon className="native-activity-chevron">
              <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
            </MarkerIcon>
          )}
        </Marker>
      </CollapsibleTrigger>
      {canExpand && (
        <CollapsibleContent
          className={cn("native-activity-details", detailClassName)}
        >
          <div className="native-activity-details-inner">{children}</div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}
