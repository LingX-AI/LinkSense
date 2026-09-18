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
        "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg",
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
      className="@container/application-card relative min-w-0 gap-5 shadow-none transition-colors hover:border-foreground/20"
    >
      <CardHeader className="@container-normal flex flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {icon && <ApplicationCardIcon icon={icon} developing={developing} />}
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
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      </CardFooter>
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
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-muted-foreground"
    >
      {developing && (
        <span
          data-slot="application-card-development-status"
          className="inline-flex items-center gap-2 whitespace-nowrap"
        >
          <span aria-hidden="true">·</span>
          {t("applicationDevelopment.publish.draft")}
        </span>
      )}
      {status && (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden="true">·</span>
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
