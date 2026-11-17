import type { ReactNode } from "react"
import type { WebSite } from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription } from "@/components/ui/card"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { getPublicAppOrigin } from "@/adapters/desktop/desktop-adapter"
import { SiteLink } from "./site-link"

export function SiteCard({
  site,
  actions,
  onDetails,
}: {
  site: WebSite
  actions: ReactNode
  onDetails: (trigger: HTMLElement) => void
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const url =
    site.alias_url ??
    site.url ??
    new URL(site.url_path, getPublicAppOrigin()).href

  return (
    <Card
      size="sm"
      className="min-h-15 min-w-0 gap-2 rounded-none border-0 border-b border-divider bg-transparent px-3 py-3 shadow-none focus-within:bg-[var(--app-hover-subtle)] hover:bg-[var(--app-hover-subtle)] @xl/site-list:flex-row @xl/site-list:items-center @xl/site-list:gap-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 font-medium [overflow-wrap:anywhere]">
            <Button
              type="button"
              variant="link"
              aria-haspopup="dialog"
              className="h-auto max-w-full min-w-0 justify-start px-0 py-0 text-left font-medium whitespace-normal text-foreground max-sm:min-h-11"
              onClick={(event) => onDetails(event.currentTarget)}
            >
              <span className="wrap-anywhere">{site.name}</span>
            </Button>
          </h2>
          <Badge
            variant="outline"
            className={
              site.status === "published"
                ? "text-link-foreground"
                : "text-destructive"
            }
          >
            {t(`webSites.status.${site.status}`)}
          </Badge>
        </div>
        {site.description && (
          <CardDescription className="line-clamp-2 text-sm leading-[var(--app-line-22)] [overflow-wrap:anywhere]">
            {site.description}
          </CardDescription>
        )}
        <SiteLink
          key={url}
          url={url}
          displayText={
            site.alias_url ? new URL(site.alias_url).pathname : undefined
          }
          copyLabel={t("webSites.copyNamed", { name: site.name })}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-[var(--app-line-18)] text-muted-foreground">
          <span>
            {t(
              site.backend_id ? "webSites.dataConnected" : "webSites.pageOnly"
            )}
          </span>
          {!site.alias_url && (
            <span className="min-w-0 wrap-anywhere">
              {t("webSites.slug")}: {site.slug}
            </span>
          )}
          <span>
            {t("webSites.publishedAt", {
              date: formatDateTime(site.published_at, language),
            })}
          </span>
        </div>
      </div>
      <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
        {actions}
      </div>
    </Card>
  )
}
