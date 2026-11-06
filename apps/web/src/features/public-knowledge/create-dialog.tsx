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
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="shrink-0 border-b border-divider px-6 py-5 pr-16">
          <DialogTitle>{t("publicKnowledge.create")}</DialogTitle>
          <DialogDescription>
            {t("publicKnowledge.description")}
          </DialogDescription>
        </DialogHeader>
        <PublicKnowledgeSettingsForm
          onCancel={onClose}
          onSaved={async (result) => {
            await onCreated()
            onClose()
            navigate(
              `/capabilities/applications/${result.application_id}/public-knowledge`
            )
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
