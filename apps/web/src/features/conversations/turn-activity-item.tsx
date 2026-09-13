import { WrenchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationFile } from "@/api/contracts"
import type { ImagePreviewItem } from "@/components/media/image-preview"
import type { LoadArtifactPreview } from "@/features/conversations/assistant-markdown-image"
import { ConversationActivityItem } from "@/features/conversations/conversation-activity-item"
import type { ActivitySummary } from "@/features/conversations/use-activity-summary"
import { NativeActivityDetails } from "@/features/conversations/native-activity-item"
import { NativeActivityIcon } from "@/features/conversations/native-activity-icon"
import {
  buildNativeActivityViewModel,
  buildNativeToolGroupViewModel,
  translateNativeActivitySummary,
  getNativeActivityPreview,
  type NativeToolActivity,
} from "@/features/conversations/native-activity-view-model"

export type TurnActivitySource =
  | { kind: "native"; activities: NativeToolActivity[]; grouped: boolean }
  | {
      kind: "legacy"
      id: string
      label: string
      running: boolean
      capabilityName?: string
    }
  | { kind: "thinking" }

export function TurnActivityItem({
  source,
  progress,
  reasoningSummary,
  stopped = false,
  open,
  onOpenChange,
  artifactFilesById,
  loadArtifactPreview,
  onPreviewImage,
}: {
  source: TurnActivitySource
  progress?: "active" | "thinking"
  reasoningSummary?: string
  stopped?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  artifactFilesById?: ReadonlyMap<string, ConversationFile>
  loadArtifactPreview?: LoadArtifactPreview
  onPreviewImage?: (item: ImagePreviewItem) => void
}) {
  const { t } = useTranslation()
  const activities = source.kind === "native" ? source.activities : []
  const first = activities[0]
  const isContextCompaction = first?.item.type === "contextCompaction"
  const effectiveActivities = stopped
    ? activities.map((activity): NativeToolActivity => ({
        ...activity,
        method: "item/completed",
      }))
    : activities
  const model =
    first && source.kind === "native"
      ? source.grouped
        ? buildNativeToolGroupViewModel(effectiveActivities)
        : buildNativeActivityViewModel(
            first.item,
            stopped && first.item.type !== "contextCompaction"
              ? "item/completed"
              : first.method,
            { stopped }
          )
      : null
  const activeActivities = effectiveActivities.filter(
    (activity) => activity.method === "item/started"
  )
  const active = activeActivities.at(-1)
  // The header describes the current activity; the disclosure keeps the full
  // group's actual results, including tools completed during the display hold.
  const activeModel = active
    ? source.kind === "native" && source.grouped
      ? buildNativeToolGroupViewModel(activeActivities)
      : buildNativeActivityViewModel(active.item, active.method)
    : null
  const summaryModel = progress === "active" ? (activeModel ?? model) : model
  // Compaction is a distinct lifecycle activity, including its completed and
  // interrupted states. Generic reasoning must not replace that record.
  const thinking =
    (progress === "thinking" && !isContextCompaction) ||
    source.kind === "thinking"
  const nativeRunning = activeActivities.length > 0
  const label = thinking
    ? reasoningSummary?.trim() || t("conversation.thinking")
    : source.kind === "legacy"
      ? source.label
      : summaryModel
        ? translateNativeActivitySummary(summaryModel, t)
        : null
  const summary: ActivitySummary = {
    key: thinking
      ? "thinking"
      : progress === "active"
        ? `active:${source.kind === "legacy" ? source.id : activeActivities.map((activity) => activity.item.id).join(":")}`
        : "settled",
    label: label ?? "",
    detail:
      !thinking && !stopped && activeModel && label
        ? getNativeActivityPreview(activeModel, label)
        : null,
    running:
      thinking ||
      (!stopped && (source.kind === "legacy" ? source.running : nativeRunning)),
    thinking,
    icon: thinking ? undefined : first ? (
      <NativeActivityIcon
        item={active?.item ?? first.item}
        method={
          isContextCompaction ? first.method : (active?.method ?? first.method)
        }
        activityItems={(progress === "active"
          ? activeActivities
          : effectiveActivities
        ).map((activity) => activity.item)}
      />
    ) : (
      <WrenchIcon className="size-3.5" aria-hidden="true" />
    ),
  }
  const imageFileId =
    first?.item.type === "imageView" ? first.item.fileId : undefined

  if (!label) return null
  return (
    <ConversationActivityItem
      summary={summary}
      deferred={progress !== undefined && !isContextCompaction}
      className={
        source.kind === "legacy"
          ? "legacy-activity-item"
          : "native-activity-item"
      }
      expandable={model?.expandable}
      open={open}
      onOpenChange={onOpenChange}
      capabilityName={
        source.kind === "legacy" ? source.capabilityName : undefined
      }
      detailClassName={
        model?.commands.length ? "native-command-activity-details" : undefined
      }
    >
      {model && (
        <NativeActivityDetails
          model={model}
          imageFileId={imageFileId}
          imageFile={
            imageFileId
              ? artifactFilesById?.get(imageFileId.toLowerCase())
              : undefined
          }
          loadArtifactPreview={loadArtifactPreview}
          onPreviewImage={onPreviewImage}
        />
      )}
    </ConversationActivityItem>
  )
}
