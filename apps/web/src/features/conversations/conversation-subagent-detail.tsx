import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import {
  nativeSubAgentDetailSchema,
  type NativeSubAgentDetail,
} from "@/api/contracts"
import { EmptyState, ErrorState } from "@/components/feedback/page-state"
import { OfficePreviewLoadingState } from "@/components/media/office-preview/office-preview-loading-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { NativeSubAgentViewModel } from "@/features/conversations/native-subagent-activity"
import { ConversationThread } from "@/features/conversations/conversation-thread"
import { buildSubAgentConversation } from "@/features/conversations/conversation-subagent-thread"
import { SubAgentIcon } from "@/features/conversations/subagent-icon"
import {
  reconcileSubAgentDetailStatus,
  subAgentDetailRefetchInterval,
} from "@/features/conversations/subagent-query-refresh"

export type ConversationSubAgentSelection = {
  conversationId: string
  turnId: string
  agentId: string
}

const ignoreSubAgentDownload = () => undefined

function toDetailRuntimeStatus(
  status: NativeSubAgentViewModel["status"]
): NativeSubAgentDetail["status"] {
  return status === "started" || status === "updated" ? "running" : status
}

export function ConversationSubAgentDetail({
  selection,
  agent,
  runtimeStatus,
  onClose,
}: {
  selection: ConversationSubAgentSelection
  agent?: NativeSubAgentViewModel
  runtimeStatus?: NativeSubAgentDetail["status"]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const fallbackAgentName =
    agent?.label ??
    t("conversation.subAgentActivities.agentFallback", {
      number: agent?.ordinal ?? 1,
    })
  const detailQuery = useQuery({
    queryKey: [
      "subagent-detail",
      selection.conversationId,
      selection.turnId,
      selection.agentId,
    ],
    queryFn: ({ signal }) =>
      apiRequest(
        `/conversations/${selection.conversationId}/turns/${selection.turnId}/subagents/${selection.agentId}`,
        {
          schema: nativeSubAgentDetailSchema,
          signal,
        }
      ),
    refetchInterval: (query) => {
      const queriedStatus = query.state.data?.status
      return subAgentDetailRefetchInterval(
        queriedStatus,
        runtimeStatus ??
          (queriedStatus === undefined ? agent?.status : undefined)
      )
    },
  })
  const detail = detailQuery.data
  const agentName = detail?.agentLabel ?? fallbackAgentName
  const detailStatus = reconcileSubAgentDetailStatus(
    detail?.status,
    runtimeStatus ?? (detail ? undefined : agent?.status)
  )
  const projectedDetail = useMemo(() => {
    if (!detail) return detail
    const projectedRuntimeStatus = toDetailRuntimeStatus(detailStatus)
    return detail.status === projectedRuntimeStatus
      ? detail
      : { ...detail, status: projectedRuntimeStatus }
  }, [detail, detailStatus])
  const subAgentConversation = useMemo(
    () =>
      projectedDetail
        ? buildSubAgentConversation(projectedDetail, {
            conversationId: selection.conversationId,
            agentName,
          })
        : null,
    [agentName, projectedDetail, selection.conversationId]
  )

  return (
    <aside
      className="office-preview-pane subagent-detail-pane"
      aria-label={t("conversation.subAgentActivities.detailPanelLabel", {
        name: agentName,
      })}
    >
      <header className="office-preview-header subagent-detail-header">
        <div className="subagent-detail-title">
          <SubAgentIcon ordinal={agent?.ordinal ?? 1} />
          <span className="truncate">{agentName}</span>
          <Badge variant="outline" className="shrink-0 rounded-full">
            {t(`conversation.subAgentActivities.status.${detailStatus}`)}
          </Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="office-preview-control-button office-preview-close-button"
          aria-label={t("conversation.subAgentActivities.closeDetails")}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" data-icon="inline-start" />
        </Button>
      </header>
      <Separator />
      <div className="subagent-detail-scroll">
        {detailQuery.isPending ? (
          <OfficePreviewLoadingState
            label={t("conversation.subAgentActivities.loadingDetails")}
          />
        ) : detailQuery.isError ? (
          <ErrorState
            message={t("conversation.subAgentActivities.detailLoadFailed")}
            onRetry={() => void detailQuery.refetch()}
          />
        ) : !detail || detail.turns.length === 0 ? (
          <EmptyState title={t("conversation.subAgentActivities.noDetails")} />
        ) : subAgentConversation ? (
          <ConversationThread
            conversation={subAgentConversation}
            onDownload={ignoreSubAgentDownload}
            editingDisabled
            suppressEmptyState
            embedded
            defaultActivityOpen
          />
        ) : null}
      </div>
    </aside>
  )
}
