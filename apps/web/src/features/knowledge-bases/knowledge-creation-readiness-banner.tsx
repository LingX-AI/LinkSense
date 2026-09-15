import { RefreshCcwIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import type { KnowledgeBaseCreationCapability } from "@/features/knowledge-bases/knowledge-base-contracts"

const knowledgeCreationChecks = [
  "object_storage",
  "document_parsing",
  "embedding_model",
  "search_and_indexing",
] as const
type KnowledgeCreationCheck = (typeof knowledgeCreationChecks)[number]

export function KnowledgeCreationReadinessBanner({
  capability,
  checking,
  requestFailed,
  onRetry,
  className,
}: Readonly<{
  capability: KnowledgeBaseCreationCapability | undefined
  checking: boolean
  requestFailed: boolean
  onRetry: () => void
  className?: string
}>) {
  const { t } = useTranslation()
  if (!requestFailed && (!capability || capability.status === "ready")) {
    return null
  }

  const failedChecks =
    capability?.status === "unready"
      ? knowledgeCreationChecks.flatMap((check) => {
          const status = capability.checks[check]
          return status === "available" ? [] : [{ check, status }]
        })
      : []
  const title = requestFailed
    ? t("knowledge.creationCapability.requestFailedTitle")
    : capability?.status === "not_installed"
      ? t("knowledge.creationCapability.notInstalledTitle")
      : t("knowledge.creationCapability.unreadyTitle")

  return (
    <StatusBanner
      variant={
        requestFailed || capability?.status === "unready" ? "warning" : "info"
      }
      title={title}
      className={className}
      actions={
        capability?.status !== "not_installed" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={checking}
            onClick={onRetry}
          >
            <RefreshCcwIcon data-icon="inline-start" aria-hidden="true" />
            {t("knowledge.creationCapability.retry")}
          </Button>
        ) : undefined
      }
    >
      {requestFailed ? (
        t("knowledge.creationCapability.requestFailedDescription")
      ) : capability?.status === "not_installed" ? (
        t("knowledge.creationCapability.notInstalledDescription")
      ) : (
        <div className="flex flex-col gap-1">
          <span>{t("knowledge.creationCapability.unreadyDescription")}</span>
          <ul className="list-disc pl-5">
            {failedChecks.map(({ check, status }) => (
              <li key={check}>{t(creationCheckMessageKey(check, status))}</li>
            ))}
          </ul>
        </div>
      )}
    </StatusBanner>
  )
}

function creationCheckMessageKey(
  check: KnowledgeCreationCheck,
  status: "not_configured" | "unavailable"
) {
  if (check === "embedding_model" && status === "not_configured") {
    return "knowledge.creationCapability.checks.embeddingNotConfigured"
  }
  const keys = {
    object_storage:
      "knowledge.creationCapability.checks.objectStorageUnavailable",
    document_parsing:
      "knowledge.creationCapability.checks.documentParsingUnavailable",
    embedding_model: "knowledge.creationCapability.checks.embeddingUnavailable",
    search_and_indexing:
      "knowledge.creationCapability.checks.searchAndIndexingUnavailable",
  } as const
  return keys[check]
}
