import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  applicationSchema,
  interactiveDependencyStateSchema,
  interactiveDependencySelectionSchema,
  type InteractiveDependencyBinding,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { LoadingState } from "@/components/feedback/page-state"
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
import { InteractiveDependencyFields } from "./interactive-dependency-fields"

export function InteractiveDependenciesDialog({
  applicationId,
  onClose,
}: {
  applicationId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [bindings, setBindings] = useState<InteractiveDependencyBinding[]>([])
  const query = useQuery({
    queryKey: ["applications", applicationId, "dependencies"],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}/interactive-dependencies`, {
        schema: interactiveDependencyStateSchema,
        signal,
      }),
  })
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(`/applications/${applicationId}/interactive-dependencies`, {
        method: "PATCH",
        body: interactiveDependencySelectionSchema.parse({ bindings }),
        schema: applicationSchema,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["applications"] })
      onClose()
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("applications.dependencies.title")}</DialogTitle>
          <DialogDescription>
            {t("applications.dependencies.savedDraft")}
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyStyles()}>
          {query.isLoading && <LoadingState />}
          {query.data && (
            <InteractiveDependencyFields
              state={query.data}
              disabled={mutation.isPending}
              onChange={(binding) =>
                setBindings((current) => [
                  ...current.filter(
                    (item) =>
                      item.type !== binding.type || item.id !== binding.id
                  ),
                  binding,
                ])
              }
            />
          )}
        </div>
        {(query.error || mutation.error) && (
          <StatusBanner variant="error">
            {getErrorMessage(query.error ?? mutation.error, t)}
          </StatusBanner>
        )}
        {query.data?.items.length !== 0 && (
          <DialogFooter>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!query.data || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
