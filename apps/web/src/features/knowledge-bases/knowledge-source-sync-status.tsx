import type { KnowledgeBaseSource } from "@linksense/shared"
import { useTranslation } from "react-i18next"

import { StatusBanner } from "@/components/feedback/status-banner"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"

export function KnowledgeSourceSyncStatus({
  source,
}: {
  source: KnowledgeBaseSource
}) {
  const { t } = useTranslation()
  const progress = source.sync_progress
  const running =
    source.sync_status === "syncing" && progress?.status === "running"
  const scanning = running && progress.phase === "scanning"
  const total = progress?.total_count ?? 0

  return (
    <StatusBanner
      variant={source.sync_status === "failed" ? "warning" : "info"}
      title={t("knowledge.source.title")}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <span>
          {t(`knowledge.source.status.${source.sync_status}`, {
            folder: source.folder_name,
          })}
        </span>
        {running && progress && (
          <Progress
            value={scanning ? null : progress.progress_percent}
            aria-label={t(`knowledge.source.phase.${progress.phase}`)}
          >
            <ProgressLabel>
              {scanning
                ? t("knowledge.source.progress.scanning", {
                    count: progress.scanned_count,
                  })
                : t(`knowledge.source.progress.${progress.phase}`, {
                    processed: progress.processed_count,
                    total,
                  })}
            </ProgressLabel>
            <ProgressValue>
              {scanning
                ? t("knowledge.source.progress.discovered", {
                    count: progress.scanned_count,
                  })
                : `${progress.progress_percent ?? 0}%`}
            </ProgressValue>
          </Progress>
        )}
        {progress && progress.status !== "running" && (
          <span className="text-xs text-muted-foreground">
            {t("knowledge.source.progress.summary", {
              processed: progress.processed_count,
              total: progress.total_count ?? progress.processed_count,
              created: progress.created_count,
              updated: progress.updated_count,
              deleted: progress.deleted_count,
              skipped: progress.skipped_count,
              retried: progress.retried_count,
              failed: progress.failed_count,
            })}
          </span>
        )}
        {source.stable_error_code && (
          <span>
            {t(knowledgeSourceStableErrorKey(source.stable_error_code))}
          </span>
        )}
        {source.retry_available && (
          <span>{t("knowledge.source.retryHint")}</span>
        )}
      </div>
    </StatusBanner>
  )
}

function knowledgeSourceStableErrorKey(code: string): string {
  return code === "KNOWLEDGE_SOURCE_ITEM_SYNC_FAILED"
    ? "errors.knowledgeSource.itemSyncFailed"
    : "errors.knowledgeSource.syncUnavailable"
}
