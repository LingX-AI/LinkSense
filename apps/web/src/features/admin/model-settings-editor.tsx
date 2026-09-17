import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function ModelSettingsEditor({
  title,
  description,
  saveLabel,
  dirty,
  pending,
  valid,
  error,
  children,
  onClose,
  onSave,
}: {
  title: string
  description: string
  saveLabel: string
  dirty: boolean
  pending: boolean
  valid: boolean
  error: string | null
  children: ReactNode
  onClose: () => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  function close(): void {
    if (pending) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          showCloseButton={!pending}
          className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl"
        >
          <form
            className="flex min-h-0 flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault()
              if (valid && !pending) onSave()
            }}
          >
            <DialogHeader className="shrink-0 pr-8">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className={dialogBodyStyles()}>
              {error && <StatusBanner variant="error">{error}</StatusBanner>}
              <fieldset
                disabled={pending}
                className="flex min-w-0 flex-col gap-6"
                aria-label={title}
              >
                {children}
              </fieldset>
            </div>
            <DialogFooter className="shrink-0">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={close}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!valid || pending}
                aria-label={saveLabel}
                aria-busy={pending || undefined}
              >
                {pending && <Spinner data-icon="inline-start" />}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("admin.modelProvider.discardTitle")}
        description={t("admin.modelProvider.discardDescription")}
        confirmLabel={t("admin.modelProvider.discardAction")}
        onConfirm={onClose}
      />
    </>
  )
}
