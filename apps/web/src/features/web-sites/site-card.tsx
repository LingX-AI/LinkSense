import { useRef, type ReactNode } from "react"
import type { WebSite } from "@linksense/shared"
import { GlobeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  CatalogResourceRow,
  CatalogResourceStatus,
} from "@/components/ui/catalog-resource-row"

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
  const titleButton = useRef<HTMLButtonElement>(null)

  return (
    <CatalogResourceRow
      name={site.name}
      onActivate={() => {
        if (titleButton.current) onDetails(titleButton.current)
      }}
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
          ref={titleButton}
          type="button"
          variant="link"
          aria-haspopup="dialog"
          className="h-auto max-w-full min-w-0 justify-start px-0 py-0 text-left text-[length:var(--app-font-15)] leading-[var(--app-line-22)] font-semibold whitespace-normal text-foreground hover:no-underline pointer-coarse:min-h-11"
          onClick={(event) => onDetails(event.currentTarget)}
        >
          <span className="line-clamp-2 wrap-anywhere">{site.name}</span>
        </Button>
      </h3>
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
