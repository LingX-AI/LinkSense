import { useTranslation } from "react-i18next"

import { StatusBanner } from "@/components/feedback/status-banner"
import type { KnowledgeSearchCapability } from "@/features/knowledge-bases/knowledge-base-contracts"
import { getKnowledgeSearchUnavailableDescriptionKey } from "@/features/knowledge-bases/knowledge-search-status"

export function KnowledgeSearchStatusBanner({
  capability,
  className,
}: Readonly<{
  capability: KnowledgeSearchCapability | undefined
  className?: string
}>) {
  const { t } = useTranslation()
  if (!capability || capability.status === "available") return null
  return (
    <StatusBanner
      variant="warning"
      title={t(
        capability.status === "not_installed"
          ? "knowledge.searchCapability.notInstalledTitle"
          : "knowledge.searchCapability.unavailableTitle"
      )}
      className={className}
    >
      {t(getKnowledgeSearchUnavailableDescriptionKey(capability))}
    </StatusBanner>
  )
}
