import { useId, useState, type SVGProps } from "react"
import { DownloadIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type {
  ConversationEvent,
  ConversationFile,
  NativeSubAgentSummary,
} from "@/api/contracts"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { buildConversationTaskOverview } from "@/features/conversations/conversation-task-overview"
import {
  readTaskOverviewOpenPreference,
  writeTaskOverviewOpenPreference,
} from "@/features/conversations/conversation-task-overview-preference"
import { SubAgentIcon } from "@/features/conversations/subagent-icon"
import {
  ConversationSourcesList,
  type ConversationSourcesListProps,
} from "@/features/conversations/conversation-sources-list"

const maxVisibleSubAgentIcons = 10

function TaskOverviewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="7.5" cy="8" r="1.35" strokeWidth="1.65" />
      <path d="M12 8h5.5" strokeWidth="1.65" />
      <circle cx="7.5" cy="16" r="1.35" strokeWidth="1.65" />
      <path d="M12 16h5.5" strokeWidth="1.65" />
    </svg>
  )
}

type ConversationTaskOverviewPanelProps = {
  events: readonly ConversationEvent[]
  files: readonly ConversationFile[]
  defaultOpen?: boolean
  subAgentSummariesByTurnId?: ReadonlyMap<
    string,
    readonly NativeSubAgentSummary[]
  >
  downloadingFileId?: string
  onDownload: (file: ConversationFile) => void
  onOpenChange?: (open: boolean) => void
  sourcesState?: ConversationSourcesListProps
}

export function ConversationTaskOverviewPanel({
  events,
  files,
  defaultOpen,
  subAgentSummariesByTurnId,
  downloadingFileId,
  onDownload,
  onOpenChange: onPanelOpenChange,
  sourcesState,
}: ConversationTaskOverviewPanelProps) {
  const { t } = useTranslation()
  const triggerId = useId()
  const [open, setOpen] = useState(
    () => defaultOpen ?? readTaskOverviewOpenPreference()
  )
  const overview = buildConversationTaskOverview({
    events,
    files,
    summaries: [...(subAgentSummariesByTurnId?.values() ?? [])].flat(),
  })
  const hasSubAgents = overview.subAgentCount > 0

  return (
    <Popover
      open={open}
      modal={false}
      triggerId={triggerId}
      onOpenChange={(nextOpen, eventDetails) => {
        if (eventDetails.reason === "trigger-press") {
          setOpen(nextOpen)
          writeTaskOverviewOpenPreference(nextOpen)
          onPanelOpenChange?.(nextOpen)
          return
        }
        eventDetails.cancel()
      }}
    >
      <PopoverTrigger
        id={triggerId}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t(
              open
                ? "conversation.taskOverview.close"
                : "conversation.taskOverview.open"
            )}
          />
        }
      >
        <TaskOverviewIcon className="size-5 text-foreground/55" />
      </PopoverTrigger>
      <PopoverContent
        role="region"
        aria-label={t("conversation.taskOverview.title")}
        initialFocus={false}
        align="end"
        side="bottom"
        sideOffset={28}
        className="task-overview-card-border task-overview-card-shadow max-h-[calc(100dvh-6rem)] w-[min(18.5rem,calc(100vw-1rem))] gap-0 overflow-y-auto rounded-[1.35rem] p-0 shadow-none ring-0"
      >
        <div className="px-4 pt-4 pb-2">
          <PopoverTitle className="text-sm font-semibold text-foreground">
            {t("conversation.taskOverview.title")}
          </PopoverTitle>
        </div>

        <div className="flex flex-col">
          {hasSubAgents ? (
            <>
              <section
                aria-label={t("conversation.taskOverview.subagents")}
                className="px-4 py-3"
              >
                <p className="text-sm font-medium text-muted-foreground">
                  {t("conversation.taskOverview.subagents")}
                </p>
                <div className="mt-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1">
                    {overview.subAgents
                      .slice(0, maxVisibleSubAgentIcons)
                      .map((agent) => (
                        <SubAgentIcon
                          key={agent.id}
                          ordinal={agent.ordinal}
                          className="size-4"
                        />
                      ))}
                    {overview.subAgentCount > maxVisibleSubAgentIcons ? (
                      <span className="text-sm text-muted-foreground tabular-nums">
                        +{overview.subAgentCount - maxVisibleSubAgentIcons}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">
                    {t("conversation.taskOverview.subagentsProgress", {
                      completed: overview.subAgentCompletedCount,
                      count: overview.subAgentCount,
                    })}
                  </span>
                </div>
              </section>

              <div className="mx-4 h-px bg-border/70" />
            </>
          ) : null}

          <section
            aria-label={t("conversation.taskOverview.outputFiles")}
            className="px-4 py-3"
          >
            <p className="text-sm font-medium text-muted-foreground">
              {t("conversation.taskOverview.outputFiles")}
            </p>
            {overview.outputFiles.length > 0 ? (
              <div className="mt-2 flex max-h-52 flex-col gap-0 overflow-y-auto">
                {overview.outputFiles.map((file) => {
                  const downloading = downloadingFileId === file.id
                  return (
                    <Button
                      key={file.id}
                      type="button"
                      variant="ghost"
                      className="h-8 w-full justify-start gap-2 rounded-lg px-1.5 text-left text-sm hover:bg-hover"
                      aria-label={t("conversation.downloadArtifact", {
                        name: file.name,
                      })}
                      disabled={
                        !file.download_available || Boolean(downloadingFileId)
                      }
                      onClick={() => onDownload(file)}
                    >
                      <FileTypeIcon
                        filename={file.name}
                        mimeType={file.mime_type}
                        className="size-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground/80">
                        {file.name}
                      </span>
                      {downloading ? (
                        <LoaderCircleIcon
                          className="size-3.5 animate-spin text-muted-foreground"
                          aria-hidden="true"
                        />
                      ) : (
                        <DownloadIcon
                          className="size-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </Button>
                  )
                })}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground/80">
                {t("conversation.taskOverview.noOutputFiles")}
              </p>
            )}
          </section>
          <ConversationSourcesList
            sources={sourcesState?.sources ?? []}
            loading={sourcesState?.loading}
            failed={sourcesState?.failed}
            onRetry={sourcesState?.onRetry}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
