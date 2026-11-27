import { useId, useRef, useState } from "react"
import type { WebSite } from "@linksense/shared"
import { ExternalLinkIcon, PencilIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime, formatFileSize } from "@/i18n/date"
import { SiteDialog } from "./site-dialog"
import { SiteLink } from "./site-link"
import { siteCustomAliasUrl } from "./site-url"

export function SiteDetailsDialog({
  site,
  trigger,
  onUpdated,
  onClose,
}: {
  site: WebSite
  trigger: HTMLElement
  onUpdated: (site: WebSite) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [editTrigger, setEditTrigger] = useState<HTMLElement | null>(null)
  const url = site.url ?? new URL(site.url_path, window.location.origin).href
  const visitUrl = siteCustomAliasUrl(site) ?? url
  const published = site.status === "published"

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <DialogContent
          variant="workspace"
          className="flex flex-col overflow-hidden max-sm:[&>button[data-slot=dialog-close]]:size-11"
          closeLabel={t("common.close")}
          initialFocus={heading}
          finalFocus={() => trigger}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle
              ref={heading}
              tabIndex={-1}
              className="line-clamp-2 wrap-anywhere"
              title={site.name}
            >
              {site.name}
            </DialogTitle>
            <DialogDescription>
              {t("webSites.details.description")}
            </DialogDescription>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  published ? "text-link-foreground" : "text-destructive"
                }
              >
                {t(`webSites.status.${site.status}`)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t(
                  site.backend_id
                    ? "webSites.dataConnected"
                    : "webSites.pageOnly"
                )}
              </span>
            </div>
          </DialogHeader>
          <div className={dialogBodyStyles("flex flex-col gap-5")}>
            <section
              aria-labelledby={`${id}-links`}
              className="flex flex-col gap-3"
            >
              <h3 id={`${id}-links`} className="font-medium">
                {t("webSites.details.links")}
              </h3>
              <dl className="flex min-w-0 flex-col gap-4">
                {site.alias_url && (
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {t("webSites.details.alias")}
                    </dt>
                    <dd className="min-w-0">
                      <SiteLink
                        key={site.alias_url}
                        url={site.alias_url}
                        copyLabel={t("webSites.details.copyAlias")}
                        openLabel={t("webSites.details.openAlias")}
                        multiline
                      />
                    </dd>
                  </div>
                )}
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    {t("webSites.details.stable")}
                  </dt>
                  <dd className="min-w-0">
                    <SiteLink
                      key={url}
                      url={url}
                      copyLabel={t("webSites.details.copyStable")}
                      openLabel={t("webSites.details.openStable")}
                      multiline
                    />
                  </dd>
                </div>
              </dl>
            </section>
            <section
              aria-labelledby={`${id}-publication`}
              className="flex flex-col gap-3 border-t border-divider pt-5"
            >
              <h3 id={`${id}-publication`} className="font-medium">
                {t("webSites.details.publication")}
              </h3>
              <dl className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-2 text-sm sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] [&>dd]:min-w-0 [&>dd]:wrap-anywhere [&>dt]:text-muted-foreground">
                {site.description && (
                  <>
                    <dt>{t("webSites.summary")}</dt>
                    <dd className="whitespace-pre-wrap">{site.description}</dd>
                  </>
                )}
                <dt>{t("webSites.details.source")}</dt>
                <dd>
                  {site.conversation_id ? (
                    <Link
                      className="rounded-sm text-link-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      to={`/conversations/${site.conversation_id}`}
                    >
                      {site.source_task_title}
                    </Link>
                  ) : (
                    t("webSites.sourceDeleted")
                  )}
                </dd>
                <dt>{t("webSites.details.passcode")}</dt>
                <dd>
                  {t(
                    site.passcode_protected
                      ? "webSites.details.passcodeOn"
                      : "webSites.details.passcodeOff"
                  )}
                </dd>
                <dt>{t("webSites.details.analytics")}</dt>
                <dd>
                  {site.analytics_enabled ? (
                    site.analytics_url ? (
                      <a
                        className="inline-flex min-w-0 items-center gap-1.5 rounded-sm text-link-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        href={site.analytics_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("webSites.details.openAnalytics")}
                      >
                        <span className="wrap-anywhere">
                          {site.analytics_url}
                        </span>
                        <ExternalLinkIcon
                          className="size-3 shrink-0"
                          aria-hidden="true"
                        />
                      </a>
                    ) : (
                      t("webSites.details.analyticsOn")
                    )
                  ) : (
                    t("webSites.details.analyticsOff")
                  )}
                </dd>
                <dt>{t("webSites.details.files")}</dt>
                <dd>
                  {t("webSites.resources", {
                    count: site.file_count,
                    size: formatFileSize(site.size_bytes, language),
                  })}
                </dd>
                <dt>{t("webSites.details.publishedAt")}</dt>
                <dd>{formatDateTime(site.published_at, language)}</dd>
                <dt>{t("webSites.details.updatedAt")}</dt>
                <dd>{formatDateTime(site.updated_at, language)}</dd>
                <dt>{t("webSites.details.createdAt")}</dt>
                <dd>{formatDateTime(site.created_at, language)}</dd>
              </dl>
            </section>
          </div>
          <DialogFooter className="shrink-0 flex-row flex-wrap justify-end">
            <Button
              type="button"
              variant="outline"
              className="max-sm:min-h-11"
              onClick={(event) => setEditTrigger(event.currentTarget)}
            >
              <PencilIcon
                className="size-3.5"
                data-icon="inline-start"
                aria-hidden="true"
              />
              {t("webSites.edit")}
            </Button>
            {published && (
              <a
                className={buttonVariants({ className: "max-sm:min-h-11" })}
                href={visitUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLinkIcon
                  className="size-3.5"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                {t("webSites.visit")}
              </a>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Base UI skips the backdrop of a dialog nested in another dialog's tree;
        rendering the editor as a sibling gives it its own mask over this one. */}
      {editTrigger && (
        <SiteDialog
          action={{ kind: "edit", site }}
          returnFocus={editTrigger}
          onClose={(updated) => {
            if (updated) onUpdated(updated)
            setEditTrigger(null)
          }}
        />
      )}
    </>
  )
}
