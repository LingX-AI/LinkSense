import { useId, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { FieldShell } from "@/components/forms/form-field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"

type ConversationRenameDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onValueChange: (value: string) => void
  pending?: boolean
  error?: string
  onSubmit: (title: string) => void
}

export function ConversationRenameDialog({
  open,
  onOpenChange,
  value,
  onValueChange,
  pending,
  error,
  onSubmit,
}: ConversationRenameDialogProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const normalizedValue = value.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("conversation.rename")}</DialogTitle>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (normalizedValue) onSubmit(normalizedValue)
          }}
        >
          {error && (
            <p
              role="alert"
              className="text-[length:var(--app-font-11)] leading-4 text-[var(--destructive)]"
            >
              {error}
            </p>
          )}
          <FieldShell id={inputId} label={t("conversation.title")} required>
            <Input
              id={inputId}
              aria-required="true"
              name="conversation-title"
              className="h-9 font-medium"
              value={value}
              maxLength={240}
              onChange={(event) => onValueChange(event.target.value)}
              autoFocus={shouldAutoFocusOnDesktop()}
            />
          </FieldShell>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="submit"
              disabled={!normalizedValue || pending}
              aria-busy={pending || undefined}
            >
              {pending && <Spinner data-icon="inline-start" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
