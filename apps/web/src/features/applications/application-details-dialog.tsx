import { useQuery } from "@tanstack/react-query"
import { CheckIcon, CircleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  applicationDetailsSchema,
  type ApplicationDetails,
  type ApplicationDevelopmentSummary,
  type ApplicationDistributionChannel,
  type InteractiveDependencyType,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { Empty, EmptyDescription } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { cn } from "@/lib/utils"
import { ApplicationIconDisplay } from "./application-icon"
import { applicationDistributionKeys } from "./application-distribution-queries"
import { ApplicationDevelopmentSummaryContent } from "./application-development-summary"

export type ApplicationDetailsTarget = {
  id: string
  name: string
  trigger: HTMLElement
}

// Stretch the title's native button over the card body without nesting the
// menu or footer controls inside another interactive element.
// The surrounding CardHeader must use @container-normal so it does not
// establish a containing block; the relative Card is the click target area.
export function ApplicationDetailsButton({
  id,
  name,
  onOpen,
}: {
  id: string
  name: string
  onOpen: (target: ApplicationDetailsTarget) => void
}) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={t("applications.details.open", { name })}
      aria-haspopup="dialog"
      className="static h-auto max-w-full min-w-0 cursor-pointer justify-start rounded-none p-0 text-left text-[length:inherit] text-inherit after:absolute after:inset-0 after:rounded-card hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
      onClick={(event) => onOpen({ id, name, trigger: event.currentTarget })}
    >
      <span className="line-clamp-2 wrap-anywhere whitespace-normal">
        {name}
      </span>
    </Button>
  )
}

export function ApplicationDetailsDialog({
  target,
  channel = "direct",
  development,
  onClose,
}: {
  target: ApplicationDetailsTarget
  channel?: ApplicationDistributionChannel
  development?: ApplicationDevelopmentSummary | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: applicationDistributionKeys.details(target.id, channel),
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${target.id}/details`, {
        query: { channel },
        schema: applicationDetailsSchema,
        signal,
      }),
    // Details are checked again on every open, including revoked shares.
    gcTime: 0,
  })
  const details = query.error ? undefined : query.data
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-5 sm:max-w-2xl"
        closeLabel={t("common.close")}
        finalFocus={() => target.trigger}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="sr-only">
            {t("applications.details.title")}
          </DialogTitle>
          <div className="flex items-start gap-3">
            {details && (
              <ApplicationIconDisplay
                icon={details.icon}
                className="size-11 shrink-0"
              />
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="min-w-0 text-base leading-6 font-medium text-pretty wrap-anywhere">
                  {details?.name ?? target.name}
                </h3>
                {details && (
                  <Badge variant="secondary" weight="normal">
                    {t(`applications.status.${details.status}`)}
                  </Badge>
                )}
              </div>
              {details && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{t(`applications.details.kinds.${details.kind}`)}</span>
                  {details.version_number && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("applications.distribution.version", {
                          version: details.version_number,
                        })}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{t(`applications.details.views.${details.view}`)}</span>
                </div>
              )}
            </div>
          </div>
        </DialogHeader>
        <div className={dialogBodyStyles("flex flex-col gap-5")}>
          {query.isPending && <LoadingState />}
          {query.error ? (
            <ErrorState
              message={getErrorMessage(query.error, t)}
              onRetry={() => void query.refetch()}
            />
          ) : (
            details && (
              <>
                <ApplicationDetailsContent details={details} />
                {development?.has_changes && (
                  <ApplicationDevelopmentSummaryContent
                    development={development}
                    published
                  />
                )}
              </>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const resourceTypes: InteractiveDependencyType[] = [
  "plugin",
  "skill",
  "mcp_server",
  "knowledge_base",
]

function ApplicationDetailsContent({
  details,
}: {
  details: ApplicationDetails
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const fields = [
    { label: t("applications.details.creator"), value: details.creator_name },
    {
      label: t("applications.model"),
      value: details.model ?? t("applications.userSelectedModel"),
    },
    {
      label: t("common.createdAt"),
      value: formatDateTime(details.created_at, language),
    },
    {
      label: t("common.updatedAt"),
      value: formatDateTime(details.updated_at, language),
    },
  ]
  return (
    <>
      <section
        aria-label={t("applications.basicInformation")}
        className="flex flex-col gap-4"
      >
        <DialogDescription className="text-sm leading-6 wrap-anywhere whitespace-pre-wrap">
          {details.description || t("applications.noDescription")}
        </DialogDescription>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.label} className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">{field.label}</dt>
              <dd className="text-sm leading-5 wrap-anywhere tabular-nums">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <Separator />
      <section
        aria-label={t("applications.details.resources")}
        className="flex flex-col gap-3"
      >
        <h3 className="text-sm font-medium text-pretty">
          {t("applications.details.resources")}
        </h3>
        {details.resources.length === 0 ? (
          <Empty className="min-h-0 items-start p-0 text-left">
            <EmptyDescription className="text-xs leading-5">
              {t("applications.details.noResources")}
            </EmptyDescription>
          </Empty>
        ) : (
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {resourceTypes.map((type) => {
              const resources = details.resources.filter(
                (item) => item.type === type
              )
              return (
                <section
                  key={type}
                  aria-label={t(`applications.dependencies.types.${type}`)}
                  className="flex min-w-0 flex-col gap-3"
                >
                  <h4 className="text-xs font-medium text-muted-foreground">
                    {t("applications.details.resourceGroup", {
                      type: t(`applications.dependencies.types.${type}`),
                      count: resources.length,
                    })}
                  </h4>
                  {resources.length ? (
                    <ul className="flex flex-col gap-3">
                      {resources.map((resource) => (
                        <ApplicationResourceRow
                          key={resource.id}
                          resource={resource}
                        />
                      ))}
                    </ul>
                  ) : (
                    <Empty className="min-h-0 items-start p-0 text-left">
                      <EmptyDescription>
                        {t("applications.details.emptyGroup")}
                      </EmptyDescription>
                    </Empty>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}

function ApplicationResourceRow({
  resource,
}: {
  resource: ApplicationDetails["resources"][number]
}) {
  const { t } = useTranslation()
  const statusLabel = t(
    `applications.details.resourceStatus.${resource.status}`
  )
  return (
    <li className="flex min-w-0 items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm wrap-anywhere">
          {resource.configured_name ??
            resource.name ??
            t("applications.details.unknownResource")}
        </span>
        {resource.configured_name &&
          resource.name &&
          resource.configured_name !== resource.name && (
            <span className="text-xs wrap-anywhere text-muted-foreground">
              {t("applications.details.declaredResource", {
                name: resource.name,
              })}
            </span>
          )}
      </div>
      {resource.status === "configured" ? (
        <Tooltip>
          <TooltipTrigger
            render={<span />}
            role="img"
            aria-label={statusLabel}
            tabIndex={0}
            className="mt-0.5 inline-flex shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CheckIcon className="size-4 text-success" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{statusLabel}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <CircleAlertIcon
            className={cn(
              "size-3.5",
              resource.status === "unconfigured"
                ? "text-warning"
                : "text-destructive"
            )}
            aria-hidden="true"
          />
          {statusLabel}
        </span>
      )}
    </li>
  )
}
