import { ExternalLinkIcon, LinkIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ConversationSource } from "@linksense/shared"
import { Button } from "@/components/ui/button"

export type ConversationSourcesListProps = {
  sources: readonly ConversationSource[]
  loading?: boolean
  failed?: boolean
  onRetry?: () => void
}

export function ConversationSourcesList({
  sources,
  loading,
  failed,
  onRetry,
}: ConversationSourcesListProps) {
  const { t } = useTranslation()
  return (
    <section
      aria-label={t("conversation.taskOverview.sources")}
      className="flex min-h-0 flex-col px-4 py-3"
    >
      <p className="text-sm font-medium text-muted-foreground">
        {t("conversation.taskOverview.sources")}
      </p>
      {(!loading || sources.length > 0) && (
        <div
          className="mt-2 h-auto max-h-[min(15rem,35dvh)] min-h-0 overflow-y-auto overscroll-contain"
          data-testid="conversation-sources-scroll"
        >
          {failed ? (
            <div role="alert" className="flex flex-col items-start gap-2 py-2">
              <p className="text-xs text-muted-foreground">
                {t("conversation.taskOverview.sourcesError")}
              </p>
              <Button variant="outline" size="sm" onClick={onRetry}>
                {t("common.retry")}
              </Button>
            </div>
          ) : sources.length === 0 ? (
            <p className="text-xs text-muted-foreground/80">
              {t("conversation.taskOverview.noSources")}
            </p>
          ) : null}
          {sources.length > 0 && (
            <ul className="flex min-w-0 flex-col gap-0">
              {sources.map((source) => (
                <li key={source.url} className="min-w-0">
                  <a
                    href={source.url}
                    aria-label={source.title ?? source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <LinkIcon
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/80">
                      {source.title ?? source.url}
                    </span>
                    <ExternalLinkIcon
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
