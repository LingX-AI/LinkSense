import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  applicationPublicationSchema,
  type Application,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function ApplicationUsageGuideDialog({
  application,
  onClose,
}: {
  application: Application
  onClose: () => void
}) {
  const { t } = useTranslation()
  const guide = useQuery({
    queryKey: ["applications", application.id, "publication"],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${application.id}/publication`, {
        schema: applicationPublicationSchema,
        signal,
      }),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("applications.distribution.guide")}</DialogTitle>
          <DialogDescription>{application.name}</DialogDescription>
        </DialogHeader>
        {guide.isPending && <LoadingState />}
        {guide.error && (
          <ErrorState
            message={getErrorMessage(guide.error, t)}
            onRetry={() => void guide.refetch()}
          />
        )}
        {guide.data && (
          <>
            {guide.data.version_number && (
              <p>
                {t("applications.distribution.version", {
                  version: guide.data.version_number,
                })}
              </p>
            )}
            <section
              aria-label={t("applications.distribution.guide")}
              className="text-sm break-words whitespace-pre-wrap"
            >
              {guide.data.usage_instructions ||
                t("applications.publication.noGuide")}
            </section>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
