import { useId } from "react"
import { useTranslation } from "react-i18next"
import type { ApplicationUsageMode } from "@linksense/shared"
import { RequiredIndicator } from "@/components/forms/required-indicator"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"

export function ApplicationUsageModes({
  value,
  onChange,
  disabled = false,
}: {
  value: ApplicationUsageMode[]
  onChange: (value: ApplicationUsageMode[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <FieldSet className="min-w-0" aria-describedby={`${id}-hint`}>
      <FieldLegend variant="label" className="flex items-center gap-2">
        {t("applications.distribution.usageModes")}
        <RequiredIndicator />
      </FieldLegend>
      <FieldDescription id={`${id}-hint`} size="caption">
        {t("applications.distribution.usageModesHint")}
      </FieldDescription>
      <FieldGroup className="grid grid-cols-2 gap-3">
        {(["install", "service"] as const).map((mode) => (
          <FieldLabel
            key={mode}
            htmlFor={`${id}-${mode}`}
            className="h-full min-w-0 border-divider"
          >
            <Field className="h-full min-w-0" data-disabled={disabled}>
              <div className="flex items-start gap-2">
                <Checkbox
                  id={`${id}-${mode}`}
                  aria-labelledby={`${id}-${mode}-title`}
                  aria-describedby={`${id}-${mode}-description`}
                  checked={value.includes(mode)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...value.filter((item) => item !== mode), mode]
                        : value.filter((item) => item !== mode)
                    )
                  }
                />
                <FieldTitle
                  id={`${id}-${mode}-title`}
                  className="min-w-0 break-words"
                >
                  {t(`applications.distribution.modes.${mode}`)}
                </FieldTitle>
              </div>
              <FieldDescription
                id={`${id}-${mode}-description`}
                size="caption"
                className="break-words"
              >
                {t(`applications.distribution.modeDescriptions.${mode}`)}
              </FieldDescription>
            </Field>
          </FieldLabel>
        ))}
      </FieldGroup>
    </FieldSet>
  )
}

export function ApplicationUsageModeBadges({
  modes,
}: {
  modes: ApplicationUsageMode[]
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-2">
      {modes.map((mode) => (
        <Badge key={mode} variant="secondary">
          {t(`applications.distribution.modes.${mode}`)}
        </Badge>
      ))}
    </div>
  )
}
