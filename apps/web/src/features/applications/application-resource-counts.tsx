import type { Application } from "@linksense/shared"
import { DatabaseIcon, ServerIcon, WrenchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type ApplicationResourceCounts = Pick<
  Application,
  "capability_count" | "knowledge_base_count" | "mcp_server_count"
>

export function ApplicationCardResources({
  capability_count,
  knowledge_base_count,
  mcp_server_count,
  hasNewDevelopment = false,
}: ApplicationResourceCounts & { hasNewDevelopment?: boolean }) {
  const { t } = useTranslation()
  const resources = [
    {
      key: "capabilityCount",
      count: capability_count,
      icon: WrenchIcon,
    },
    {
      key: "knowledgeBaseCount",
      count: knowledge_base_count,
      icon: DatabaseIcon,
    },
    { key: "mcpServerCount", count: mcp_server_count, icon: ServerIcon },
  ]
  return (
    <ul
      data-slot="application-card-statistics"
      aria-label={t("applications.details.resources")}
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs tabular-nums"
    >
      {resources.map(({ key, count, icon: Icon }) => (
        <li
          key={key}
          className={cn(
            "inline-flex items-center gap-1.5",
            count === 0 ? "text-muted-foreground" : "text-foreground"
          )}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t(`applications.card.${key}`, { count })}</span>
        </li>
      ))}
      {hasNewDevelopment && (
        <li>
          <Badge variant="secondary" weight="normal">
            {t("applicationDevelopment.catalog.newDevelopment")}
          </Badge>
        </li>
      )}
    </ul>
  )
}
