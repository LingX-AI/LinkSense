import {
  applicationIconInputFor,
  type ApplicationIconFormState,
} from "./application-icon-form"
import { useId, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  applicationDevelopmentMetadataSchema,
  type ApplicationDevelopmentMetadata,
  type ApplicationIcon,
  type ApplicationVersionInput,
} from "@linksense/shared"
import { getErrorMessage } from "@/api/error-message"
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
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ApplicationIconField } from "./application-icon-field"

import { ApplicationVersionFields } from "./application-version-fields"
import {
  useApplicationVersionForm,
  type ApplicationVersionForm,
} from "./use-application-version-form"

export function ApplicationMetadataPublishDialog({
  application,
  onSave,
  onClose,
}: {
  application: {
    id: string
    name: string
    description: string | null
    icon: ApplicationIcon
  }
  onSave: (
    input: ApplicationDevelopmentMetadata,
    release: ApplicationVersionInput
  ) => Promise<void>
  onClose: () => void
}) {
  const versionForm = useApplicationVersionForm(application.id, "publish", true)
  return (
    <ApplicationMetadataDialog
      initial={application}
      versionForm={versionForm}
      onSave={(input) => onSave(input, versionForm.input)}
      onClose={onClose}
    />
  )
}

export function ApplicationMetadataDialog({
  initial,
  draft = false,
  versionForm,
  onSave,
  onClose,
}: {
  initial: { name: string; description: string | null; icon: ApplicationIcon }
  draft?: boolean
  versionForm?: ApplicationVersionForm
  onSave: (input: ApplicationDevelopmentMetadata) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description ?? "")
  const [icon, setIcon] = useState<ApplicationIconFormState>(
    initial.icon.type === "custom"
      ? { mode: "existing-custom", icon: initial.icon }
      : { mode: "preset", preset: initial.icon.preset }
  )
  const [reading, setReading] = useState(false)
  const [iconChanged, setIconChanged] = useState(false)
  const save = useMutation({
    mutationFn: () => {
      const changedIcon = iconChanged
        ? applicationIconInputFor(icon)
        : undefined
      return onSave(
        applicationDevelopmentMetadataSchema.parse({
          name,
          description: description.trim() || null,
          ...(changedIcon ? { icon: changedIcon } : {}),
        })
      )
    },
    onSuccess: onClose,
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("applications.editMetadata")}</DialogTitle>
          <DialogDescription>
            {t(
              versionForm
                ? "applications.editMetadataPublishDescription"
                : draft
                  ? "applications.editDraftMetadataDescription"
                  : "applications.editMetadataDescription"
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          id={id}
          className={dialogBodyStyles()}
          onSubmit={(event) => {
            event.preventDefault()
            if (
              !reading &&
              !save.isPending &&
              name.trim() &&
              (!versionForm || versionForm.valid)
            )
              save.mutate()
          }}
        >
          <FieldGroup>
            <ApplicationIconField
              value={icon}
              onChange={(next) => {
                setIcon(next)
                setIconChanged(true)
              }}
              onReadingChange={setReading}
              disabled={save.isPending}
            />
            <Field>
              <FieldLabel htmlFor={`${id}-name`} required>
                {t("common.name")}
              </FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                required
                maxLength={160}
                disabled={save.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-description`}>
                {t("common.description")}
              </FieldLabel>
              <Textarea
                id={`${id}-description`}
                value={description}
                maxLength={4000}
                disabled={save.isPending}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            {versionForm && (
              <ApplicationVersionFields
                form={versionForm}
                disabled={save.isPending}
              />
            )}
            {save.error && (
              <StatusBanner variant="error">
                {getErrorMessage(save.error, t)}
              </StatusBanner>
            )}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form={id}
            aria-busy={save.isPending}
            disabled={
              save.isPending ||
              reading ||
              !name.trim() ||
              (versionForm && !versionForm.valid)
            }
          >
            {save.isPending && <Spinner data-icon="inline-start" />}
            {t(
              save.isPending
                ? "common.saving"
                : versionForm
                  ? "applications.editAndPublish"
                  : "common.save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
