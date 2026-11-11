import type { ReactNode } from "react"
import type { Application, ApplicationIcon } from "@linksense/shared"
import { BrainIcon, CodeXmlIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
export { ApplicationCardResources } from "./application-resource-counts"
import {
  ApplicationDetailsButton,
  type ApplicationDetailsTarget,
} from "./application-details-dialog"
import { ApplicationIconDisplay } from "./application-icon"

type ApplicationCardProps = {
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
  developing,
}: {
  icon: ApplicationIcon
  developing: boolean
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
        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg",
        tone
      )}
    >
      <ApplicationIconDisplay icon={icon} className="size-10 after:border-0" />
      {developing && (
        <span
          data-slot="application-card-development-overlay"
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-0 flex size-6 items-center justify-center rounded-tl-lg bg-card/80"
        >
          <CodeXmlIcon className="size-4 text-application-create-accent opacity-85" />
        </span>
      )}
    </div>
  )
}

export function ApplicationCard({
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
      className="@container/application-card relative min-h-19 min-w-0 gap-0 rounded-none border-x-0 border-t-0 border-b border-divider bg-transparent px-4 py-3 shadow-none transition-colors focus-within:bg-hover hover:bg-hover"
    >
      <CardHeader className="@container-normal grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 p-0 has-data-[slot=card-description]:grid-rows-none @min-[48rem]/application-card:grid-cols-[2.5rem_minmax(0,1fr)_7.5rem_8rem] [&>[data-slot=application-card-icon]]:self-start @min-[48rem]/application-card:[&>[data-slot=application-card-icon]]:self-center">
        {icon ? (
          <ApplicationCardIcon icon={icon} developing={developing} />
        ) : (
          <span aria-hidden="true" className="size-10" />
        )}
        <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-1">
          <div
            data-slot="application-card-title-row"
            className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"
          >
            <CardTitle className="max-w-full min-w-0">
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
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
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
            className="line-clamp-2 text-[length:var(--app-font-13)] leading-5 wrap-anywhere"
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
            className="col-start-2 row-start-2 flex min-w-0 flex-col gap-1 text-xs text-muted-foreground @min-[48rem]/application-card:col-start-3 @min-[48rem]/application-card:row-start-1"
          >
            <ApplicationCardStatus status={status} developing={developing} />
            <div className="min-w-0 wrap-anywhere">{footer}</div>
          </div>
          {(actions || headerActions) && (
            <div
              data-slot="application-card-actions"
              className="relative col-start-2 row-start-3 flex max-w-full min-w-0 flex-wrap items-center gap-2 @min-[48rem]/application-card:col-start-4 @min-[48rem]/application-card:row-start-1 @min-[48rem]/application-card:justify-end [&>[data-slot=button]]:max-w-full [&>[data-slot=button]]:whitespace-normal"
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
}: {
  status?: Application["status"]
  developing: boolean
}) {
  const { t } = useTranslation()
  if (!status && !developing) return null
  return (
    <div
      data-slot="application-card-status"
      className="flex min-w-0 flex-col items-start gap-1 text-xs font-normal text-muted-foreground"
    >
      {developing && (
        <span
          data-slot="application-card-development-status"
          className="inline-flex items-center gap-2 whitespace-nowrap"
        >
          {t("applicationDevelopment.publish.draft")}
        </span>
      )}
      {status && (
        <span
          className={cn(
            "inline-flex items-center gap-2 whitespace-nowrap",
            status === "active" ? "text-primary" : "text-destructive"
          )}
        >
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
