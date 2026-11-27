import { useRef, type ReactNode } from "react"
import type { WebSite } from "@linksense/shared"
import { AppWindowIcon, DatabaseIcon, GlobeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  CatalogResourceRow,
  CatalogResourceStatus,
} from "@/components/ui/catalog-resource-row"
import {
  ActionTooltipContent,
  Tooltip,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function DataCapabilityIndicator({
  connected,
  title,
  description,
}: {
  connected: boolean
  title: string
  description: string
}) {
  const Icon = connected ? DatabaseIcon : AppWindowIcon

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            tabIndex={0}
            aria-label={`${title}. ${description}`}
            data-slot="site-data-capability"
            data-connected={connected}
            className="inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        }
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <ActionTooltipContent
        side="left"
        className="max-w-56 flex-col items-start gap-0.5 text-left"
      >
        <span className="font-medium">{title}</span>
        <span>{description}</span>
      </ActionTooltipContent>
    </Tooltip>
  )
}

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
  const dataCapabilityTitle = t("webSites.dataCapabilityTitle")
  const dataCapabilityDescription = t(
    site.backend_id
      ? "webSites.dataServiceConnected"
      : "webSites.dataServiceDisconnected"
  )

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
        <div className="flex flex-wrap items-center gap-2">
          <CatalogResourceStatus positive={site.status === "published"}>
            {t(`webSites.status.${site.status}`)}
          </CatalogResourceStatus>
          <DataCapabilityIndicator
            connected={Boolean(site.backend_id)}
            title={dataCapabilityTitle}
            description={dataCapabilityDescription}
          />
        </div>
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
