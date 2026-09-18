import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  applicationInstallInputSchema,
  applicationSchema,
  type Application,
  type ApplicationDistributionChannel,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  applicationDistributionKeys,
  useApplicationInstallationUpdate,
} from "./application-distribution-queries"

export type ApplicationInstallTarget = {
  id: string
  name: string
  versionId: string
  channel: ApplicationDistributionChannel
  mode?: "install" | "service"
  versionNumber?: string | null
  installedVersionNumber?: string | null
}

export function ApplicationInstallationDialog({
  target,
  onClose,
  onInstalled,
}: {
  target: ApplicationInstallTarget
  onClose: () => void
  onInstalled: (application: Application) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [name, setName] = useState(target.name)
  const input = applicationInstallInputSchema.safeParse({
    name,
    channel: target.channel,
    version_id: target.versionId,
  })
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(
        `/applications/${target.id}/${target.mode === "service" ? "service-installation" : "install"}`,
        {
          method: "POST",
          schema: applicationSchema,
          body:
            target.mode === "service"
              ? { channel: target.channel, version_id: target.versionId }
              : applicationInstallInputSchema.parse({
                  name,
                  channel: target.channel,
                  version_id: target.versionId,
                }),
        }
      ),
    onSuccess: async (application) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["applications"] }),
        client.invalidateQueries({ queryKey: ["capabilities"] }),
      ])
      onInstalled(application)
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("applications.distribution.install")}</DialogTitle>
          <DialogDescription>
            {t(
              target.mode === "service"
                ? "applications.distribution.serviceInstallationHint"
                : "applications.distribution.installationHint"
            )}
          </DialogDescription>
        </DialogHeader>
        {target.versionNumber && (
          <p>
            {t("applications.distribution.availableVersion", {
              version: target.versionNumber,
            })}
          </p>
        )}
        {target.installedVersionNumber && (
          <p>
            {t("applications.distribution.installedVersion", {
              version: target.installedVersionNumber,
            })}
          </p>
        )}
        {target.mode !== "service" && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="application-install-name">
                {t("applications.distribution.installationName")}
              </FieldLabel>
              <Input
                id="application-install-name"
                value={name}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                disabled={mutation.isPending}
              />
            </Field>
          </FieldGroup>
        )}
        {mutation.error && (
          <StatusBanner variant="error">
            {getErrorMessage(mutation.error, t)}
          </StatusBanner>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!input.success || mutation.isPending}
          >
            {t("applications.distribution.install")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ApplicationInstallationUpdateDialog({
  applicationId,
  onClose,
  onUpdated,
}: {
  applicationId: string
  onClose: () => void
  onUpdated: (application: Application) => void
}) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const query = useApplicationInstallationUpdate(applicationId)
  const mutation = useMutation({
    mutationFn: (versionId: string) =>
      apiRequest(`/applications/${applicationId}/installation/update`, {
        method: "POST",
        body: { version_id: versionId },
        schema: applicationSchema,
      }),
    onSuccess: async (application) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["applications"] }),
        client.invalidateQueries({ queryKey: ["capabilities"] }),
        client.invalidateQueries({
          queryKey: applicationDistributionKeys.update(applicationId),
        }),
      ])
      onUpdated(application)
    },
  })
  const preview = query.data
  const error = query.error ?? mutation.error
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("applications.distribution.updateTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("applications.distribution.updateHint")}
          </DialogDescription>
        </DialogHeader>
        {query.isPending && <p role="status">{t("common.loading")}</p>}
        {error && (
          <StatusBanner variant="error">
            {getErrorMessage(error, t)}
          </StatusBanner>
        )}
        {preview && (
          <div className="flex flex-col gap-3">
            <p>
              {t(
                preview.update_available
                  ? "applications.distribution.version"
                  : preview.latest_version_id
                    ? "applications.distribution.upToDate"
                    : "applications.distribution.updateUnavailable",
                { version: preview.latest_version_number }
              )}
            </p>
            {preview.release_notes && (
              <p className="whitespace-pre-wrap">{preview.release_notes}</p>
            )}
            {preview.preserved_fields.length > 0 && (
              <p>
                {t("applications.distribution.preserved", {
                  fields: new Intl.ListFormat(i18n.language).format(
                    preview.preserved_fields.map((field) =>
                      t(`applications.distribution.fields.${field}`)
                    )
                  ),
                })}
              </p>
            )}
            {preview.setup_required && (
              <StatusBanner variant="warning">
                {t("applications.distribution.setupRequired")}
              </StatusBanner>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            {t("common.close")}
          </Button>
          <Button
            disabled={
              !preview?.update_available ||
              !preview.latest_version_id ||
              mutation.isPending
            }
            onClick={() => {
              if (preview?.latest_version_id)
                mutation.mutate(preview.latest_version_id)
            }}
          >
            {t("applications.distribution.update")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
