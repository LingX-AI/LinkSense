import { useDeferredValue, useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { PlayIcon } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  applicationConversationSchema,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { InputGroup } from "@/components/ui/input-group"
import { SearchInput } from "@/components/ui/search-input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApplicationCatalogPanel } from "./application-catalog-panel"
import {
  applicationDistributionKeys,
  applicationCenterPageSchema,
} from "./application-distribution-queries"
import { ApplicationInstallationDialog } from "./application-installation-dialog"
import { ApplicationUsageModeBadges } from "./application-usage-modes"

export function ApplicationsWorkspacePanel(
  props: Omit<
    React.ComponentProps<typeof ApplicationCatalogPanel>,
    "scope" | "onInstalled"
  >
) {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = readUrlEnum(
    searchParams,
    "app_scope",
    ["owned", "shared", "center"] as const,
    "owned"
  )
  const organizationSharingEnabled = props.organizationSharingEnabled ?? true
  const tab = organizationSharingEnabled ? requestedTab : "owned"
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
        }),
      { replace: true }
    )
  }
  return (
    <Tabs value={tab} onValueChange={selectTab}>
      {organizationSharingEnabled && (
        <TabsList aria-label={t("applications.scopeLabel")}>
          <TabsTrigger value="owned">
            {t("applications.distribution.myApplications")}
          </TabsTrigger>
          <TabsTrigger value="shared">
            {t("applications.distribution.sharedApplications")}
          </TabsTrigger>
          <TabsTrigger value="center">
            {t("applications.distribution.center")}
          </TabsTrigger>
        </TabsList>
      )}
      <TabsContent value="owned">
        {tab === "owned" && (
          <ApplicationCatalogPanel {...props} scope="owned" />
        )}
      </TabsContent>
      {organizationSharingEnabled && (
        <>
          <TabsContent value="shared">
            {tab === "shared" && (
              <ApplicationCatalogPanel
                {...props}
                scope="shared"
                onInstalled={showInstalledApplication}
              />
            )}
          </TabsContent>
          <TabsContent value="center">
            <ApplicationCenterPanel onInstalled={showInstalledApplication} />
          </TabsContent>
        </>
      )}
    </Tabs>
  )
}

export function ApplicationCenterPanel({
  onInstalled,
}: { onInstalled?: () => void } = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [install, setInstall] = useState<ApplicationCenterRelease | null>(null)
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
  const start = useMutation({
    mutationFn: (item: ApplicationCenterRelease) =>
      apiRequest(`/applications/${item.application_id}/conversations`, {
        method: "POST",
        body: { channel: "center" },
        schema: applicationConversationSchema,
      }),
    onSuccess: (result, item) =>
      navigate(
        item.kind === "interactive"
          ? `/applications/${item.application_id}/run/${result.conversation_id}`
          : `/conversations/${result.conversation_id}`
      ),
  })
  const startingApplicationId = start.isPending
    ? start.variables?.application_id
    : null
  return (
    <div className="flex flex-col gap-4">
      <InputGroup>
        <SearchInput
          aria-label={t("applications.distribution.centerSearch")}
          placeholder={t("applications.searchPlaceholder")}
          value={search}
          onValueChange={setSearch}
        />
      </InputGroup>
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
          <Card key={item.id} className="min-w-0">
            <CardHeader>
              <CardTitle className="break-words">{item.name}</CardTitle>
              <CardDescription>
                {t("applications.createdBy", { name: item.publisher_name })} ·{" "}
                {t("applications.distribution.version", {
                  version: item.version_number,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-[length:var(--app-font-13)] leading-5 break-words">
                {item.description || t("applications.noDescription")}
              </p>
              <ApplicationUsageModeBadges modes={item.usage_modes} />
              <p className="text-[length:var(--app-font-13)] leading-5 break-words whitespace-pre-wrap">
                {item.usage_instructions}
              </p>
            </CardContent>
            <CardFooter className="flex-wrap justify-end gap-2">
              {item.usage_modes.includes("install") && (
                <Button
                  variant="outline"
                  disabled={Boolean(item.installed_application_id)}
                  onClick={() => setInstall(item)}
                >
                  {t(
                    item.installed_application_id
                      ? "applications.distribution.installedLabel"
                      : "applications.distribution.install"
                  )}
                </Button>
              )}
              {item.usage_modes.includes("service") && (
                <Button
                  variant="secondary"
                  aria-busy={
                    startingApplicationId === item.application_id || undefined
                  }
                  disabled={start.isPending}
                  onClick={() => start.mutate(item)}
                >
                  {startingApplicationId === item.application_id ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <PlayIcon data-icon="inline-start" aria-hidden="true" />
                  )}
                  {t("applications.distribution.useService")}
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
      {install && (
        <ApplicationInstallationDialog
          target={{
            id: install.application_id,
            name: install.name,
            channel: "center",
            versionId: install.version_id,
          }}
          onClose={() => setInstall(null)}
          onInstalled={() => {
            setInstall(null)
            onInstalled?.()
            notify.success(t("applications.distribution.installed"))
          }}
        />
      )}
    </div>
  )
}
