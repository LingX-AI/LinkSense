import { GlobeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ConversationSource } from "@linksense/shared"
import { Button } from "@/components/ui/button"
import { DesignIcon } from "@/components/ui/design-icon"
import { TaskOverviewFileIcon } from "@/features/conversations/task-overview-file-icon"
import { resolveFileIconKind } from "@/lib/file-icons"

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
  const { t, i18n } = useTranslation()
  return (
    <section
      aria-label={t("conversation.taskOverview.sources")}
      className="flex min-h-0 flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm leading-[var(--app-line-22)] font-medium text-foreground">
          {t("conversation.taskOverview.sources")}
        </h3>
        <span className="text-xs leading-[var(--app-line-18)] font-normal text-(--app-task-overview-muted) tabular-nums">
          {sources.length.toLocaleString(i18n.resolvedLanguage)}
        </span>
      </div>
      {(!loading || sources.length > 0) && (
        <div
          className="h-auto max-h-[min(15rem,35dvh)] min-h-0 overflow-y-auto overscroll-contain"
          data-testid="conversation-sources-scroll"
        >
          {failed ? (
            <div role="alert" className="flex flex-col items-start gap-2 py-2">
              <p className="text-xs text-(--app-task-overview-muted)">
                {t("conversation.taskOverview.sourcesError")}
              </p>
              <Button variant="outline" size="sm" onClick={onRetry}>
                {t("common.retry")}
              </Button>
            </div>
          ) : sources.length === 0 ? (
            <p className="text-xs leading-[var(--app-line-18)] text-(--app-task-overview-muted)">
              {t("conversation.taskOverview.noSources")}
            </p>
          ) : null}
          {sources.length > 0 && (
            <ul className="flex min-w-0 flex-col gap-2">
              {sources.map((source) => {
                const url = new URL(source.url)
                const filename = url.pathname.split("/").at(-1) ?? ""
                const fileSource = resolveFileIconKind(filename) !== "unknown"
                return (
                  <li key={source.url} className="min-w-0">
                    <a
                      href={source.url}
                      aria-label={source.title ?? source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-14 min-w-0 items-center gap-2 rounded-lg border border-border bg-(--app-activity-surface) px-2 py-1.75 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center text-(--app-task-overview-icon)">
                        {fileSource ? (
                          <TaskOverviewFileIcon filename={filename} />
                        ) : (
                          <GlobeIcon
                            className="size-5"
                            strokeWidth={1.6}
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm leading-[var(--app-line-22)] font-medium text-foreground">
                          {source.title ?? source.url}
                        </span>
                        <span className="truncate text-xs leading-[var(--app-line-18)] text-(--app-task-overview-muted)">
                          {url.hostname}
                        </span>
                      </span>
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-(--app-task-overview-icon)">
                        <DesignIcon name="open-source" className="size-5" />
                      </span>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
