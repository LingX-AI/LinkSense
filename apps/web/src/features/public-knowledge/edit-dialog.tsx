import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { getErrorMessage } from "@/api/error-message"
import { getPublicKnowledgeManagement, publicKnowledgeKeys } from "./api"
import { PublicKnowledgeSettingsForm } from "./settings-form"

export function PublicKnowledgeEditDialog({
  applicationId,
  onClose,
  onSaved,
}: {
  applicationId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation(),
    queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: publicKnowledgeKeys.management(applicationId),
    queryFn: ({ signal }) =>
      getPublicKnowledgeManagement(applicationId, signal),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="shrink-0 border-b border-divider px-6 py-5 pr-16">
          <DialogTitle>{t("publicKnowledge.edit")}</DialogTitle>
          <DialogDescription>
            {t("publicKnowledge.description")}
          </DialogDescription>
        </DialogHeader>
        {settings.isPending || settings.error || !settings.data ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            {settings.isPending ? (
              <LoadingState />
            ) : (
              <ErrorState
                message={getErrorMessage(settings.error, t)}
                onRetry={() => void settings.refetch()}
              />
            )}
          </div>
        ) : (
          <PublicKnowledgeSettingsForm
            onCancel={onClose}
            initial={settings.data.settings}
            initialIcon={settings.data.icon}
            applicationId={applicationId}
            onSaved={async (result) => {
              queryClient.setQueryData(
                publicKnowledgeKeys.management(applicationId),
                result
              )
              await queryClient.invalidateQueries({
                queryKey: ["applications"],
              })
              onSaved()
              onClose()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
