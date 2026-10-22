import { useId } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  modelPreferenceSchema,
  reasoningEffortSchema,
  type ApplicationInstallationSetup,
  type ApplicationSetupModelInput,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const DEFAULT_MODEL = "__personal_model_preference__"

export function ApplicationSetupModelField({
  guide,
  disabled,
  onChange,
}: {
  guide: ApplicationInstallationSetup
  disabled: boolean
  onChange: (input: ApplicationSetupModelInput) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const query = useQuery({
    queryKey: ["me", "model-preference", "application-setup"],
    queryFn: ({ signal }) =>
      apiRequest("/me/model-preference", {
        schema: modelPreferenceSchema,
        signal,
      }),
    staleTime: 0,
    refetchOnWindowFocus: "always",
  })
  const models = query.data?.models.filter((model) => model.enabled) ?? []
  const selected = models.find((model) => model.id === guide.model)
  const options = [
    { value: DEFAULT_MODEL, label: t("applicationSetup.modelDefault") },
    ...models.map((model) => ({ value: model.id, label: model.display_name })),
    ...(guide.model && !selected
      ? [{ value: guide.model, label: guide.model }]
      : []),
  ]
  const effortOptions = (selected?.supported_reasoning_efforts ?? []).map(
    (value) => ({ value, label: t(`reasoningEffort.${value}`) })
  )
  const save = (
    model: string | null,
    reasoningEffort: ApplicationSetupModelInput["reasoning_effort"]
  ) =>
    onChange({
      installed_version_id: guide.installed_version_id,
      updated_at: guide.updated_at,
      model,
      reasoning_effort: reasoningEffort,
    })
  return (
    <FieldGroup>
      {query.isPending && <LoadingState />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      )}
      <Field data-disabled={disabled || !query.data?.configured}>
        <FieldLabel htmlFor={`${id}-model`}>
          {t("applications.model")}
        </FieldLabel>
        <Select
          items={options}
          value={guide.model ?? DEFAULT_MODEL}
          disabled={disabled || !query.data?.configured || query.isFetching}
          onValueChange={(value) => {
            if (value === DEFAULT_MODEL) save(null, null)
            else {
              const model = models.find((candidate) => candidate.id === value)
              if (model) save(model.id, model.default_reasoning_effort)
            }
          }}
        >
          <SelectTrigger
            id={`${id}-model`}
            aria-label={t("applications.model")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          {t("applications.modelOptionalDescription")}
        </FieldDescription>
      </Field>
      {guide.model && (
        <Field data-disabled={disabled || !selected}>
          <FieldLabel htmlFor={`${id}-effort`}>
            {t("applications.reasoningEffort")}
          </FieldLabel>
          <Select
            items={effortOptions}
            value={guide.reasoning_effort ?? undefined}
            disabled={disabled || !selected || query.isFetching}
            onValueChange={(value) => {
              if (value && guide.model)
                save(guide.model, reasoningEffortSchema.parse(value))
            }}
          >
            <SelectTrigger
              id={`${id}-effort`}
              aria-label={t("applications.reasoningEffort")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {effortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}
    </FieldGroup>
  )
}
