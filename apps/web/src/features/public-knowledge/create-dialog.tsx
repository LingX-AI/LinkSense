import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PublicKnowledgeSettingsForm } from "./settings-form"

export function PublicKnowledgeCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { t } = useTranslation(),
    navigate = useNavigate()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("publicKnowledge.create")}</DialogTitle>
          <DialogDescription>
            {t("publicKnowledge.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-1">
          <PublicKnowledgeSettingsForm
            onSaved={async (result) => {
              await onCreated()
              onClose()
              navigate(
                `/capabilities/applications/${result.application_id}/public-knowledge`
              )
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
