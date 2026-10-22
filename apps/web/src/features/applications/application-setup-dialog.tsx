import { useDeferredValue, useId, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { ArrowUpRightIcon, CircleCheckIcon, RefreshCwIcon } from "lucide-react"
import {
  interactiveDependencyOptionsSchema,
  type Application,
  type ApplicationSetupItem,
  type InteractiveDependencyType,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { notify } from "@/components/feedback/notification"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { capabilityCenterPath } from "@/features/capabilities/capability-center-navigation"
import { useApplicationSetup } from "./use-application-setup"
import { ApplicationSetupModelField } from "./application-setup-model-field"

export function ApplicationSetupDialog({
  application,
  onClose,
  onUse,
  starting = false,
  startError,
}: {
  application: Pick<Application, "id" | "name">
  onClose: () => void
  onUse: () => void
  starting?: boolean
  startError?: unknown
}) {
  const { t } = useTranslation()
  const { query, save, saveModel, complete } = useApplicationSetup(
    application.id,
    () => notify.success(t("applicationSetup.completed"))
  )
  const guide = query.data
  const pending =
    save.isPending || saveModel.isPending || complete.isPending || starting
  const blocked = pending || query.isFetching || query.isError
  const completed =
    guide?.items.filter((item) => item.status === "configured").length ?? 0
  const error = save.error ?? saveModel.error ?? complete.error ?? startError
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("applicationSetup.title")}</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            {t("applicationSetup.description", { name: application.name })}
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyStyles("flex flex-col gap-5")}>
          {query.isPending && <LoadingState />}
          {query.error && (
            <ErrorState
              message={getErrorMessage(query.error, t)}
              onRetry={() => void query.refetch()}
            />
          )}
          {Boolean(error) && (
            <StatusBanner variant="error">
              {getErrorMessage(error, t)}
            </StatusBanner>
          )}
          {guide && (
            <>
              <Progress
                value={completed}
                max={guide.items.length || 1}
                aria-label={t("applicationSetup.progress", {
                  completed,
                  total: guide.items.length,
                })}
              >
                <ProgressLabel>
                  {t("applications.distribution.installedVersion", {
                    version: guide.installed_version_number,
                  })}
                </ProgressLabel>
                <ProgressValue>
                  {t("applicationSetup.progress", {
                    completed,
                    total: guide.items.length,
                  })}
                </ProgressValue>
              </Progress>
              <StatusBanner variant={guide.can_use ? "success" : "info"}>
                {t(
                  guide.can_use
                    ? "applicationSetup.ready"
                    : guide.can_complete
                      ? "applicationSetup.activate"
                      : "applicationSetup.pending"
                )}
              </StatusBanner>
              {guide.usage_instructions && (
                <section
                  aria-label={t("applications.distribution.guide")}
                  className="flex flex-col gap-2"
                >
                  <h3 className="text-sm font-medium">
                    {t("applications.distribution.guide")}
                  </h3>
                  <p className="text-sm wrap-anywhere whitespace-pre-wrap">
                    {guide.usage_instructions}
                  </p>
                </section>
              )}
              <ol className="flex min-w-0 flex-col gap-3">
                {guide.items.map((item) => {
                  const typeName = t(`applicationSetup.types.${item.type}`)
                  const name =
                    item.name ??
                    (item.type === "model"
                      ? t("applicationSetup.modelDefault")
                      : t("applicationSetup.unnamed", {
                          type: typeName,
                          number: item.position + 1,
                        }))
                  return (
                    <li key={`${item.type}:${item.id}`}>
                      <Card size="sm">
                        <CardHeader>
                          <CardTitle className="flex flex-wrap items-center gap-2">
                            {item.status === "configured" && (
                              <CircleCheckIcon
                                aria-hidden="true"
                                className="size-4 shrink-0 text-success"
                              />
                            )}
                            <span className="min-w-0 flex-1 wrap-anywhere">
                              {name}
                            </span>
                            <Badge variant="outline">
                              {t("applicationSetup.required")}
                            </Badge>
                            <Badge
                              variant={
                                item.status === "configured"
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {t(`applicationSetup.statuses.${item.status}`)}
                            </Badge>
                          </CardTitle>
                          <CardDescription className="wrap-anywhere">
                            {item.type === "model"
                              ? t("applicationSetup.modelHelp")
                              : item.description ||
                                t(`applicationSetup.purposes.${item.type}`)}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {item.type === "model" ? (
                            <ApplicationSetupModelField
                              guide={guide}
                              disabled={blocked}
                              onChange={(input) => saveModel.mutate(input)}
                            />
                          ) : (
                            <SetupResourceField
                              item={item}
                              type={item.type}
                              name={name}
                              disabled={blocked}
                              usedIds={guide.items
                                .filter(
                                  (other) =>
                                    other.type === item.type &&
                                    other.id !== item.id
                                )
                                .flatMap((other) =>
                                  other.resource_id ? [other.resource_id] : []
                                )}
                              onChange={(type, resourceId) =>
                                save.mutate({
                                  installed_version_id:
                                    guide.installed_version_id,
                                  updated_at: guide.updated_at,
                                  type,
                                  position: item.position,
                                  resource_id: resourceId,
                                })
                              }
                            />
                          )}
                        </CardContent>
                      </Card>
                    </li>
                  )
                })}
              </ol>
              <p className="text-xs text-muted-foreground">
                {t("applicationSetup.newTab")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("applicationSetup.note")}
              </p>
            </>
          )}
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("applicationSetup.later")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              save.reset()
              complete.reset()
              saveModel.reset()
              void query.refetch()
            }}
            disabled={pending || query.isFetching}
          >
            {query.isFetching ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            {t("applicationSetup.check")}
          </Button>
          {guide?.can_use ? (
            <Button onClick={onUse} disabled={blocked}>
              {starting && <Spinner data-icon="inline-start" />}
              {t("applicationSetup.use")}
            </Button>
          ) : (
            <Button
              disabled={blocked || !guide?.can_complete}
              onClick={() => {
                if (guide)
                  complete.mutate({
                    installed_version_id: guide.installed_version_id,
                    updated_at: guide.updated_at,
                  })
              }}
            >
              {complete.isPending && <Spinner data-icon="inline-start" />}
              {t("applicationSetup.complete")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SetupResourceField({
  item,
  type,
  name,
  disabled,
  usedIds,
  onChange,
}: {
  item: ApplicationSetupItem
  type: InteractiveDependencyType
  name: string
  disabled: boolean
  usedIds: string[]
  onChange: (type: InteractiveDependencyType, resourceId: string | null) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const options = useInfiniteQuery({
    queryKey: ["interactive-dependency-options", "setup", type, deferredSearch],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiRequest("/applications/interactive-dependency-options", {
        query: { type, search: deferredSearch || undefined, cursor: pageParam },
        schema: interactiveDependencyOptionsSchema,
        signal,
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: open,
    staleTime: 0,
  })
  const selected = item.resource_id
    ? { id: item.resource_id, name: item.resource_name ?? name }
    : null
  const resources = [
    ...new Map(
      [
        ...(selected ? [selected] : []),
        ...(options.data?.pages.flatMap((page) => page.items) ?? []),
      ].map((resource) => [resource.id, resource])
    ).values(),
  ]
  const manageHref =
    type === "knowledge_base"
      ? "/knowledge-bases"
      : type === "mcp_server"
        ? "/settings/mcp"
        : capabilityCenterPath({
            section: type,
            scope: "personal",
            search: item.resource_name ?? item.name ?? "",
          })
  const showPicker =
    type === "knowledge_base" ||
    type === "mcp_server" ||
    item.status === "unconfigured" ||
    item.status === "unavailable"
  return (
    <FieldGroup>
      {item.resource_name && (
        <FieldDescription>
          {t("applicationSetup.selected", { name: item.resource_name })}
        </FieldDescription>
      )}
      {showPicker && (
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor={id}>{t("applicationSetup.choose")}</FieldLabel>
          <Combobox
            items={resources}
            value={selected}
            disabled={disabled}
            onValueChange={(resource) => onChange(type, resource?.id ?? null)}
            onOpenChange={(value) => {
              setOpen(value)
              if (!value) setSearch("")
            }}
            onInputValueChange={(value, details) =>
              setSearch(details.reason === "input-change" ? value : "")
            }
            itemToStringLabel={(resource) => resource.name}
            itemToStringValue={(resource) => resource.id}
            isItemEqualToValue={(resource, value) => resource.id === value.id}
          >
            <ComboboxInput
              id={id}
              aria-label={t("applicationSetup.chooseNamed", { name })}
              placeholder={t("applicationSetup.search")}
              showClear={selected !== null}
              clearLabel={t("applications.dependencies.clear")}
              disabled={disabled}
            />
            <ComboboxContent>
              <ComboboxEmpty>
                {t(
                  options.isFetching
                    ? "common.loading"
                    : "applications.resourceSearchEmpty"
                )}
              </ComboboxEmpty>
              <ComboboxList>
                {(resource: { id: string; name: string }) => (
                  <ComboboxItem
                    key={resource.id}
                    value={resource}
                    disabled={usedIds.includes(resource.id)}
                  >
                    {resource.name}
                  </ComboboxItem>
                )}
              </ComboboxList>
              {options.hasNextPage && (
                <Button
                  className="w-full"
                  variant="ghost"
                  disabled={options.isFetchingNextPage}
                  onClick={() => void options.fetchNextPage()}
                >
                  {t("common.loadMore")}
                </Button>
              )}
            </ComboboxContent>
          </Combobox>
          {options.error && (
            <ErrorState
              message={getErrorMessage(options.error, t)}
              onRetry={() => void options.refetch()}
            />
          )}
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        {item.status === "credentials_required" && (
          <Button
            render={
              <Link
                to="/settings/credentials"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            variant="outline"
            size="sm"
            disabled={disabled}
          >
            {t("applicationSetup.credentials")}
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
        )}
        <Button
          render={
            <Link to={manageHref} target="_blank" rel="noopener noreferrer" />
          }
          variant="outline"
          size="sm"
          disabled={disabled}
        >
          {t("applicationSetup.manage")}
          <ArrowUpRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </FieldGroup>
  )
}
