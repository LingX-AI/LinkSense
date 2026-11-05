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
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("publicKnowledge.edit")}</DialogTitle>
          <DialogDescription>
            {t("publicKnowledge.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-1">
          {settings.isPending ? (
            <LoadingState />
          ) : settings.error || !settings.data ? (
            <ErrorState
              message={getErrorMessage(settings.error, t)}
              onRetry={() => void settings.refetch()}
            />
          ) : (
            <PublicKnowledgeSettingsForm
              initial={settings.data.settings}
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
