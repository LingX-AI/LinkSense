import { useCallback, useId, useState, type Ref } from "react"
import type { VirtualElement } from "@floating-ui/react-dom"
import { LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type {
  ConversationEvent,
  ConversationFile,
  NativeSubAgentSummary,
} from "@/api/contracts"
import { Button } from "@/components/ui/button"
import { DesignIcon } from "@/components/ui/design-icon"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { buildConversationTaskOverview } from "@/features/conversations/conversation-task-overview"
import { ConversationHeaderButton } from "@/features/conversations/conversation-header-button"
import {
  readTaskOverviewOpenPreference,
  writeTaskOverviewOpenPreference,
} from "@/features/conversations/conversation-task-overview-preference"
import { SubAgentIcon } from "@/features/conversations/subagent-icon"
import {
  ConversationSourcesList,
  type ConversationSourcesListProps,
} from "@/features/conversations/conversation-sources-list"
import { normalizeLanguage } from "@/i18n"
import { formatFileSize } from "@/i18n/date"
import { TaskOverviewFileIcon } from "@/features/conversations/task-overview-file-icon"
import { getTaskOverviewFileFormat } from "@/features/conversations/task-overview-file-format"

const maxVisibleSubAgentIcons = 10

type ConversationTaskOverviewPanelProps = {
  events: readonly ConversationEvent[]
  files: readonly ConversationFile[]
  defaultOpen?: boolean
  open?: boolean
  panelRef?: Ref<HTMLDivElement>
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
  open: controlledOpen,
  panelRef,
  subAgentSummariesByTurnId,
  downloadingFileId,
  onDownload,
  onOpenChange: onPanelOpenChange,
  sourcesState,
}: ConversationTaskOverviewPanelProps) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const triggerId = useId()
  const [anchor, setAnchor] = useState<VirtualElement | null>(null)
  const setTriggerAnchor = useCallback((trigger: HTMLButtonElement | null) => {
    setAnchor(
      trigger
        ? {
            getBoundingClientRect: () => {
              const header = trigger.closest(".conversation-top-bar")
              if (!header) return trigger.getBoundingClientRect()
              const bounds = header.getBoundingClientRect()
              return new DOMRect(
                bounds.left,
                bounds.bottom,
                Math.max(0, bounds.width - 28),
                0
              )
            },
            // Track the header during preview transitions, not the fixed-size button.
            contextElement: trigger.closest(".conversation-top-bar") ?? trigger,
          }
        : null
    )
  }, [])
  const [internalOpen, setOpen] = useState(
    () => defaultOpen ?? readTaskOverviewOpenPreference()
  )
  const open = controlledOpen ?? internalOpen
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
        ref={setTriggerAnchor}
        render={
          <ConversationHeaderButton
            className="aria-expanded:bg-transparent hover:aria-expanded:bg-hover"
            label={t(
              open
                ? "conversation.taskOverview.close"
                : "conversation.taskOverview.open"
            )}
          />
        }
      >
        <DesignIcon
          name="overview"
          className="size-[calc(var(--app-ui-font-size)+6px)]"
        />
      </PopoverTrigger>
      <PopoverContent
        ref={panelRef}
        anchor={anchor}
        role="region"
        aria-label={t("conversation.taskOverview.title")}
        initialFocus={false}
        align="end"
        side="bottom"
        sideOffset={24}
        className="task-overview-card-border task-overview-card-shadow max-h-[calc(100dvh-6rem)] w-80 max-w-[calc(100vw-1rem)] gap-5 overflow-y-auto overscroll-contain rounded-card p-4 shadow-none ring-0"
      >
        <PopoverTitle className="shrink-0 text-base leading-6 font-semibold text-foreground">
          {t("conversation.taskOverview.title")}
        </PopoverTitle>

        <div className="flex shrink-0 flex-col gap-5">
          {hasSubAgents ? (
            <>
              <section
                aria-label={t("conversation.taskOverview.subagents")}
                className="flex flex-col gap-2"
              >
                <p className="text-sm leading-[var(--app-line-22)] font-medium text-foreground">
                  {t("conversation.taskOverview.subagents")}
                </p>
                <div className="flex items-center gap-2 text-sm font-medium text-(--app-task-overview-muted)">
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
                      <span className="text-sm text-(--app-task-overview-muted) tabular-nums">
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

              <div className="h-px bg-border/70" />
            </>
          ) : null}

          <section
            aria-label={t("conversation.taskOverview.outputFiles")}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm leading-[var(--app-line-22)] font-medium text-foreground">
                {t("conversation.taskOverview.outputFiles")}
              </h3>
              <span className="text-xs leading-[var(--app-line-18)] font-normal text-(--app-task-overview-muted) tabular-nums">
                {overview.outputFiles.length.toLocaleString(language)}
              </span>
            </div>
            {overview.outputFiles.length > 0 ? (
              <div className="flex flex-col gap-2">
                {overview.outputFiles.map((file) => {
                  const downloading = downloadingFileId === file.id
                  const fileType = getTaskOverviewFileFormat(
                    file.name,
                    file.mime_type
                  )
                  return (
                    <Button
                      key={file.id}
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-14 w-full justify-start gap-2 rounded-lg border border-border bg-(--app-activity-surface) px-2 py-1.75 text-left text-sm hover:bg-hover"
                      aria-label={t("conversation.downloadArtifact", {
                        name: file.name,
                      })}
                      disabled={
                        !file.download_available || Boolean(downloadingFileId)
                      }
                      onClick={() => onDownload(file)}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center">
                        <TaskOverviewFileIcon
                          filename={file.name}
                          mimeType={file.mime_type}
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate leading-[var(--app-line-22)] font-medium text-foreground">
                          {file.name}
                        </span>
                        <span className="truncate text-xs leading-[var(--app-line-18)] font-normal text-(--app-task-overview-muted)">
                          {fileType && <>{fileType} · </>}
                          {formatFileSize(file.size, language)}
                        </span>
                      </span>
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-(--app-task-overview-icon)">
                        {downloading ? (
                          <LoaderCircleIcon
                            className="size-5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <DesignIcon name="download" className="size-5" />
                        )}
                      </span>
                    </Button>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs leading-[var(--app-line-18)] text-(--app-task-overview-muted)">
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
