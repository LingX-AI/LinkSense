import { useId, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  MAX_SENSITIVE_DATA_DETECTION_PROMPT_LENGTH,
  modelProviderSettingsSchema,
  sensitiveDataPreferenceSchema,
  sensitiveDataSettingsSchema,
  sensitiveDataUserSettingsSchema,
  updateSensitiveDataSettingsSchema,
  type SensitiveDataPreference,
  type SensitiveDataSettings,
  type SensitiveDataUserSettings,
  type UpdateSensitiveDataSettings,
} from "@linksense/shared"

import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { notify } from "@/components/feedback/notification"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { PasswordInput } from "@/components/forms/password-input"
import { PageLayout } from "@/components/shell/page-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupOption,
} from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { personalizationQueryKey } from "@/features/personalization/use-personalization"
import {
  sensitiveDataUserQueries,
  sensitiveDataUserQueryKey,
} from "./query-keys"

const adminPath = "/system/sensitive-data-settings"
const userPath = "/me/sensitive-data"
const adminQueryKey = ["sensitive-data", "admin"] as const

type ModelOption = { id: string; name: string }

export function AdminSensitiveDataPage() {
  const { t } = useTranslation()
  const settings = useQuery({
    queryKey: adminQueryKey,
    queryFn: ({ signal }) =>
      apiRequest(adminPath, { schema: sensitiveDataSettingsSchema, signal }),
  })
  const models = useQuery({
    queryKey: ["admin", "model-provider-settings"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/model-provider-settings", {
        schema: modelProviderSettingsSchema,
        signal,
      }),
  })
  const error = settings.error ?? models.error
  return (
    <PageLayout
      title={t("sensitiveData.title")}
      description={t("sensitiveData.adminDescription")}
    >
      {error ? (
        <ErrorState
          message={getErrorMessage(error, t)}
          onRetry={() => {
            void settings.refetch()
            void models.refetch()
          }}
        />
      ) : settings.data && models.data ? (
        <AdminSensitiveDataForm
          key={settings.data.revision}
          settings={settings.data}
          models={models.data.providers.flatMap((provider) =>
            provider.api_key_configured
              ? provider.models.flatMap((model) =>
                  model.kind === "chat"
                    ? [{ id: model.id, name: model.display_name }]
                    : []
                )
              : []
          )}
        />
      ) : (
        <LoadingState />
      )}
    </PageLayout>
  )
}

function AdminSensitiveDataForm({
  settings,
  models,
}: {
  settings: SensitiveDataSettings
  models: ModelOption[]
}) {
  const { t } = useTranslation()
  const cache = useQueryClient()
  const id = useId()
  const [draft, setDraft] = useState(() => adminDraft(settings, models))
  const [invalid, setInvalid] = useState(false)
  const mutation = useMutation({
    mutationFn: (body: UpdateSensitiveDataSettings) =>
      apiRequest(adminPath, {
        method: "PUT",
        body,
        schema: sensitiveDataSettingsSchema,
      }),
    onSuccess: async (saved) => {
      cache.setQueryData(adminQueryKey, saved)
      notify.success(t("sensitiveData.saved"))
      await cache.invalidateQueries({ queryKey: sensitiveDataUserQueries })
    },
  })
  const localModels = models.filter(({ id }) =>
    draft.local_model_ids.includes(id)
  )

  function toggleEnabled(enabled: boolean) {
    if (mutation.isPending) return
    setInvalid(false)
    setDraft((current) => ({ ...current, enabled }))
    if (enabled || !settings.enabled) {
      mutation.reset()
      return
    }

    mutation.mutate(
      { ...adminDraft(settings, models), enabled: false },
      {
        onError: () =>
          setDraft((current) => ({ ...current, enabled: settings.enabled })),
      }
    )
  }

  function toggleModel(modelId: string, checked: boolean) {
    setDraft((current) => {
      const ids = checked
        ? [...current.local_model_ids, modelId]
        : current.local_model_ids.filter((id) => id !== modelId)
      return {
        ...current,
        local_model_ids: ids,
        default_model_id:
          current.default_model_id && ids.includes(current.default_model_id)
            ? current.default_model_id
            : (ids[0] ?? null),
      }
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.enabled || mutation.isPending) return
    const validated = updateSensitiveDataSettingsSchema.safeParse({
      ...draft,
      decision_endpoint: draft.decision_endpoint?.trim() || null,
      decision_model_id: draft.decision_model_id?.trim() || null,
      decision_api_key: draft.decision_api_key?.trim() || undefined,
    })
    setInvalid(!validated.success)
    if (validated.success) mutation.mutate(validated.data)
  }

  return (
    <form onSubmit={submit} className="max-w-3xl">
      <FieldGroup>
        <Field
          orientation="horizontal"
          data-disabled={mutation.isPending || undefined}
        >
          <Switch
            id={`${id}-enabled`}
            checked={draft.enabled}
            disabled={mutation.isPending}
            onCheckedChange={toggleEnabled}
            aria-describedby={`${id}-enabled-help`}
          />
          <div>
            <FieldLabel htmlFor={`${id}-enabled`}>
              {t("sensitiveData.enabled")}
            </FieldLabel>
            <FieldDescription id={`${id}-enabled-help`}>
              {t("sensitiveData.enabledHelp")}
            </FieldDescription>
          </div>
        </Field>
        {draft.enabled && (
          <>
            <FieldSet>
              <FieldLegend>{t("sensitiveData.localModels")}</FieldLegend>
              <FieldDescription>
                {t("sensitiveData.localModelsHelp")}
              </FieldDescription>
              {models.length === 0 ? (
                <FieldDescription>
                  {t("sensitiveData.noModels")}
                </FieldDescription>
              ) : (
                <FieldGroup className="max-h-64 gap-3 overflow-y-auto p-1">
                  {models.map((model) => (
                    <Field key={model.id} orientation="horizontal">
                      <Checkbox
                        id={`${id}-model-${model.id}`}
                        checked={draft.local_model_ids.includes(model.id)}
                        onCheckedChange={(checked) =>
                          toggleModel(model.id, checked === true)
                        }
                      />
                      <FieldLabel
                        className="wrap-anywhere"
                        htmlFor={`${id}-model-${model.id}`}
                      >
                        {model.name}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              )}
              <Field>
                <FieldLabel htmlFor={`${id}-default`}>
                  {t("sensitiveData.defaultModel")}
                </FieldLabel>
                <LocalModelSelect
                  id={`${id}-default`}
                  models={localModels}
                  value={draft.default_model_id}
                  onChange={(default_model_id) =>
                    setDraft((current) => ({ ...current, default_model_id }))
                  }
                />
              </Field>
            </FieldSet>
            <FieldSet>
              <FieldLegend id={`${id}-timing`}>
                {t("sensitiveData.timing")}
              </FieldLegend>
              <RadioGroup
                aria-labelledby={`${id}-timing`}
                className="flex-col"
                value={draft.inspection}
                onValueChange={(inspection) => {
                  if (
                    inspection === "turn_start" ||
                    inspection === "every_request"
                  ) {
                    setDraft((current) => ({ ...current, inspection }))
                  }
                }}
              >
                <SensitiveOption
                  value="turn_start"
                  title={t("sensitiveData.atTurnStart")}
                  help={t("sensitiveData.atTurnStartHelp")}
                />
                <SensitiveOption
                  value="every_request"
                  title={t("sensitiveData.everyRequest")}
                  help={t("sensitiveData.everyRequestHelp")}
                />
              </RadioGroup>
            </FieldSet>
            <FieldSet>
              <FieldLegend>{t("sensitiveData.decisionModel")}</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`${id}-endpoint`}>
                    {t("sensitiveData.endpoint")}
                  </FieldLabel>
                  <Input
                    id={`${id}-endpoint`}
                    type="url"
                    value={draft.decision_endpoint ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        decision_endpoint: event.target.value,
                      }))
                    }
                    autoComplete="off"
                    aria-describedby={`${id}-endpoint-help`}
                  />
                  <FieldDescription id={`${id}-endpoint-help`}>
                    {t("sensitiveData.endpointHelp")}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-model-id`}>
                    {t("sensitiveData.modelId")}
                  </FieldLabel>
                  <Input
                    id={`${id}-model-id`}
                    value={draft.decision_model_id ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        decision_model_id: event.target.value,
                      }))
                    }
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-key`}>
                    {t("sensitiveData.key")}
                  </FieldLabel>
                  <PasswordInput
                    id={`${id}-key`}
                    fieldLabel={t("sensitiveData.key")}
                    value={draft.decision_api_key ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        decision_api_key: event.target.value,
                      }))
                    }
                    autoComplete="new-password"
                    aria-describedby={`${id}-key-help`}
                  />
                  <FieldDescription id={`${id}-key-help`}>
                    {t(
                      settings.decision_key_configured
                        ? "sensitiveData.keySaved"
                        : "sensitiveData.keyOptional"
                    )}
                  </FieldDescription>
                </Field>
                <DetectionPromptField
                  value={draft.detection_prompt ?? null}
                  onChange={(detection_prompt) =>
                    setDraft((current) => ({ ...current, detection_prompt }))
                  }
                  description={t("sensitiveData.organizationPromptHelp")}
                  disabled={mutation.isPending}
                />
              </FieldGroup>
            </FieldSet>
          </>
        )}
        {(invalid || mutation.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {invalid
                ? t("sensitiveData.invalidSettings")
                : getErrorMessage(mutation.error, t)}
            </AlertDescription>
          </Alert>
        )}
        {draft.enabled && (
          <div>
            <Button type="submit" disabled={mutation.isPending}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </FieldGroup>
    </form>
  )
}

function adminDraft(
  settings: SensitiveDataSettings,
  models: ModelOption[]
): UpdateSensitiveDataSettings {
  const localIds = settings.local_model_ids.filter((id) =>
    models.some((model) => model.id === id)
  )
  return {
    expected_revision: settings.revision,
    enabled: settings.enabled,
    inspection: settings.inspection,
    local_model_ids: localIds,
    default_model_id:
      settings.default_model_id && localIds.includes(settings.default_model_id)
        ? settings.default_model_id
        : null,
    decision_endpoint: settings.decision_endpoint,
    decision_model_id: settings.decision_model_id,
    detection_prompt: settings.detection_prompt,
  }
}

export function PersonalSensitiveDataPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const settings = useQuery({
    queryKey: sensitiveDataUserQueryKey(user?.id),
    queryFn: ({ signal }) =>
      apiRequest(userPath, { schema: sensitiveDataUserSettingsSchema, signal }),
  })
  return (
    <PageLayout
      title={t("sensitiveData.title")}
      description={t("sensitiveData.userDescription")}
    >
      {settings.error ? (
        <ErrorState
          message={getErrorMessage(settings.error, t)}
          onRetry={() => {
            void settings.refetch()
          }}
        />
      ) : settings.data ? (
        <PersonalSensitiveDataForm
          settings={settings.data}
          ownerId={user?.id}
        />
      ) : (
        <LoadingState />
      )}
    </PageLayout>
  )
}

function PersonalSensitiveDataForm({
  settings,
  ownerId,
}: {
  settings: SensitiveDataUserSettings
  ownerId?: string
}) {
  const { t } = useTranslation()
  const cache = useQueryClient()
  const id = useId()
  const [draft, setDraft] = useState(settings.preference)
  const mutation = useMutation({
    mutationFn: (preference: SensitiveDataPreference) =>
      apiRequest(userPath, {
        method: "PUT",
        body: sensitiveDataPreferenceSchema.parse(preference),
        schema: sensitiveDataUserSettingsSchema,
      }),
    onSuccess: async (saved) => {
      cache.setQueryData(sensitiveDataUserQueryKey(ownerId), saved)
      setDraft(saved.preference)
      notify.success(t("sensitiveData.saved"))
      await cache.invalidateQueries({ queryKey: personalizationQueryKey })
    },
  })
  if (!settings.enabled) {
    return (
      <Alert>
        <AlertDescription>{t("sensitiveData.disabled")}</AlertDescription>
      </Alert>
    )
  }
  return (
    <form
      className="max-w-3xl"
      onSubmit={(event) => {
        event.preventDefault()
        if (!mutation.isPending) mutation.mutate(draft)
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-default`}>
            {t("sensitiveData.defaultModel")}
          </FieldLabel>
          <LocalModelSelect
            id={`${id}-default`}
            models={settings.local_models}
            value={draft.default_model_id}
            allowSystemDefault
            onChange={(default_model_id) =>
              setDraft((current) => ({ ...current, default_model_id }))
            }
          />
        </Field>
        <FieldSet>
          <FieldLegend id={`${id}-selection`}>
            {t("sensitiveData.selection")}
          </FieldLegend>
          <RadioGroup
            aria-labelledby={`${id}-selection`}
            className="flex-col"
            value={draft.selection}
            onValueChange={(selection) => {
              if (selection === "ask" || selection === "default") {
                setDraft((current) => ({ ...current, selection }))
              }
            }}
          >
            <SensitiveOption
              value="ask"
              title={t("sensitiveData.ask")}
              help={t("sensitiveData.askHelp")}
            />
            <SensitiveOption
              value="default"
              title={t("sensitiveData.useDefault")}
              help={t("sensitiveData.useDefaultHelp")}
            />
          </RadioGroup>
        </FieldSet>
        <DetectionPromptField
          value={draft.detection_prompt}
          onChange={(detection_prompt) =>
            setDraft((current) => ({ ...current, detection_prompt }))
          }
          description={t("sensitiveData.personalPromptHelp")}
          disabled={mutation.isPending}
        />
        {mutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {getErrorMessage(mutation.error, t)}
            </AlertDescription>
          </Alert>
        )}
        <div>
          <Button type="submit" disabled={mutation.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}

function DetectionPromptField({
  value,
  onChange,
  description,
  disabled,
}: {
  value: string | null
  onChange: (value: string) => void
  description: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{t("sensitiveData.detectionPrompt")}</FieldLabel>
      <Textarea
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        maxLength={MAX_SENSITIVE_DATA_DETECTION_PROMPT_LENGTH}
        disabled={disabled}
        className="field-sizing-fixed resize-y overflow-y-auto"
        aria-describedby={`${id}-help`}
      />
      <FieldDescription id={`${id}-help`}>{description}</FieldDescription>
    </Field>
  )
}

function SensitiveOption({
  value,
  title,
  help,
}: {
  value: string
  title: string
  help: string
}) {
  const descriptionId = useId()
  return (
    <RadioGroupOption className="w-full items-start">
      <RadioGroupItem value={value} aria-describedby={descriptionId} />
      <span className="flex min-w-0 flex-col gap-1">
        <span>{title}</span>
        <span
          id={descriptionId}
          className="text-sm font-normal text-muted-foreground"
        >
          {help}
        </span>
      </span>
    </RadioGroupOption>
  )
}

function LocalModelSelect({
  id,
  models,
  value,
  allowSystemDefault = false,
  onChange,
}: {
  id: string
  models: ModelOption[]
  value: string | null
  allowSystemDefault?: boolean
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslation()
  const defaultValue = ""
  const options = [
    ...(allowSystemDefault
      ? [{ value: defaultValue, label: t("sensitiveData.systemDefault") }]
      : []),
    ...models.map(({ id, name }) => ({ value: id, label: name })),
  ]
  return (
    <Select
      items={options}
      value={value ?? (allowSystemDefault ? defaultValue : null)}
      onValueChange={(next) => onChange(next || null)}
      disabled={models.length === 0}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={t("sensitiveData.chooseDefault")} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
