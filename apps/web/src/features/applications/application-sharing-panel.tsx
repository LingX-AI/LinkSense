import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Share2Icon, UserIcon, UserRoundIcon, UsersIcon } from "lucide-react"
import { z } from "zod"
import {
  applicationShareInputSchema,
  applicationPublicationSchema,
  type ApplicationUsageMode,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import {
  applicationGrantSchema,
  applicationShareTargetSchema,
  paginatedSchema,
  type Application,
  type ApplicationGrant,
  type ApplicationShareTarget,
} from "@/api/contracts"
import { notify } from "@/components/feedback/notification"
import { LoadingState } from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { RequiredIndicator } from "@/components/forms/required-indicator"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
} from "@/components/ui/combobox"
import { ApplicationGrantPermissions } from "./application-grant-permissions"
import { ApplicationDistributionLayout } from "./application-distribution-layout"
import { ApplicationUsageModes } from "./application-usage-modes"
import { ApplicationVersionFields } from "./application-version-fields"
import { useApplicationVersionForm } from "./use-application-version-form"
const applicationGrantPageSchema = paginatedSchema(applicationGrantSchema)
const applicationShareTargetPageSchema = paginatedSchema(
  applicationShareTargetSchema
)
const emptyResponseSchema = z.unknown()
type ApplicationShareDisplayItem =
  | { kind: "selected"; target: ApplicationShareTarget }
  | { kind: "grant"; grant: ApplicationGrant }

export function ApplicationSharingPanel({
  application,
  onSaved,
}: {
  application: Application
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [usageModes, setUsageModes] = useState<ApplicationUsageMode[]>([
    "service",
  ])
  const [shareTargetType, setShareTargetType] =
    useState<ApplicationShareTarget["type"]>("user")
  const [search, setSearch] = useState("")
  const [selectedTarget, setSelectedTarget] =
    useState<ApplicationShareTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const applicationId = application.id
  const versionForm = useApplicationVersionForm(applicationId)
  const grants = useQuery({
    queryKey: ["applications", applicationId, "grants"],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}/grants`, {
        schema: applicationGrantPageSchema,
        signal,
      }),
    enabled: Boolean(applicationId),
  })
  const targets = useQuery({
    queryKey: ["applications", "share-targets", shareTargetType, search],
    queryFn: ({ signal }) =>
      apiRequest("/applications/share-targets", {
        query: { type: shareTargetType, search: search.trim() || undefined },
        schema: applicationShareTargetPageSchema,
        signal,
      }),
    enabled: Boolean(applicationId),
  })

  const grant = useMutation({
    mutationFn: (target: ApplicationShareTarget | null) =>
      apiRequest(`/applications/${applicationId}/share`, {
        method: "POST",
        schema: applicationPublicationSchema,
        body: applicationShareInputSchema.parse({
          ...versionForm.input,
          target: target
            ? target.type === "user"
              ? {
                  grantee_type: "user",
                  user_id: target.id,
                  usage_modes: usageModes,
                }
              : {
                  grantee_type: "user_group",
                  user_group_id: target.id,
                  usage_modes: usageModes,
                }
            : null,
        }),
      }),
    onSuccess: async () => {
      setSelectedTarget(null)
      setSearch("")
      setError(null)
      notify.success(t("applications.shareSaved"))
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      onSaved()
    },
    onError: (error) => {
      setError(getErrorMessage(error, t))
      void versionForm.settings.refetch()
    },
  })

  const revoke = useMutation({
    mutationFn: (item: ApplicationGrant) =>
      apiRequest(`/applications/${applicationId}/grants/${item.id}`, {
        method: "DELETE",
        schema: emptyResponseSchema,
      }),
    onSuccess: async () => {
      setError(null)
      await queryClient.invalidateQueries({
        queryKey: ["applications", applicationId, "grants"],
      })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })
  const availableTargets = (targets.data?.items ?? []).filter(
    (target) =>
      target.type === shareTargetType &&
      !(grants.data?.items ?? []).some(
        (item) =>
          item.grantee_type === target.type && item.target.id === target.id
      )
  )
  const targetInputLabel = (target: ApplicationShareTarget) => target.name
  const selected =
    selectedTarget?.type === shareTargetType && search === selectedTarget.name
      ? selectedTarget
      : null
  const grantItems = grants.data?.items ?? []
  const targetRequired = grantItems.length === 0
  const selectedAlreadyShared =
    selected !== null &&
    grantItems.some(
      (item) =>
        item.grantee_type === selected.type && item.target.id === selected.id
    )
  const displayShareItems: ApplicationShareDisplayItem[] = [
    ...(selected && !selectedAlreadyShared
      ? [{ kind: "selected" as const, target: selected }]
      : []),
    ...grantItems.map((item) => ({ kind: "grant" as const, grant: item })),
  ]
  const shareTargetLabel =
    shareTargetType === "user"
      ? t("applications.shareUserTarget")
      : t("applications.shareGroupTarget")
  const shareSearchPlaceholder =
    shareTargetType === "user"
      ? t("applications.shareUserSearchPlaceholder")
      : t("applications.shareGroupSearchPlaceholder")

  return (
    <ApplicationDistributionLayout
      actions={
        <Button
          type="button"
          disabled={
            !versionForm.valid ||
            (!selected && grantItems.length === 0) ||
            usageModes.length === 0 ||
            grant.isPending ||
            application.status !== "active"
          }
          onClick={() => {
            grant.mutate(selected)
          }}
        >
          <Share2Icon data-icon="inline-start" />
          {t(
            selected
              ? "applications.share"
              : "applications.distribution.saveSharing"
          )}
        </Button>
      }
    >
      <ApplicationVersionFields form={versionForm} disabled={grant.isPending} />
      <ApplicationUsageModes
        value={usageModes}
        onChange={setUsageModes}
        disabled={grant.isPending}
      />
      <FieldGroup>
        <Field>
          <FieldLabel>{t("applications.shareTargetType")}</FieldLabel>
          <Tabs
            value={shareTargetType}
            onValueChange={(value) => {
              if (value !== "user" && value !== "user_group") return
              setShareTargetType(value)
              setSelectedTarget(null)
              setSearch("")
              setError(null)
            }}
          >
            <TabsList
              className="share-target-type-options"
              aria-label={t("applications.shareTargetType")}
            >
              <TabsTrigger value="user">
                <UserIcon aria-hidden="true" />
                {t("applications.shareToUsers")}
              </TabsTrigger>
              <TabsTrigger value="user_group">
                <UsersIcon aria-hidden="true" />
                {t("applications.shareToGroups")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </Field>
        <Field>
          <FieldLabel htmlFor="application-share-search">
            {shareTargetLabel}
            {targetRequired && <RequiredIndicator />}
          </FieldLabel>
          <Combobox
            items={availableTargets}
            value={selected}
            inputValue={search}
            disabled={grant.isPending}
            itemToStringLabel={targetInputLabel}
            itemToStringValue={(target) => `${target.type}:${target.id}`}
            isItemEqualToValue={(target, value) =>
              target.type === value.type && target.id === value.id
            }
            onInputValueChange={setSearch}
            onValueChange={(target) => {
              const nextTarget = target ?? null
              setSelectedTarget(nextTarget)
              setSearch(nextTarget?.name ?? "")
            }}
          >
            <ComboboxInput
              id="application-share-search"
              aria-label={shareTargetLabel}
              aria-required={targetRequired || undefined}
              disabled={grant.isPending}
              placeholder={shareSearchPlaceholder}
              showClear={search.length > 0}
            />
            <ComboboxContent>
              <ComboboxEmpty>
                {targets.isLoading
                  ? t("common.loading")
                  : targets.isError
                    ? getErrorMessage(targets.error, t)
                    : t("applications.resourceSearchEmpty")}
              </ComboboxEmpty>
              <ComboboxList>
                {(target: ApplicationShareTarget) => (
                  <ComboboxItem
                    key={`${target.type}:${target.id}`}
                    value={target}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
                      <span className="min-w-0 truncate font-medium">
                        {target.name}
                      </span>
                      {target.secondary_text && (
                        <span className="shrink-0 text-muted-foreground">
                          {target.secondary_text}
                        </span>
                      )}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Field>
        <Field>
          <FieldLabel>{t("applications.currentShares")}</FieldLabel>
          {grants.isLoading ? (
            <LoadingState />
          ) : displayShareItems.length === 0 ? (
            <p className="application-share-current-empty rounded-xl border p-4 text-sm text-muted-foreground">
              {t("applications.noShares")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {displayShareItems.map((item) => {
                const type =
                  item.kind === "grant"
                    ? item.grant.grantee_type
                    : item.target.type
                const name =
                  item.kind === "grant"
                    ? item.grant.target.name
                    : item.target.name
                return (
                  <div
                    key={
                      item.kind === "grant"
                        ? item.grant.id
                        : `selected:${item.target.type}:${item.target.id}`
                    }
                    className="application-share-current-item flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {type === "user" ? (
                        <UserRoundIcon
                          aria-hidden="true"
                          className="size-5 shrink-0"
                        />
                      ) : (
                        <UsersIcon
                          aria-hidden="true"
                          className="size-5 shrink-0"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {name}
                      </span>
                      {item.kind === "grant" && (
                        <ApplicationGrantPermissions grant={item.grant} />
                      )}
                      <Badge variant="secondary" className="shrink-0">
                        {t(`applications.shareGrantType.${type}`)}
                      </Badge>
                    </div>
                    {item.kind === "grant" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(item.grant)}
                      >
                        {t("applications.revoke")}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Field>
      </FieldGroup>
      {(error || grants.error || targets.error) && (
        <StatusBanner variant="error">
          {error ?? getErrorMessage(grants.error ?? targets.error, t)}
        </StatusBanner>
      )}
      <FieldDescription size="caption">
        {t("applications.distribution.revokeHint")}
      </FieldDescription>
    </ApplicationDistributionLayout>
  )
}
