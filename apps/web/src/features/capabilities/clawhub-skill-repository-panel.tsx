import { Fragment, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { TFunction } from "i18next"
import {
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  StarIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import {
  capabilityImportPreviewSchema,
  capabilitySummarySchema,
  clawHubSkillCatalogPageSchema,
  type CapabilityImportPreview,
  type ClawHubSkillCatalogItem,
  type ClawHubSkillCatalogSort,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { CapabilityLibraryItem } from "@/components/capabilities/capability-library-item"
import { CapabilityRiskSummary } from "@/components/capabilities/capability-risk-summary"
import { SkillContentPreview } from "@/components/capabilities/skill-content-preview"
import { notify } from "@/components/feedback/notification"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

const PAGE_SIZE = 24
const CATALOG_REFRESH_INTERVAL_MS = 10_000

type InstallabilityReason = NonNullable<
  ClawHubSkillCatalogItem["installability_reason"]
>

const installabilityReasonKeys = {
  unavailable: "clawHub.installability.unavailable",
  missing_version: "clawHub.installability.missingVersion",
  already_installed: "clawHub.installability.alreadyInstalled",
} as const satisfies Record<InstallabilityReason, string>

type RepositoryPaginationState = {
  search: string
  sort: ClawHubSkillCatalogSort
  cursor: string | undefined
  cursorStack: Array<string | undefined>
}

type InstallPreviewState = {
  item: ClawHubSkillCatalogItem
  preview: CapabilityImportPreview
}

function clawHubInstallToastId(state: InstallPreviewState) {
  return `clawhub-install-${state.preview.preview_token}`
}

function clawHubInstallStatusKey(state: InstallPreviewState) {
  return state.preview.operation === "update"
    ? "clawHub.updatingStatus"
    : "clawHub.installingStatus"
}

function itemOwner(item: ClawHubSkillCatalogItem) {
  return item.owner_display_name ?? item.owner_handle
}

function installabilityMessage(item: ClawHubSkillCatalogItem, t: TFunction) {
  return item.installability_reason
    ? t(installabilityReasonKeys[item.installability_reason])
    : null
}

function SecurityBadge({ item }: { item: ClawHubSkillCatalogItem }) {
  const { t } = useTranslation()

  if (item.is_malware_blocked || item.is_suspicious) {
    return (
      <Badge variant="destructive">
        <ShieldAlertIcon aria-hidden="true" />
        {t("clawHub.security.flagged")}
      </Badge>
    )
  }
  if (item.security_has_warnings) {
    return (
      <Badge variant="outline">
        <ShieldAlertIcon aria-hidden="true" />
        {t("clawHub.security.warning")}
      </Badge>
    )
  }
  if (item.security_status === "clean") {
    return (
      <Badge variant="secondary">
        <ShieldCheckIcon aria-hidden="true" />
        {t("clawHub.security.clean")}
      </Badge>
    )
  }
  return <Badge variant="outline">{t("clawHub.security.unknown")}</Badge>
}

function SkillMetadata({ item }: { item: ClawHubSkillCatalogItem }) {
  const { t, i18n } = useTranslation()
  const language =
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? "zh-CN"
  const numberFormatter = new Intl.NumberFormat(language)
  const owner = itemOwner(item)
  const values = [
    owner ? { key: "owner", value: t("clawHub.byOwner", { owner }) } : null,
    item.latest_version
      ? {
          key: "version",
          value: t("clawHub.version", { version: item.latest_version }),
        }
      : null,
    {
      key: "downloads",
      value: t("clawHub.downloads", {
        count: numberFormatter.format(item.stats.downloads),
      }),
    },
    {
      key: "stars",
      value: t("clawHub.stars", {
        count: numberFormatter.format(item.stats.stars),
      }),
    },
    {
      key: "updated",
      value: formatDateTime(item.source_updated_at, language),
    },
  ].filter((entry): entry is { key: string; value: string } => entry !== null)

  return (
    <>
      {values.map(({ key, value }, index) => (
        <Fragment key={key}>
          {index > 0 && <span aria-hidden="true">·</span>}
          <span>{value}</span>
        </Fragment>
      ))}
    </>
  )
}

function CanonicalLink({
  item,
  variant = "outline",
}: {
  item: ClawHubSkillCatalogItem
  variant?: "outline" | "ghost"
}) {
  const { t } = useTranslation()
  if (!item.canonical_url) return null

  return (
    <a
      href={item.canonical_url}
      target="_blank"
      rel="noreferrer noopener"
      className={buttonVariants({ variant, size: "sm" })}
    >
      <ExternalLinkIcon data-icon="inline-start" />
      {t("clawHub.openCanonical")}
    </a>
  )
}

function ClawHubSkillDetailDialog({
  item,
  onOpenChange,
}: {
  item: ClawHubSkillCatalogItem | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const language =
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? "zh-CN"
  const numberFormatter = new Intl.NumberFormat(language)
  const hasSecurityNotice =
    item !== null &&
    (item.is_malware_blocked ||
      item.is_suspicious ||
      item.security_has_warnings)
  const hasAvailabilityNotice =
    item !== null &&
    !item.installable &&
    item.installability_reason !== "already_installed" &&
    !hasSecurityNotice

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-2xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>{item.display_name}</DialogTitle>
              <DialogDescription>
                {item.summary || t("marketplace.noDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{t("capability.skill")}</Badge>
                <Badge variant="outline">{t("clawHub.sourceName")}</Badge>
                <SecurityBadge item={item} />
                {item.installed_capability_id && (
                  <Badge variant="secondary">
                    <CheckCircle2Icon aria-hidden="true" />
                    {t("clawHub.installedState")}
                  </Badge>
                )}
                {item.update_available && (
                  <Badge variant="outline">
                    <RefreshCwIcon aria-hidden="true" />
                    {t("marketplace.updateAvailable")}
                  </Badge>
                )}
              </div>
              {(hasSecurityNotice || hasAvailabilityNotice) && (
                <Alert
                  variant={
                    item.is_malware_blocked || item.is_suspicious
                      ? "destructive"
                      : "default"
                  }
                >
                  {hasSecurityNotice ? (
                    <ShieldAlertIcon aria-hidden="true" />
                  ) : (
                    <CircleAlertIcon aria-hidden="true" />
                  )}
                  <AlertTitle>
                    {t(
                      hasSecurityNotice
                        ? "clawHub.securityNoticeTitle"
                        : "clawHub.unavailableState"
                    )}
                  </AlertTitle>
                  <AlertDescription>
                    {installabilityMessage(item, t) ??
                      t("clawHub.security.warningDescription")}
                  </AlertDescription>
                </Alert>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("clawHub.owner")}</dt>
                <dd>{itemOwner(item) ?? t("common.notAvailable")}</dd>
                <dt className="text-muted-foreground">
                  {t("clawHub.latestVersion")}
                </dt>
                <dd>{item.latest_version ?? t("common.notAvailable")}</dd>
                <dt className="text-muted-foreground">
                  {t("clawHub.downloadCount")}
                </dt>
                <dd>{numberFormatter.format(item.stats.downloads)}</dd>
                <dt className="text-muted-foreground">
                  {t("clawHub.starCount")}
                </dt>
                <dd>{numberFormatter.format(item.stats.stars)}</dd>
                <dt className="text-muted-foreground">
                  {t("clawHub.updatedAt")}
                </dt>
                <dd>{formatDateTime(item.source_updated_at, language)}</dd>
                <dt className="text-muted-foreground">
                  {t("clawHub.syncedAt")}
                </dt>
                <dd>{formatDateTime(item.synced_at, language)}</dd>
              </dl>
              {item.topics.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="font-medium">{t("clawHub.topics")}</h3>
                  <div className="flex flex-wrap gap-2">
                    {item.topics.map((topic) => (
                      <Badge key={topic} variant="outline">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}
              {Boolean(
                item.metadata?.os?.length || item.metadata?.systems?.length
              ) && (
                <section className="flex flex-col gap-2">
                  <h3 className="font-medium">
                    {t("clawHub.platformRequirements")}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {item.metadata?.os?.map((os) => (
                      <Badge key={`os-${os}`} variant="outline">
                        {os}
                      </Badge>
                    ))}
                    {item.metadata?.systems?.map((system) => (
                      <Badge key={`system-${system}`} variant="outline">
                        {system}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}
              {item.latest_version_changelog && (
                <section className="flex flex-col gap-2">
                  <h3 className="font-medium">{t("clawHub.changelog")}</h3>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {item.latest_version_changelog}
                  </p>
                </section>
              )}
            </div>
            <DialogFooter>
              <CanonicalLink item={item} />
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ClawHubInstallPreviewDialog({
  state,
  riskConfirmed,
  error,
  pending,
  onRiskConfirmedChange,
  onConfirm,
  onOpenChange,
}: {
  state: InstallPreviewState | null
  riskConfirmed: boolean
  error: string | null
  pending: boolean
  onRiskConfirmedChange: (checked: boolean) => void
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const preview = state?.preview

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-2xl">
        {state && preview && (
          <>
            <DialogHeader>
              <DialogTitle>
                {t(
                  preview.operation === "update"
                    ? "clawHub.updateTitle"
                    : "clawHub.installTitle",
                  { name: preview.name }
                )}
              </DialogTitle>
              <DialogDescription>
                {t("clawHub.installPreviewDescription")}
              </DialogDescription>
            </DialogHeader>
            {error && (
              <Alert variant="destructive">
                <ShieldAlertIcon aria-hidden="true" />
                <AlertTitle>{t("clawHub.installFailedTitle")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-5">
              {preview.source.source_type === "clawhub" &&
                preview.source.security_has_warnings && (
                  <Alert className="border-[color:var(--app-border)]">
                    <ShieldAlertIcon aria-hidden="true" />
                    <AlertTitle>{t("clawHub.security.warning")}</AlertTitle>
                    <AlertDescription>
                      {t("clawHub.security.warningDescription")}
                    </AlertDescription>
                  </Alert>
                )}
              <section className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{preview.name}</h3>
                  <Badge variant="outline">{t("capability.skill")}</Badge>
                  <Badge variant="outline">{t("clawHub.sourceName")}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {preview.description || t("marketplace.noDescription")}
                </p>
                {preview.source.source_type === "clawhub" && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">
                      {t("clawHub.packageIdentity")}
                    </dt>
                    <dd>
                      @{preview.source.owner_handle}/{preview.source.slug}
                    </dd>
                    <dt className="text-muted-foreground">
                      {t("clawHub.versionToInstall")}
                    </dt>
                    <dd>{preview.source.version}</dd>
                  </dl>
                )}
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="font-medium">{t("marketplace.riskSummary")}</h3>
                <CapabilityRiskSummary value={preview.risk_summary} compact />
              </section>
              {preview.skill_content_preview !== null && (
                <SkillContentPreview
                  type="skill"
                  content={preview.skill_content_preview}
                  truncated={preview.skill_content_truncated}
                />
              )}
              <Field
                orientation="horizontal"
                data-disabled={pending || undefined}
              >
                <Checkbox
                  id="clawhub-risk-confirm"
                  checked={riskConfirmed}
                  disabled={pending}
                  onCheckedChange={(checked) =>
                    onRiskConfirmedChange(Boolean(checked))
                  }
                />
                <FieldLabel htmlFor="clawhub-risk-confirm">
                  {t("capability.riskConfirm")}
                </FieldLabel>
              </Field>
            </div>
            <DialogFooter>
              <CanonicalLink item={state.item} variant="ghost" />
              <DialogClose
                render={
                  <Button type="button" variant="ghost" disabled={pending} />
                }
              >
                {t("common.cancel")}
              </DialogClose>
              <Button
                type="button"
                disabled={!riskConfirmed || pending}
                aria-busy={pending || undefined}
                onClick={onConfirm}
              >
                {pending ? (
                  <Spinner data-icon="inline-start" />
                ) : preview.operation === "update" ? (
                  <RefreshCwIcon data-icon="inline-start" />
                ) : (
                  <DownloadIcon data-icon="inline-start" />
                )}
                {t(
                  pending
                    ? "clawHub.installing"
                    : preview.operation === "update"
                      ? "clawHub.confirmUpdate"
                      : "clawHub.confirmInstall"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ClawHubSkillRepositoryPanel({
  search,
  onFeedback,
}: {
  search: string
  onFeedback: (message: string, isError?: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const normalizedSearch = search.trim()
  const [sort, setSort] = useState<ClawHubSkillCatalogSort>("downloads")
  const [pagination, setPagination] = useState<RepositoryPaginationState>({
    search: normalizedSearch,
    sort: "downloads",
    cursor: undefined,
    cursorStack: [],
  })
  const [selected, setSelected] = useState<ClawHubSkillCatalogItem | null>(null)
  const [installPreview, setInstallPreview] =
    useState<InstallPreviewState | null>(null)
  const [riskConfirmed, setRiskConfirmed] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const paginationMatchesFilters =
    pagination.search === normalizedSearch && pagination.sort === sort
  const cursor = paginationMatchesFilters ? pagination.cursor : undefined
  const cursorStack = paginationMatchesFilters ? pagination.cursorStack : []
  const language =
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? "zh-CN"
  const numberFormatter = new Intl.NumberFormat(language)
  const sortItems = [
    { value: "downloads", label: t("clawHub.sort.downloads") },
    { value: "stars", label: t("clawHub.sort.stars") },
  ] satisfies Array<{ value: ClawHubSkillCatalogSort; label: string }>

  const catalog = useQuery({
    queryKey: ["clawhub", "skills", normalizedSearch, sort, cursor],
    queryFn: ({ signal }) =>
      apiRequest("/clawhub/skills", {
        query: {
          search: normalizedSearch || undefined,
          sort,
          cursor,
          limit: PAGE_SIZE,
        },
        schema: clawHubSkillCatalogPageSchema,
        signal,
      }),
    refetchInterval: CATALOG_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })

  const previewMutation = useMutation({
    mutationFn: (item: ClawHubSkillCatalogItem) =>
      apiRequest(`/clawhub/skills/${item.id}/install-preview`, {
        method: "POST",
        schema: capabilityImportPreviewSchema,
      }),
    onSuccess: (preview, item) => {
      setInstallPreview({ item, preview })
      setRiskConfirmed(false)
      setConfirmError(null)
    },
    onError: (error) => onFeedback(getErrorMessage(error, t), true),
  })

  const confirmMutation = useMutation({
    mutationFn: (state: InstallPreviewState) =>
      apiRequest(
        `/capabilities/imports/${state.preview.preview_token}/confirm`,
        {
          method: "POST",
          schema: capabilitySummarySchema,
        }
      ),
    onMutate: (state) => {
      notify.loading(t(clawHubInstallStatusKey(state)), {
        id: clawHubInstallToastId(state),
      })
    },
    onSuccess: async (_, state) => {
      notify.success(
        t(
          state.preview.operation === "update"
            ? "clawHub.updated"
            : "clawHub.installed"
        ),
        { id: clawHubInstallToastId(state) }
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["clawhub", "skills"] }),
        queryClient.invalidateQueries({ queryKey: ["capabilities"] }),
      ])
    },
    onError: (error, state) => {
      notify.error(getErrorMessage(error, t), {
        id: clawHubInstallToastId(state),
      })
    },
  })

  const items = catalog.data?.items ?? []
  const totalCount = catalog.data?.total_count ?? 0
  const pageNumber = cursorStack.length + 1

  if (catalog.isLoading) {
    return <LoadingState label={t("clawHub.loading")} />
  }
  if (catalog.isError) {
    return (
      <ErrorState
        message={getErrorMessage(catalog.error, t)}
        onRetry={() => void catalog.refetch()}
      />
    )
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={t(
          normalizedSearch ? "clawHub.noSearchResults" : "clawHub.empty"
        )}
        description={
          normalizedSearch
            ? t("clawHub.noSearchResultsDescription", {
                search: normalizedSearch,
              })
            : t("clawHub.emptyDescription")
        }
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t("clawHub.sourceNotice")}
        </p>
        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
          {catalog.isFetching && (
            <span
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner aria-hidden="true" />
              {t("clawHub.refreshing")}
            </span>
          )}
          <Select
            items={sortItems}
            value={sort}
            onValueChange={(value) => {
              if (!value || value === sort) return
              const nextSort = value as ClawHubSkillCatalogSort
              setSort(nextSort)
              setPagination({
                search: normalizedSearch,
                sort: nextSort,
                cursor: undefined,
                cursorStack: [],
              })
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-32"
              aria-label={t("clawHub.sortLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {sortItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.value === "downloads" ? (
                      <DownloadIcon aria-hidden="true" />
                    ) : (
                      <StarIcon aria-hidden="true" />
                    )}
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div
        className="capability-library-grid !mt-0"
        aria-label={t("clawHub.listLabel")}
      >
        {items.map((item) => {
          const previewPending =
            previewMutation.isPending &&
            previewMutation.variables?.id === item.id
          const installed = item.installed_capability_id !== null
          const installMessage = installabilityMessage(item, t)
          const canPreview = item.installable && !installed

          return (
            <CapabilityLibraryItem
              key={item.id}
              name={item.display_name}
              type="skill"
              description={item.summary || t("marketplace.noDescription")}
              metadata={<SkillMetadata item={item} />}
              notice={
                installMessage &&
                item.installability_reason !== "already_installed" ? (
                  <>
                    <ShieldAlertIcon aria-hidden="true" />
                    <span>{installMessage}</span>
                  </>
                ) : undefined
              }
              noticeVariant={
                item.is_suspicious || item.is_malware_blocked
                  ? "destructive"
                  : "default"
              }
              status={
                installed ? (
                  <Badge variant="secondary">
                    <CheckCircle2Icon aria-hidden="true" />
                    {t("clawHub.installedState")}
                  </Badge>
                ) : !item.installable ? (
                  <Badge variant="outline">
                    {t("clawHub.unavailableState")}
                  </Badge>
                ) : undefined
              }
              statusPlacement="bottom-right"
              inspectLabel={t("clawHub.viewDetails", {
                name: item.display_name,
              })}
              onInspect={() => setSelected(item)}
              actions={
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="capability-library-more"
                        aria-label={
                          previewPending
                            ? t("clawHub.preparing")
                            : t("common.actions")
                        }
                        aria-busy={previewPending || undefined}
                      />
                    }
                  >
                    {previewPending ? (
                      <Spinner aria-hidden="true" />
                    ) : (
                      <MoreHorizontalIcon aria-hidden="true" />
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-max min-w-36">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => setSelected(item)}>
                        <EyeIcon aria-hidden="true" />
                        {t("common.view")}
                      </DropdownMenuItem>
                      {item.canonical_url && (
                        <DropdownMenuItem
                          render={
                            <a
                              href={item.canonical_url}
                              target="_blank"
                              rel="noreferrer noopener"
                            />
                          }
                        >
                          <ExternalLinkIcon aria-hidden="true" />
                          {t("clawHub.openCanonical")}
                        </DropdownMenuItem>
                      )}
                      {canPreview && (
                        <DropdownMenuItem
                          disabled={previewMutation.isPending}
                          onClick={() => previewMutation.mutate(item)}
                        >
                          {previewPending ? (
                            <Spinner aria-hidden="true" />
                          ) : (
                            <DownloadIcon aria-hidden="true" />
                          )}
                          {t(
                            previewPending
                              ? "clawHub.preparing"
                              : "marketplace.install"
                          )}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
          )
        })}
      </div>
      <div className="flex min-h-8 flex-col items-center gap-3 pt-2 sm:flex-row sm:justify-between">
        <span className="text-sm text-muted-foreground">
          {t("clawHub.totalCount", {
            count: numberFormatter.format(totalCount),
          })}
        </span>
        {(cursorStack.length > 0 || catalog.data?.next_cursor) && (
          <Pagination
            aria-label={t("clawHub.paginationLabel")}
            className="mx-0 w-auto"
          >
            <PaginationContent>
              <PaginationItem>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cursorStack.length === 0 || catalog.isFetching}
                  onClick={() => {
                    const previousCursor = cursorStack.at(-1)
                    setPagination({
                      search: normalizedSearch,
                      sort,
                      cursor: previousCursor,
                      cursorStack: cursorStack.slice(0, -1),
                    })
                  }}
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                  {t("common.previous")}
                </Button>
              </PaginationItem>
              <PaginationItem>
                <span
                  className="px-2 text-sm text-muted-foreground"
                  aria-current="page"
                >
                  {t("clawHub.pageNumber", { page: pageNumber })}
                </span>
              </PaginationItem>
              <PaginationItem>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!catalog.data?.next_cursor || catalog.isFetching}
                  onClick={() => {
                    const nextCursor = catalog.data?.next_cursor
                    if (!nextCursor) return
                    setPagination({
                      search: normalizedSearch,
                      sort,
                      cursor: nextCursor,
                      cursorStack: [...cursorStack, cursor],
                    })
                  }}
                >
                  {t("common.next")}
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>
      <ClawHubSkillDetailDialog
        item={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
      <ClawHubInstallPreviewDialog
        state={installPreview}
        riskConfirmed={riskConfirmed}
        error={confirmError}
        pending={confirmMutation.isPending}
        onRiskConfirmedChange={setRiskConfirmed}
        onConfirm={() => {
          if (!installPreview) return
          const nextPreview = installPreview
          setInstallPreview(null)
          setRiskConfirmed(false)
          setConfirmError(null)
          confirmMutation.mutate(nextPreview)
        }}
        onOpenChange={(open) => {
          if (!open && !confirmMutation.isPending) {
            setInstallPreview(null)
            setRiskConfirmed(false)
            setConfirmError(null)
          }
        }}
      />
    </div>
  )
}
