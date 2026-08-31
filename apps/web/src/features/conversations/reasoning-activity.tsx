import { useState } from "react"
import { BrainIcon, ChevronRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerIcon } from "@/components/ui/marker"
import { ReasoningSummaryMarkdown } from "@/features/conversations/reasoning-summary-markdown"
import { cn } from "@/lib/utils"

export function ReasoningActivity({
  content,
  running = false,
  streaming = false,
  live = false,
  capabilityName,
}: Readonly<{
  content: string
  running?: boolean
  streaming?: boolean
  live?: boolean
  capabilityName?: string
}>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="reasoning-activity-collapsible"
    >
      <Marker
        className={cn(
          "activity-item native-activity-item conversation-marker reasoning-activity-row",
          live && "live-reasoning-summary"
        )}
        data-open={open}
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
          <BrainIcon className="size-3.5" aria-hidden="true" />
        </MarkerIcon>
        <div className="conversation-marker-content reasoning-activity-content">
          {!open && (
            <span className="reasoning-activity-collapsed-label">
              {t("conversation.reasoningActivity.label")}
            </span>
          )}
          <CollapsibleContent className="reasoning-activity-panel">
            <ReasoningSummaryMarkdown
              content={content}
              className={cn(
                live
                  ? "live-reasoning-summary-text"
                  : "native-activity-summary",
                running && "shimmer"
              )}
              streaming={streaming}
            />
          </CollapsibleContent>
          {capabilityName && (
            <span className="trace-chip">{capabilityName}</span>
          )}
        </div>
        <CollapsibleTrigger
          className="reasoning-activity-trigger group"
          aria-label={t(
            open
              ? "conversation.reasoningActivity.collapse"
              : "conversation.reasoningActivity.expand"
          )}
        >
          <ChevronRightIcon
            className="size-3.5 transition-transform group-data-panel-open:rotate-90"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
      </Marker>
    </Collapsible>
  )
}
