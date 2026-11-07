import { useTranslation } from "react-i18next"
import type { Application } from "@linksense/shared"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { ApplicationSharingPanel } from "./application-sharing-panel"
import { ApplicationCenterSubmissionPanel } from "./application-center-submission-panel"

export function ApplicationDistributionDialog({
  application,
  mode,
  onClose,
}: (
  | { application: Application; mode: "direct" | "center" }
  | {
      application: Pick<Application, "id" | "name" | "kind">
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
        variant="workspace"
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          mode === "direct" && "sm:max-w-200"
        )}
        closeLabel={t("common.close")}
      >
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>
            {t(
              mode === "direct"
                ? "applications.distribution.direct"
                : "applications.distribution.applyListing"
            )}
          </DialogTitle>
          <DialogDescription className="break-words">
            {application.name}
          </DialogDescription>
        </DialogHeader>
        {mode === "direct" ? (
          <ApplicationSharingPanel
            application={application}
            onSaved={onClose}
          />
        ) : (
          <ApplicationCenterSubmissionPanel
            serviceOnly={application.kind === "interactive"}
            applicationId={application.id}
            onSubmitted={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
