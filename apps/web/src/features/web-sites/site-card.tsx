import type { ReactNode } from "react"
import type { WebSite } from "@linksense/shared"
import { GlobeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  CatalogResourceRow,
  CatalogResourceStatus,
} from "@/components/ui/catalog-resource-row"
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
  const { t } = useTranslation()
  const url =
    site.alias_url ??
    site.url ??
    new URL(site.url_path, getPublicAppOrigin()).href
  const path = new URL(url).pathname

  return (
    <CatalogResourceRow
      name={site.name}
      icon={
        <span className="grid size-10 place-items-center rounded-lg border border-divider bg-muted text-muted-foreground">
          <GlobeIcon className="size-[1.125rem]" aria-hidden="true" />
        </span>
      }
      summary={
        <>
          <CatalogResourceStatus positive={site.status === "published"}>
            {t(`webSites.status.${site.status}`)}
          </CatalogResourceStatus>
          <span>
            {t(
              site.backend_id ? "webSites.dataConnected" : "webSites.pageOnly"
            )}
          </span>
        </>
      }
      actions={actions}
    >
      <h3 className="min-w-0 leading-[var(--app-line-22)]" title={site.name}>
        <Button
          type="button"
          variant="link"
          aria-haspopup="dialog"
          className="h-auto max-w-full min-w-0 justify-start px-0 py-0 text-left text-[length:var(--app-font-15)] leading-[var(--app-line-22)] font-semibold whitespace-normal text-foreground pointer-coarse:min-h-11"
          onClick={(event) => onDetails(event.currentTarget)}
        >
          <span className="line-clamp-2 wrap-anywhere">{site.name}</span>
        </Button>
      </h3>
      <SiteLink
        key={url}
        url={url}
        displayText={site.alias_url ? path : undefined}
        copyLabel={t("webSites.copyNamed", { name: site.name })}
        className="rounded-md bg-muted pl-2"
      />
      {!site.alias_url && path !== `/web/${site.slug}` && (
        <p className="text-xs wrap-anywhere text-muted-foreground">
          {t("webSites.slug")}: {site.slug}
        </p>
      )}
      {site.description?.trim() && (
        <p
          className="line-clamp-2 text-[length:var(--app-font-13)] leading-[var(--app-line-22)] wrap-anywhere text-muted-foreground"
          title={site.description}
        >
          {site.description}
        </p>
      )}
    </CatalogResourceRow>
  )
}
