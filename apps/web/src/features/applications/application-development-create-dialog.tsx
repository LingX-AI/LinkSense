import { useState } from "react"
import { useTranslation } from "react-i18next"
import { applicationDevelopmentOpenSchema } from "@linksense/shared"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { StatusBanner } from "@/components/feedback/status-banner"
import { getErrorMessage } from "@/api/error-message"
import { useOpenApplicationDevelopment } from "./application-opening"

export function ApplicationDevelopmentCreateDialog({
  onClose,
}: {
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const mutation = useOpenApplicationDevelopment()
  const parsed = applicationDevelopmentOpenSchema.safeParse({ name })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("applicationDevelopment.create")}</DialogTitle>
          <DialogDescription>
            {t("applicationDevelopment.createHint")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (parsed.success && !mutation.isPending)
              mutation.mutate(parsed.data)
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="development-name" required>
                {t("applicationDevelopment.name")}
              </FieldLabel>
              <Input
                id="development-name"
                aria-required="true"
                value={name}
                maxLength={160}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </FieldGroup>
          {mutation.error && (
            <StatusBanner variant="error">
              {getErrorMessage(mutation.error, t)}
            </StatusBanner>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!parsed.success || mutation.isPending}
            >
              {t(
                mutation.isPending
                  ? "applicationDevelopment.creating"
                  : "applicationDevelopment.start"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
