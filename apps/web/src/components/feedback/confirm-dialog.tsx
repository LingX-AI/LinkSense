import { useTranslation } from "react-i18next"

import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  pendingLabel?: string
  destructive?: boolean
  destructiveNotice?: string
  pending?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive,
  destructiveNotice,
  pending,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <DialogContent closeLabel={t("common.close")} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {destructive && destructiveNotice ? (
          <StatusBanner variant="error">{destructiveNotice}</StatusBanner>
        ) : null}
        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" disabled={pending} />}
          >
            {t("common.cancel")}
          </DialogClose>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={onConfirm}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {pending
              ? (pendingLabel ?? confirmLabel ?? t("common.confirm"))
              : (confirmLabel ?? t("common.confirm"))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
