import { GitForkIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import type { ConversationForkSource } from "@/api/contracts"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"

export function ConversationForkSourceMarker({
  source,
}: {
  source: ConversationForkSource
}) {
  const { t } = useTranslation()

  if (!source.available) {
    const label = t("conversation.forkSource.unavailable")
    return (
      <Marker
        variant="separator"
        className="my-8 py-3 text-muted-foreground/55 before:bg-foreground/10 after:bg-foreground/10"
        data-slot="fork-source-marker"
        role="note"
        aria-label={label}
      >
        <MarkerIcon>
          <GitForkIcon className="size-[15px]" aria-hidden="true" />
        </MarkerIcon>
        <MarkerContent className="flex min-h-5 items-center text-[length:var(--app-font-13)] leading-none font-medium">
          {label}
        </MarkerContent>
      </Marker>
    )
  }

  const accessibleLabel = t("conversation.forkSource.openSourceTask", {
    title: source.title,
  })
  return (
    <Marker
      variant="separator"
      render={<Link to={`/conversations/${source.conversation_id}`} />}
      className="my-8 rounded-sm py-3 text-muted-foreground/70 !no-underline transition-colors before:bg-foreground/10 before:transition-colors after:bg-foreground/10 after:transition-colors hover:text-primary hover:before:bg-foreground/20 hover:after:bg-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
      data-slot="fork-source-marker"
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <MarkerIcon>
        <GitForkIcon className="size-[15px]" aria-hidden="true" />
      </MarkerIcon>
      <MarkerContent className="flex min-h-5 items-center text-[length:var(--app-font-13)] leading-none font-medium">
        {t("conversation.forkSource.continueFromChat")}
      </MarkerContent>
    </Marker>
  )
}
