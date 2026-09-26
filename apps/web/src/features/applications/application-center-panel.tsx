import { useOpenApplicationConversation } from "./application-opening"
import { useDeferredValue, useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ArrowUpRightIcon, ListFilterIcon } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import {
  applicationCatalogFilterSchema,
  type ApplicationCenterRelease,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"
import { getErrorMessage } from "@/api/error-message"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { InputGroup } from "@/components/ui/input-group"
import { SearchInput } from "@/components/ui/search-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApplicationCatalogPanel } from "./application-catalog-panel"
import {
  applicationDistributionKeys,
  applicationCenterPageSchema,
} from "./application-distribution-queries"
import { ApplicationInstallationDialog } from "./application-installation-dialog"
import { ApplicationUsageModeBadges } from "./application-usage-modes"
import {
  ApplicationDetailsDialog,
  type ApplicationDetailsTarget,
} from "./application-details-dialog"
import { ApplicationCard } from "./application-card"
import { defaultApplicationIcon } from "./application-icon-default"
import { applicationWorkspaceScope } from "./application-workspace-scope"

export function ApplicationsWorkspacePanel(
  props: Omit<
    React.ComponentProps<typeof ApplicationCatalogPanel>,
    "scope" | "search" | "state" | "onInstalled"
  >
) {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = applicationWorkspaceScope(searchParams)
  const organizationSharingEnabled = props.organizationSharingEnabled ?? true
  const tab = applicationWorkspaceScope(
    searchParams,
    organizationSharingEnabled
  )
  const search = searchParams.get("app_search") ?? ""
  const state = readUrlEnum(
    searchParams,
    "app_state",
    applicationCatalogFilterSchema.options,
    "all"
  )
  const stateOptions = applicationCatalogFilterSchema.options.map((value) => ({
    value,
    label: t(`applicationDevelopment.catalog.${value}`),
  }))
  const [centerSearch, setCenterSearch] = useState("")
  useEffect(() => {
    if (organizationSharingEnabled || requestedTab === "owned") return
    setSearchParams(
      (current) => updateUrlSearchParams(current, { app_scope: "owned" }),
      { replace: true }
    )
  }, [organizationSharingEnabled, requestedTab, setSearchParams])
  const selectTab = (value: string) => {
    setSearchParams(
      (current) => updateUrlSearchParams(current, { app_scope: value }),
      { replace: true }
    )
  }
  const showInstalledApplication = () => {
    setSearchParams(
      (current) =>
        updateUrlSearchParams(current, {
          app_scope: "owned",
          app_search: null,
          app_state: null,
        }),
      { replace: true }
    )
  }
  return (
    <Tabs value={tab} onValueChange={selectTab} className="gap-6">
      <div
        data-slot="application-catalog-toolbar"
        className="flex min-w-0 flex-col gap-3"
      >
        {organizationSharingEnabled && (
          <TabsList
            aria-label={t("applications.scopeLabel")}
            className="h-auto w-full flex-wrap justify-start overflow-visible"
          >
            <TabsTrigger value="owned" className="flex-none">
              {t("applications.distribution.myApplications")}
            </TabsTrigger>
            <TabsTrigger value="shared" className="flex-none">
              {t("applications.distribution.sharedApplications")}
            </TabsTrigger>
            <TabsTrigger value="center" className="flex-none">
              {t("applications.distribution.center")}
            </TabsTrigger>
          </TabsList>
        )}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <InputGroup className="min-w-0 flex-1 basis-64">
            <SearchInput
              aria-label={t(
                tab === "center"
                  ? "applications.distribution.centerSearch"
                  : "applications.search"
              )}
              placeholder={t("applications.searchPlaceholder")}
              value={tab === "center" ? centerSearch : search}
              onValueChange={(value) => {
                if (tab === "center") {
                  setCenterSearch(value)
                } else {
                  setSearchParams(
                    (current) =>
                      updateUrlSearchParams(current, { app_search: value }),
                    { replace: true }
                  )
                }
              }}
            />
          </InputGroup>
          {tab === "owned" && (
            <Select
              items={stateOptions}
              value={state}
              onValueChange={(value) => {
                if (!value) return
                setSearchParams(
                  (current) =>
                    updateUrlSearchParams(current, {
                      app_state: value === "all" ? null : value,
                    }),
                  { replace: true }
                )
              }}
            >
              <SelectTrigger
                aria-label={t("applicationDevelopment.catalog.filter")}
                className="shrink-0"
              >
                <ListFilterIcon aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  {stateOptions.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <TabsContent value="owned">
        {tab === "owned" && (
          <ApplicationCatalogPanel
            {...props}
            scope="owned"
            search={search}
            state={state}
          />
        )}
      </TabsContent>
      {organizationSharingEnabled && (
        <>
          <TabsContent value="shared">
            {tab === "shared" && (
              <ApplicationCatalogPanel
                {...props}
                scope="shared"
                search={search}
                onInstalled={showInstalledApplication}
              />
            )}
          </TabsContent>
          <TabsContent value="center">
            <ApplicationCenterPanel
              search={centerSearch}
              onInstalled={showInstalledApplication}
            />
          </TabsContent>
        </>
      )}
    </Tabs>
  )
}

export function ApplicationCenterPanel({
  search,
  onInstalled,
}: {
  search: string
  onInstalled?: () => void
}) {
  const { t } = useTranslation()
  const [install, setInstall] = useState<ApplicationCenterRelease | null>(null)
  const [installMode, setInstallMode] = useState<"install" | "service">(
    "install"
  )
  const [details, setDetails] = useState<ApplicationDetailsTarget | null>(null)
  const deferred = useDeferredValue(search.trim())
  const query = useQuery({
    queryKey: applicationDistributionKeys.center(deferred),
    queryFn: ({ signal }) =>
      apiRequest("/application-center", {
        query: { search: deferred || undefined },
        schema: applicationCenterPageSchema,
        signal,
      }),
  })
  const start = useOpenApplicationConversation("center")
  const startingApplicationId = start.isPending
    ? start.variables?.applicationId
    : null
  return (
    <div className="flex flex-col gap-4">
      {query.isPending && <LoadingState />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      )}
      {start.error && (
        <StatusBanner variant="error">
          {getErrorMessage(start.error, t)}
        </StatusBanner>
      )}
      {query.data?.items.length === 0 && (
        <EmptyState
          title={t("applications.distribution.noCenterApplications")}
        />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {query.data?.items.map((item) => (
          <ApplicationCard
            key={item.id}
            id={item.application_id}
            name={item.name}
            kind={item.kind}
            icon={defaultApplicationIcon}
            version={item.version_number}
            description={item.description}
            onOpenDetails={setDetails}
            footer={
              <span className="block truncate">
                {t("applications.createdBy", { name: item.publisher_name })}
              </span>
            }
            actions={
              <>
                {item.usage_modes.includes("install") && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      Boolean(item.installed_application_id) &&
                      !item.copy_installation?.update_available
                    }
                    onClick={() => {
                      setInstallMode("install")
                      setInstall(item)
                    }}
                  >
                    {t(
                      item.copy_installation?.update_available
                        ? "applications.distribution.updateAvailable"
                        : item.installed_application_id
                          ? "applications.distribution.installedLabel"
                          : "applications.distribution.install"
                    )}
                  </Button>
                )}
                {item.usage_modes.includes("service") && (
                  <>
                    {(!item.service_installation?.installed_version_id ||
                      item.service_installation.update_available) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setInstallMode("service")
                          setInstall(item)
                        }}
                      >
                        {t(
                          item.service_installation?.update_available
                            ? "applications.distribution.updateAvailable"
                            : "applications.distribution.install"
                        )}
                      </Button>
                    )}
                    {item.service_installation?.installed_version_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-busy={
                          startingApplicationId === item.application_id ||
                          undefined
                        }
                        disabled={start.isPending}
                        onClick={() =>
                          start.mutate({
                            id: item.application_id,
                            kind: item.kind,
                          })
                        }
                      >
                        {startingApplicationId === item.application_id && (
                          <Spinner data-icon="inline-start" />
                        )}
                        {t("applications.distribution.useService")}
                        {startingApplicationId !== item.application_id && (
                          <ArrowUpRightIcon
                            data-icon="inline-end"
                            aria-hidden="true"
                          />
                        )}
                      </Button>
                    )}
                  </>
                )}
              </>
            }
          >
            <ApplicationUsageModeBadges modes={item.usage_modes} />
            <p className="text-[length:var(--app-font-13)] leading-5 wrap-anywhere whitespace-pre-wrap text-muted-foreground">
              {item.usage_instructions}
            </p>
          </ApplicationCard>
        ))}
      </div>
      {details && (
        <ApplicationDetailsDialog
          target={details}
          channel="center"
          onClose={() => setDetails(null)}
        />
      )}
      {install && (
        <ApplicationInstallationDialog
          target={{
            id: install.application_id,
            name: install.name,
            channel: "center",
            versionId: install.version_id,
            mode: installMode,
            versionNumber: install.version_number,
            installedVersionNumber: (installMode === "service"
              ? install.service_installation
              : install.copy_installation
            )?.installed_version_number,
          }}
          onClose={() => setInstall(null)}
          onInstalled={() => {
            setInstall(null)
            void query.refetch()
            if (installMode === "install") onInstalled?.()
            notify.success(t("applications.distribution.installed"))
          }}
        />
      )}
    </div>
  )
}
