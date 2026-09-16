import { useTranslation } from "react-i18next"
import type { Application } from "@linksense/shared"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { ApplicationSharingPanel } from "./application-sharing-panel"
import { ApplicationCenterSubmissionPanel } from "./application-center-submission-panel"

export function ApplicationDistributionDialog({
  application,
  mode,
  onClose,
}: (
  | { application: Application; mode: "direct" | "center" }
  | {
      application: Pick<Application, "id" | "name">
      mode: "center"
    }
) & { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="shrink-0 px-6 py-5 pr-14">
          <DialogTitle>
            {t(
              mode === "direct"
                ? "applications.distribution.direct"
                : "applications.distribution.applyListing"
            )}
          </DialogTitle>
          <DialogDescription className="text-[length:var(--app-font-13)] leading-5 break-words">
            {application.name}
          </DialogDescription>
        </DialogHeader>
        <Separator />
        {mode === "direct" ? (
          <ApplicationSharingPanel
            application={application}
            onSaved={onClose}
          />
        ) : (
          <ApplicationCenterSubmissionPanel
            applicationId={application.id}
            onSubmitted={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
