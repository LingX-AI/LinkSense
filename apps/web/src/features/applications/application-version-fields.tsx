import { useId } from "react"
import { useTranslation } from "react-i18next"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@/components/ui/field"
import { ApplicationVersionNumberInput } from "./application-version-number-input"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { getErrorMessage } from "@/api/error-message"
import { RequiredIndicator } from "@/components/forms/required-indicator"
import type { ApplicationVersionForm } from "./use-application-version-form"

export function ApplicationVersionFields({
  form,
  disabled,
}: {
  form: ApplicationVersionForm
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const invalid =
    form.status === "lower" ||
    form.status === "invalid" ||
    (!form.readOnly && !form.allowSameVersion && form.status === "same")
  if (form.settings.isPending) return <LoadingState />
  if (form.settings.error)
    return (
      <ErrorState
        message={getErrorMessage(form.settings.error, t)}
        onRetry={() => void form.settings.refetch()}
      />
    )
  if (form.readOnly && form.highest === null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("applications.distribution.publishFirst")}
      </p>
    )
  return (
    <FieldGroup>
      <Field data-invalid={invalid}>
        <FieldLabel htmlFor={`${id}-version`}>
          {t("applications.distribution.versionNumber")}
          <RequiredIndicator />
        </FieldLabel>
        <ApplicationVersionNumberInput
          id={`${id}-version`}
          value={form.version}
          maxLength={80}
          required
          readOnly={form.readOnly}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
          placeholder="1.0.0"
          onValueChange={form.setVersion}
        />
        {invalid ? (
          <FieldError
            id={`${id}-hint`}
            className="text-[length:var(--app-font-13)] leading-5"
          >
            {t(
              form.status === "lower" || form.status === "same"
                ? form.allowSameVersion
                  ? "applications.distribution.editVersionLower"
                  : "applications.distribution.versionLower"
                : "applications.distribution.versionInvalid",
              { version: form.highest }
            )}
          </FieldError>
        ) : (
          <FieldDescription
            id={`${id}-hint`}
            size="caption"
            role={form.status === "same" ? "status" : undefined}
          >
            {t(
              form.readOnly
                ? "applications.distribution.publishedVersionHint"
                : form.allowSameVersion
                  ? "applications.distribution.editVersionHint"
                  : "applications.distribution.versionHint",
              { version: form.highest }
            )}
          </FieldDescription>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-guide`}>
          {t("applications.distribution.guide")}
        </FieldLabel>
        <Textarea
          id={`${id}-guide`}
          value={form.guide}
          readOnly={form.readOnly}
          maxLength={20000}
          disabled={disabled}
          onChange={(event) => form.setGuide(event.target.value)}
        />
      </Field>
    </FieldGroup>
  )
}
