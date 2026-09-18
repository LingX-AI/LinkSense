import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  applicationDevelopmentCapabilitiesSchema,
  applicationDevelopmentCapabilitiesUpdateSchema,
  applicationDevelopmentSchema,
  type ApplicationDevelopmentCapabilities,
  type InteractiveDependencyType,
} from "@linksense/shared"
import { apiRequest, ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { LoadingState } from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { applicationDevelopmentKeys } from "./application-development-api"
import {
  ApplicationDevelopmentCapabilityPicker,
  type SelectedApplicationCapability,
} from "./application-development-capability-picker"

export function ApplicationDevelopmentCapabilitiesDialog({
  developmentId,
  onClose,
}: {
  developmentId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const query = useQuery({
    queryKey: applicationDevelopmentKeys.capabilities(user?.id, developmentId),
    queryFn: ({ signal }) =>
      apiRequest(`/application-developments/${developmentId}/capabilities`, {
        schema: applicationDevelopmentCapabilitiesSchema,
        signal,
      }),
    // An open form is a snapshot. Background refetches must not reset unsaved selections.
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [saving, setSaving] = useState(false)
  const [formGeneration, setFormGeneration] = useState(0)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("applicationDevelopment.capabilities")}</DialogTitle>
          <DialogDescription>
            {t("applicationDevelopment.capabilitiesHint")}
          </DialogDescription>
        </DialogHeader>
        {(query.isPending || !query.isFetchedAfterMount) && <LoadingState />}
        {query.error && (
          <StatusBanner variant="error">
            {getErrorMessage(query.error, t)}
            <Button
              variant="ghost"
              size="sm"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t("common.retry")}
            </Button>
          </StatusBanner>
        )}
        {query.data && query.isFetchedAfterMount && (
          <CapabilitiesForm
            key={`${query.data.source_hash}:${formGeneration}`}
            initial={query.data}
            developmentId={developmentId}
            onClose={onClose}
            onSaving={setSaving}
            onReload={() => {
              void query.refetch().then((result) => {
                if (result.isSuccess) setFormGeneration((value) => value + 1)
              })
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CapabilitiesForm({
  initial,
  developmentId,
  onClose,
  onSaving,
  onReload,
}: {
  initial: ApplicationDevelopmentCapabilities
  developmentId: string
  onClose: () => void
  onSaving: (saving: boolean) => void
  onReload: () => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const client = useQueryClient()
  const [selected, setSelected] = useState<
    Record<InteractiveDependencyType, SelectedApplicationCapability[]>
  >(() => {
    const itemsFor = (type: InteractiveDependencyType) => [
      ...new Map(
        initial.dependencies.items
          .filter((item) => item.type === type)
          .map((item) => {
            const id = item.resource_id ?? item.id
            return [
              id,
              {
                id,
                name: item.resource_name ?? item.name,
                available: item.available,
              },
            ]
          })
      ).values(),
    ]
    return {
      plugin: itemsFor("plugin"),
      skill: itemsFor("skill"),
      knowledge_base: itemsFor("knowledge_base"),
      mcp_server: itemsFor("mcp_server"),
    }
  })
  const declarations = (type: InteractiveDependencyType) =>
    selected[type].map(({ id, name }) => ({ id, name }))
  const input = applicationDevelopmentCapabilitiesUpdateSchema.safeParse({
    source_hash: initial.source_hash,
    dependencies: {
      plugins: declarations("plugin"),
      skills: declarations("skill"),
      knowledge_bases: declarations("knowledge_base"),
      mcp_servers: declarations("mcp_server"),
    },
  })
  const unavailable = Object.values(selected)
    .flat()
    .some((item) => !item.available)
  const mutation = useMutation({
    mutationFn: () => {
      const body = applicationDevelopmentCapabilitiesUpdateSchema.parse(
        input.success ? input.data : undefined
      )
      return apiRequest(
        `/application-developments/${developmentId}/capabilities`,
        { method: "PATCH", body, schema: applicationDevelopmentSchema }
      )
    },
    onMutate: async () => {
      onSaving(true)
      await client.cancelQueries({
        queryKey: applicationDevelopmentKeys.preview(user?.id, developmentId),
      })
    },
    onSuccess: async (next) => {
      client.setQueryData(
        applicationDevelopmentKeys.preview(user?.id, developmentId),
        next
      )
      await Promise.all([
        client.invalidateQueries({ queryKey: ["applications"] }),
        client.invalidateQueries({
          queryKey: applicationDevelopmentKeys.capabilities(
            user?.id,
            developmentId
          ),
          refetchType: "none",
        }),
        client.invalidateQueries({
          queryKey: applicationDevelopmentKeys.tests(user?.id, developmentId),
        }),
      ])
      onClose()
    },
    onSettled: () => onSaving(false),
  })
  return (
    <>
      <div className={dialogBodyStyles()}>
        <FieldGroup>
          {(["plugin", "skill", "knowledge_base", "mcp_server"] as const).map(
            (type) => (
              <ApplicationDevelopmentCapabilityPicker
                key={type}
                type={type}
                selected={selected[type]}
                disabled={mutation.isPending}
                limitReached={
                  type === "plugin" || type === "skill"
                    ? selected.plugin.length + selected.skill.length >= 50
                    : selected[type].length >= 20
                }
                onChange={(items) =>
                  setSelected((current) => ({ ...current, [type]: items }))
                }
              />
            )
          )}
          <FieldDescription>
            {t("applicationDevelopment.capabilityLimits")}
          </FieldDescription>
          {unavailable && (
            <StatusBanner variant="warning">
              {t("applicationDevelopment.capabilitiesUnavailable")}
            </StatusBanner>
          )}
        </FieldGroup>
      </div>
      {mutation.error && (
        <StatusBanner
          variant="error"
          actions={
            <Button variant="ghost" size="sm" onClick={onReload}>
              {t("applicationDevelopment.reloadCapabilities")}
            </Button>
          }
        >
          {mutation.error instanceof ApiError && mutation.error.errorCode === "APPLICATION_DEVELOPMENT_SOURCE_CHANGED"
            ? t("applicationDevelopment.capabilitiesChanged")
            : getErrorMessage(mutation.error, t)}
        </StatusBanner>
      )}
      <DialogFooter>
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
        <Button
          disabled={mutation.isPending || !input.success || unavailable}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && <Spinner data-icon="inline-start" />}
          {t("common.save")}
        </Button>
      </DialogFooter>
    </>
  )
}
