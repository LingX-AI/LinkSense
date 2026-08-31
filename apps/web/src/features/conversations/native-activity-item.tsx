import { useState } from "react"
import { ChevronRightIcon, FilePenLineIcon, SearchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationFile, NativeCodexItem } from "@/api/contracts"
import {
  ImagePreviewDialog,
  type ImagePreviewItem,
} from "@/components/media/image-preview"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import {
  buildNativeActivityViewModel,
  buildNativeToolGroupViewModel,
  type NativeCommandActivity,
  type NativeActivityViewModel,
  type NativeLifecycleMethod,
  type NativeToolActivity,
} from "@/features/conversations/native-activity-view-model"
import { shouldDisplayNativeActivity } from "@/features/conversations/activity-visibility"
import { NativeActivityIcon } from "@/features/conversations/native-activity-icon"
import {
  AssistantMarkdownImage,
  type LoadArtifactPreview,
} from "@/features/conversations/assistant-markdown-image"
import type {
  NativeSubAgentActivityViewModel,
  NativeSubAgentDisplayStatus,
  NativeSubAgentViewModel,
} from "@/features/conversations/native-subagent-activity"
import { nativeSubAgentGroupStatus } from "@/features/conversations/native-subagent-activity"
import { SubAgentIcon } from "@/features/conversations/subagent-icon"
import { cn } from "@/lib/utils"

function formatDuration(durationMs: number, locale: string) {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`
  return (
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: 1,
    }).format(durationMs / 1_000) + " s"
  )
}

function translatedValue(
  translate: (key: string) => string,
  key: string,
  fallback: string
) {
  const translated = translate(key)
  return translated === key ? fallback : translated
}

function NativeActivityDetails({
  model,
  imageFile,
  imageFileId,
  loadArtifactPreview,
  onPreviewImage,
}: {
  model: NativeActivityViewModel
  imageFile?: ConversationFile
  imageFileId?: string
  loadArtifactPreview?: LoadArtifactPreview
  onPreviewImage?: (item: ImagePreviewItem) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const [activeImagePreview, setActiveImagePreview] =
    useState<ImagePreviewItem | null>(null)

  return (
    <>
      {model.commands.length > 0 && (
        <ol
          className="native-activity-detail-lines native-command-detail-lines"
          aria-label={t("conversation.nativeActivityDetails.commands")}
        >
          {model.commands.map((command, index) => (
            <li
              key={`${index}-${command}`}
              className="native-command-detail-item"
            >
              <code>{command}</code>
            </li>
          ))}
        </ol>
      )}
      {model.fileChanges.length > 0 && (
        <ol
          className="native-activity-detail-lines"
          aria-label={t("conversation.nativeActivityDetails.fileChanges")}
        >
          {model.fileChanges.map((change) => {
            const changeKey = `conversation.nativeActivityDetails.fileKinds.${change.kind}`
            return (
              <li key={`${change.kind}-${change.path ?? "no-path"}`}>
                <FilePenLineIcon className="size-3.5" aria-hidden="true" />
                <span>
                  {translatedValue(t, changeKey, change.kind)}
                  {change.path && (
                    <>
                      {" "}
                      <code>{change.path}</code>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {model.searchQueries.length > 0 && (
        <ol
          className="native-activity-detail-lines"
          aria-label={t("conversation.nativeActivityDetails.queries")}
        >
          {model.searchQueries.map((query) => (
            <li key={query}>
              <SearchIcon className="size-3.5" aria-hidden="true" />
              <code>{query}</code>
            </li>
          ))}
        </ol>
      )}
      {model.detailRows.length > 0 && (
        <dl className="native-activity-detail-grid">
          {model.detailRows.map((row, index) => (
            <div className="contents" key={`${row.labelKey}-${index}`}>
              <dt>{t(row.labelKey)}</dt>
              <dd>
                {row.kind === "duration" ? (
                  formatDuration(row.value, locale)
                ) : row.kind === "translation" ? (
                  translatedValue(t, row.valueKey, row.fallback)
                ) : row.code ? (
                  <code>{row.value}</code>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {imageFileId && imageFile && loadArtifactPreview && (
        <>
          <div className="native-activity-image-preview">
            <AssistantMarkdownImage
              source={`linksense-artifact:${imageFileId}`}
              alt={imageFile.name}
              file={imageFile}
              loadPreview={loadArtifactPreview}
              className="native-activity-image-preview-image"
              previewTriggerClassName="native-activity-image-preview-trigger"
              placeholderClassName="assistant-inline-image-thumbnail-placeholder"
              onPreview={(source) => {
                const previewItem = {
                  id: imageFile.id,
                  name: imageFile.name,
                  src: source.url,
                  alt: imageFile.name,
                  downloadable: imageFile.download_available,
                }
                if (onPreviewImage) {
                  onPreviewImage(previewItem)
                  return
                }
                setActiveImagePreview(previewItem)
              }}
            />
          </div>
          {!onPreviewImage && (
            <ImagePreviewDialog
              items={activeImagePreview ? [activeImagePreview] : []}
              activeId={activeImagePreview?.id ?? null}
              onActiveIdChange={(id) => {
                if (id === null) setActiveImagePreview(null)
              }}
            />
          )}
        </>
      )}
    </>
  )
}

function nativeSubAgentStatusKey(status: NativeSubAgentDisplayStatus) {
  return `conversation.subAgentActivities.status.${status}`
}

export function NativeSubAgentActivityGroup({
  activities,
  stopped = false,
  selectedAgentId,
  onAgentSelect,
}: {
  activities: readonly NativeSubAgentActivityViewModel[]
  stopped?: boolean
  selectedAgentId?: string
  onAgentSelect?: (agent: NativeSubAgentViewModel) => void
}) {
  const { t } = useTranslation()
  const agentsById = new Map<string, NativeSubAgentViewModel>()
  for (const activity of activities) {
    for (const agent of activity.agents) agentsById.set(agent.id, agent)
  }
  const agents = [...agentsById.values()]
  const agentCount = agents.length
  const status = nativeSubAgentGroupStatus(agents.map((agent) => agent.status))
  const running = !stopped && activities.some((activity) => activity.running)
  const statusLabel = t(nativeSubAgentStatusKey(status))

  if (agentCount === 0) return null

  return (
    <Marker
      className="activity-item native-activity-item native-subagent-activity native-subagent-activity-group conversation-marker"
      data-running={running || undefined}
      data-subagent-count={agentCount}
      data-subagent-status={status}
      aria-busy={running || undefined}
    >
      <MarkerContent className="conversation-marker-content native-subagent-activity-content">
        <span
          className="native-subagent-activity-list inline-flex min-w-0 flex-wrap items-center"
          role="group"
          aria-live="polite"
          aria-label={t("conversation.subAgentActivities.agentList", {
            count: agentCount,
          })}
        >
          {agents.map((agent) => {
            const agentName =
              agent.label ??
              t("conversation.subAgentActivities.agentFallback", {
                number: agent.ordinal,
              })
            const selected = selectedAgentId === agent.id
            return (
              <span className="native-subagent-activity-segment" key={agent.id}>
                <span
                  className="native-subagent-agent-entry"
                  data-subagent-status={agent.status}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => onAgentSelect?.(agent)}
                    className="native-subagent-agent h-7 max-w-full shrink gap-1.5 rounded-full bg-transparent px-2.5 shadow-none hover:bg-transparent"
                    data-selected={selected || undefined}
                    title={agentName}
                    aria-pressed={selected}
                    aria-label={t("conversation.subAgentActivities.openAgent", {
                      name: agentName,
                    })}
                  >
                    <SubAgentIcon ordinal={agent.ordinal} />
                    <span
                      data-slot="subagent-agent-name"
                      className="truncate font-medium"
                    >
                      {agentName}
                    </span>
                  </Button>
                </span>
              </span>
            )
          })}
          <span
            data-slot="subagent-group-status"
            className="native-subagent-status"
          >
            {statusLabel}
          </span>
        </span>
      </MarkerContent>
    </Marker>
  )
}

export function NativeSubAgentActivityItem({
  activity,
  stopped = false,
  selectedAgentId,
  onAgentSelect,
}: {
  activity: NativeSubAgentActivityViewModel
  stopped?: boolean
  selectedAgentId?: string
  onAgentSelect?: (agent: NativeSubAgentViewModel) => void
}) {
  return (
    <NativeSubAgentActivityGroup
      activities={[activity]}
      stopped={stopped}
      selectedAgentId={selectedAgentId}
      onAgentSelect={onAgentSelect}
    />
  )
}

export function NativeActivityItem({
  item,
  method,
  capabilityName,
  activityGroup,
  commandActivities,
  artifactFilesById,
  loadArtifactPreview,
  open,
  onOpenChange,
  stopped = false,
  onPreviewImage,
}: {
  item: NativeCodexItem
  method: NativeLifecycleMethod
  capabilityName?: string
  activityGroup?: NativeToolActivity[]
  commandActivities?: NativeCommandActivity[]
  artifactFilesById?: ReadonlyMap<string, ConversationFile>
  loadArtifactPreview?: LoadArtifactPreview
  open?: boolean
  onOpenChange?: (open: boolean) => void
  stopped?: boolean
  onPreviewImage?: (item: ImagePreviewItem) => void
}) {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)
  const controlled = open !== undefined
  const resolvedOpen = open ?? internalOpen
  const handleOpenChange = (nextOpen: boolean) => {
    if (!controlled) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  if (!shouldDisplayNativeActivity(item)) return null

  const resolvedActivityGroup = activityGroup?.length
    ? activityGroup
    : item.type === "commandExecution" && commandActivities?.length
      ? commandActivities
      : null
  const effectiveActivityGroup =
    stopped && resolvedActivityGroup
      ? resolvedActivityGroup.map((activity) => ({
          ...activity,
          method: "item/completed" as const,
        }))
      : resolvedActivityGroup
  const model = effectiveActivityGroup
    ? buildNativeToolGroupViewModel(effectiveActivityGroup)
    : buildNativeActivityViewModel(
        item,
        stopped && item.type !== "contextCompaction"
          ? "item/completed"
          : method,
        { stopped }
      )
  const translatedSummaryParts = model.summaryParts.map((part) =>
    t(part.key, part.values)
  )
  const summary =
    translatedSummaryParts.length > 0
      ? translatedSummaryParts.join(
          t("conversation.nativeActivities.summary.separator")
        )
      : model.summaryKey
        ? t(model.summaryKey, model.summaryValues)
        : model.summary
  const running =
    !stopped &&
    (effectiveActivityGroup
      ? effectiveActivityGroup.some(
          (activity) => activity.method === "item/started"
        )
      : method === "item/started")
  const imageFileId = item.type === "imageView" ? item.fileId : undefined
  const imageFile = imageFileId
    ? artifactFilesById?.get(imageFileId.toLowerCase())
    : undefined

  if (!summary || summary === model.summaryKey) return null

  const markerContent = (
    <>
      <MarkerIcon>
        <NativeActivityIcon
          item={item}
          activityItems={effectiveActivityGroup?.map(
            (activity) => activity.item
          )}
        />
      </MarkerIcon>
      <MarkerContent className="conversation-marker-content">
        <span className={cn("native-activity-summary", running && "shimmer")}>
          {summary}
        </span>
        {capabilityName && <span className="trace-chip">{capabilityName}</span>}
      </MarkerContent>
    </>
  )

  if (!model.expandable) {
    return (
      <Collapsible
        open={false}
        className="activity-item native-activity-item conversation-marker"
        data-running={running || undefined}
        aria-busy={running || undefined}
        role={running ? "status" : undefined}
      >
        {markerContent}
      </Collapsible>
    )
  }

  return (
    <Collapsible
      open={resolvedOpen}
      onOpenChange={handleOpenChange}
      className="activity-item native-activity-item native-activity-collapsible"
      data-running={running || undefined}
      aria-busy={running || undefined}
    >
      <CollapsibleTrigger
        className="native-activity-trigger group"
        aria-label={t(
          resolvedOpen
            ? "conversation.nativeActivityDetails.collapse"
            : "conversation.nativeActivityDetails.expand",
          { activity: summary }
        )}
      >
        <Marker
          render={<span />}
          className="activity-item-main conversation-marker w-fit max-w-full"
          aria-busy={running || undefined}
          role={running ? "status" : undefined}
        >
          {markerContent}
          <MarkerIcon className="native-activity-chevron">
            <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
          </MarkerIcon>
        </Marker>
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          "native-activity-details",
          model.commands.length > 0 && "native-command-activity-details"
        )}
      >
        <div className="native-activity-details-inner">
          <NativeActivityDetails
            model={model}
            imageFile={imageFile}
            imageFileId={imageFileId}
            loadArtifactPreview={loadArtifactPreview}
            onPreviewImage={onPreviewImage}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
