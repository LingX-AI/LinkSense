import type { ApplicationDevelopmentSummary } from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { ApplicationIconDisplay } from "./application-icon"
import { ApplicationCardResources } from "./application-resource-counts"
import { defaultApplicationIcon } from "./application-icon-default"

export function ApplicationDevelopmentSummaryContent({
  development,
  published = false,
}: {
  development: ApplicationDevelopmentSummary
  published?: boolean
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  return (
    <section
      aria-label={t("applicationDevelopment.catalog.draftDetails")}
      className="min-w-0"
    >
      <Card size="sm" appearance="soft" className="gap-3">
        <CardHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-pretty">
              {t("applicationDevelopment.catalog.draftDetails")}
            </h3>
            <Badge variant="secondary" weight="normal">
              {t(
                published
                  ? "applicationDevelopment.catalog.newDevelopment"
                  : "applicationDevelopment.publish.draft"
              )}
            </Badge>
          </div>
          <time
            dateTime={development.updated_at}
            className="text-xs leading-5 text-muted-foreground tabular-nums"
          >
            {t("applicationDevelopment.catalog.savedAt", {
              time: formatDateTime(development.updated_at, language),
            })}
          </time>
        </CardHeader>
        <CardContent className="flex min-w-0 items-start gap-3">
          <ApplicationIconDisplay
            icon={development.icon ?? defaultApplicationIcon}
            className="size-9 shrink-0"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h4 className="text-sm leading-5 font-medium text-pretty wrap-anywhere">
              {development.name}
            </h4>
            <p className="text-xs leading-5 wrap-anywhere whitespace-pre-wrap text-muted-foreground">
              {development.description || t("applications.noDescription")}
            </p>
            <div className="pt-2">
              <ApplicationCardResources
                capability_count={development.capability_count}
                knowledge_base_count={development.knowledge_base_count}
                mcp_server_count={development.mcp_server_count}
              />
            </div>
          </div>
        </CardContent>
        {published && (
          <CardFooter className="border-t">
            <p className="text-xs leading-5 text-muted-foreground">
              {t("applicationDevelopment.catalog.unpublishedHint")}
            </p>
          </CardFooter>
        )}
      </Card>
    </section>
  )
}
