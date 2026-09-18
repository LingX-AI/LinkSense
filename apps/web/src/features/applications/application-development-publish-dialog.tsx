import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import type { ApplicationVersionInput } from "@linksense/shared"
import { useApplicationVersionForm } from "./use-application-version-form"
import { ApplicationVersionFields } from "./application-version-fields"
import { useApplicationPublicationReadiness } from "./use-application-publication-readiness"

export function ApplicationDevelopmentPublishSuccessDialog({
  name,
  version,
  onClose,
}: {
  name: string
  version: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>
            {t("applicationDevelopment.publish.successTitle")}
          </DialogTitle>
          <DialogDescription className="wrap-anywhere">
            {t("applicationDevelopment.publish.successDescription", {
              name,
              version,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button />}>{t("common.gotIt")}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ApplicationDevelopmentPublishDialog({
  name,
  applicationId,
  updating,
  pending,
  changed,
  error,
  onClose,
  onConfirm,
}: {
  name: string
  applicationId: string
  updating: boolean
  pending: boolean
  changed: boolean
  error: unknown
  onClose: () => void
  onConfirm: (input: ApplicationVersionInput) => void
}) {
  const { t } = useTranslation()
  const form = useApplicationVersionForm(applicationId, "publish")
  const readiness = useApplicationPublicationReadiness(applicationId)
  const canPublish =
    readiness.isFetchedAfterMount &&
    readiness.isSuccess &&
    readiness.data.has_active_tasks === false
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        closeLabel={t("common.close")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("applicationDevelopment.publish.title")}</DialogTitle>
          <DialogDescription className="leading-relaxed wrap-anywhere whitespace-pre-line">
            {t(
              updating
                ? "applicationDevelopment.publish.updateDescription"
                : "applicationDevelopment.publish.description",
              { name }
            )}
          </DialogDescription>
        </DialogHeader>
        <ApplicationVersionFields form={form} disabled={pending} />
        {readiness.isError ? (
          <StatusBanner variant="error">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{t("applicationDevelopment.publish.checkFailed")}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={readiness.isFetching}
                onClick={() => void readiness.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          </StatusBanner>
        ) : !readiness.isFetchedAfterMount ? (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Spinner aria-hidden="true" />
            {t("applicationDevelopment.publish.checking")}
          </p>
        ) : readiness.data?.has_active_tasks ? (
          <StatusBanner variant="warning">
            {t("applicationDevelopment.publish.activeTasks")}
          </StatusBanner>
        ) : null}
        {changed && (
          <StatusBanner variant="warning">
            {t("applicationDevelopment.publish.changed")}
          </StatusBanner>
        )}
        {error != null && (
          <StatusBanner variant="error">
            {getErrorMessage(error, t)}
          </StatusBanner>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={pending || changed || !form.valid || !canPublish}
            aria-busy={pending || undefined}
            onClick={() => onConfirm(form.input)}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {t(
              pending
                ? "applicationDevelopment.publish.pending"
                : "applicationDevelopment.publish.confirm"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
