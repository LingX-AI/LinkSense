import type { ReactNode } from "react"
import type { Application, ApplicationIcon } from "@linksense/shared"
import { BrainIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cardSpotlightProps } from "@/components/ui/card-spotlight"
import { cn } from "@/lib/utils"
export { ApplicationCardResources } from "./application-resource-counts"
import {
  ApplicationDetailsButton,
  type ApplicationDetailsTarget,
} from "./application-details-dialog"
import { ApplicationIconDisplay } from "./application-icon"

type ApplicationCardProps = {
  layout?: "card" | "row"
  id: string
  name: string
  kind: Application["kind"]
  icon?: ApplicationIcon
  version?: string | null
  status?: Application["status"]
  developing?: boolean
  description: string | null
  onOpenDetails?: (target: ApplicationDetailsTarget) => void
  headerActions?: ReactNode
  children?: ReactNode
  footer: ReactNode
  actions: ReactNode
}

function ApplicationCardIcon({
  icon,
  compact,
}: {
  icon: ApplicationIcon
  compact: boolean
}) {
  const preset = icon.type === "custom" ? icon.fallback_preset : icon.preset
  const tone = ["shield-check", "briefcase-business", "landmark"].includes(
    preset
  )
    ? "bg-application-icon-sand"
    : ["graduation-cap", "heart-pulse", "users"].includes(preset)
      ? "bg-application-icon-rose"
      : ["book-open", "search", "globe-2"].includes(preset)
        ? "bg-application-icon-sage"
        : "bg-application-icon-iris"
  return (
    <div
      data-slot="application-card-icon"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg",
        compact ? "size-10" : "size-12",
        tone
      )}
    >
      <ApplicationIconDisplay icon={icon} className="size-10 after:border-0" />
    </div>
  )
}

export function ApplicationCard({
  layout = "row",
  id,
  name,
  kind,
  icon,
  version,
  status,
  developing = false,
  description,
  onOpenDetails,
  headerActions,
  children,
  footer,
  actions,
}: ApplicationCardProps) {
  const { t } = useTranslation()
  if (layout === "row") {
    return (
      <ApplicationListRow
        id={id}
        name={name}
        kind={kind}
        icon={icon}
        version={version}
        status={status}
        developing={developing}
        description={description}
        onOpenDetails={onOpenDetails}
        headerActions={headerActions}
        footer={footer}
        actions={actions}
      >
        {children}
      </ApplicationListRow>
    )
  }
  return (
    <Card
      {...cardSpotlightProps}
      role="article"
      aria-label={name}
      className={cn(
        cardSpotlightProps.className,
        "@container/application-card min-w-0 gap-5 shadow-none transition-colors hover:border-foreground/20"
      )}
    >
      <CardHeader className="@container-normal flex flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {icon && <ApplicationCardIcon icon={icon} compact={false} />}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div data-slot="application-card-title-row" className="min-w-0">
              <CardTitle className="min-w-0">
                <h3
                  className="line-clamp-2 wrap-anywhere"
                  aria-label={name}
                  title={name}
                >
                  {onOpenDetails ? (
                    <ApplicationDetailsButton
                      id={id}
                      name={name}
                      onOpen={onOpenDetails}
                    />
                  ) : (
                    name
                  )}
                </h3>
              </CardTitle>
            </div>
            <div
              data-slot="application-card-metadata"
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span>{t(`applications.details.kinds.${kind}`)}</span>
                {version && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="min-w-0 truncate">
                      {t("applications.distribution.version", { version })}
                    </span>
                  </>
                )}
              </div>
              <ApplicationCardStatus status={status} developing={developing} />
            </div>
          </div>
        </div>
        {headerActions && (
          <div className="relative flex shrink-0 items-center">
            {headerActions}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col gap-4">
        <CardDescription className="line-clamp-2 min-h-10 text-[length:var(--app-font-13)] leading-5 wrap-anywhere">
          {description || t("applications.noDescription")}
        </CardDescription>
        {children}
      </CardContent>
      <CardFooter className="relative mt-auto min-w-0 flex-wrap justify-between gap-x-4 gap-y-3 border-t">
        <div className="min-w-0 flex-1 basis-32 text-xs text-muted-foreground">
          {footer}
        </div>
        <div className="ml-auto flex min-h-7 max-w-full flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      </CardFooter>
    </Card>
  )
}

function ApplicationListRow({
  id,
  name,
  kind,
  icon,
  version,
  status,
  developing = false,
  description,
  onOpenDetails,
  headerActions,
  children,
  footer,
  actions,
}: ApplicationCardProps) {
  const { t } = useTranslation()
  return (
    <Card
      role="article"
      aria-label={name}
      data-layout="row"
      className="relative min-h-19 min-w-0 gap-0 rounded-none border-x-0 border-t-0 border-b border-divider bg-transparent px-4 py-3 shadow-none transition-colors focus-within:bg-(--app-hover-subtle) hover:bg-(--app-hover-subtle)"
    >
      <CardHeader className="@container-normal grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 p-0 has-data-[slot=card-description]:grid-rows-none @min-[48rem]/shell-content:grid-cols-[2.5rem_minmax(0,1fr)_7.5rem_8rem] [&>[data-slot=application-card-icon]]:self-start @min-[48rem]/shell-content:[&>[data-slot=application-card-icon]]:self-center">
        {icon ? (
          <ApplicationCardIcon icon={icon} compact />
        ) : (
          <span aria-hidden="true" className="size-10" />
        )}
        <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-1">
          <div
            data-slot="application-card-title-row"
            className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"
          >
            <CardTitle className="max-w-full min-w-0 text-sm leading-[var(--app-line-22)] text-foreground">
              <h3
                className="line-clamp-2 wrap-anywhere"
                aria-label={name}
                title={name}
              >
                {onOpenDetails ? (
                  <ApplicationDetailsButton
                    id={id}
                    name={name}
                    onOpen={onOpenDetails}
                  />
                ) : (
                  name
                )}
              </h3>
            </CardTitle>
            <div
              data-slot="application-card-metadata"
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-[var(--app-line-18)] text-muted-foreground"
            >
              <span>{t(`applications.details.kinds.${kind}`)}</span>
              {version && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="min-w-0 truncate">
                    {t("applications.distribution.version", { version })}
                  </span>
                </>
              )}
            </div>
          </div>
          <CardDescription
            className="line-clamp-2 text-sm leading-[var(--app-line-22)] wrap-anywhere"
            title={description || t("applications.noDescription")}
          >
            {description || t("applications.noDescription")}
          </CardDescription>
          {children && (
            <CardContent className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 p-0 [&>[role=alert]]:basis-full [&>[role=status]]:basis-full">
              {children}
            </CardContent>
          )}
        </div>
        <CardFooter className="contents">
          <div
            data-slot="application-card-summary"
            className="col-start-2 row-start-2 flex min-w-0 flex-col gap-1 text-xs leading-[var(--app-line-18)] text-muted-foreground @min-[48rem]/shell-content:col-start-3 @min-[48rem]/shell-content:row-start-1"
          >
            <ApplicationCardStatus
              status={status}
              developing={developing}
              separate
            />
            <div className="min-w-0 wrap-anywhere">{footer}</div>
          </div>
          {(actions || headerActions) && (
            <div
              data-slot="application-card-actions"
              className="relative col-start-2 row-start-3 flex max-w-full min-w-0 flex-wrap items-center gap-2 @min-[48rem]/shell-content:col-start-4 @min-[48rem]/shell-content:row-start-1 @min-[48rem]/shell-content:justify-end [&_[aria-haspopup=menu]]:rounded-md [&_[aria-haspopup=menu]:hover]:bg-(--app-sidebar-action-hover) [&_[aria-haspopup=menu][data-popup-open]]:bg-(--app-sidebar-action-hover) [&>[data-slot=button]]:max-w-full [&>[data-slot=button]]:whitespace-normal"
            >
              {actions}
              {headerActions}
            </div>
          )}
        </CardFooter>
      </CardHeader>
    </Card>
  )
}

function ApplicationCardStatus({
  status,
  developing,
  separate = false,
}: {
  status?: Application["status"]
  developing: boolean
  separate?: boolean
}) {
  const { t } = useTranslation()
  if (!status && !developing) return null
  return (
    <div
      data-slot="application-card-status"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-muted-foreground",
        separate && "flex-col items-start"
      )}
    >
      {developing && (
        <span
          data-slot="application-card-development-status"
          className="inline-flex items-center gap-2 whitespace-nowrap"
        >
          {!separate && <span aria-hidden="true">·</span>}
          {t("applicationDevelopment.publish.draft")}
        </span>
      )}
      {status && (
        <span
          className={cn(
            "inline-flex items-center gap-2 whitespace-nowrap",
            separate &&
              (status === "active"
                ? "text-link-foreground"
                : "text-destructive")
          )}
        >
          {!separate && <span aria-hidden="true">·</span>}
          {t(`applications.status.${status}`)}
        </span>
      )}
    </div>
  )
}

export function ApplicationCardModel({ model }: Pick<Application, "model">) {
  if (!model) return null
  return (
    <div
      data-slot="application-card-model-row"
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <BrainIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span
        data-slot="application-card-model"
        className="min-w-0 truncate"
        title={model}
      >
        {model}
      </span>
    </div>
  )
}
