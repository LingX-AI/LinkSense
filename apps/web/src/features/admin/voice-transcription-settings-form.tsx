import { useId, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  modelProviderBaseUrlSchema,
  type VoiceTranscriptionProvider,
} from "@linksense/shared"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import {
  voiceTranscriptionSettingsUpdateResultSchema,
  type ModelProviderSettings,
  type VoiceTranscriptionSettings,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  FieldShell,
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { VoiceTranscriptionProviderLogo } from "./voice-transcription-provider-logo"

const MASKED_API_KEY = "••••••••••••"
type ProviderOptionKey = VoiceTranscriptionProvider | ""

export function VoiceTranscriptionSettingsForm({
  settings,
  modelSettings,
}: {
  settings: VoiceTranscriptionSettings
  modelSettings: ModelProviderSettings
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const idPrefix = useId()
  const readOnly = modelSettings.management_enabled === false
  const [revision, setRevision] = useState(settings.revision)
  const [enabled, setEnabled] = useState(settings.enabled)
  const [provider, setProvider] = useState<ProviderOptionKey>(
    settings.provider ?? ""
  )
  const [baseUrl, setBaseUrl] = useState(settings.base_url ?? "")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState(settings.model ?? "")
  const [apiVersion, setApiVersion] = useState(
    settings.provider_options.api_version ?? ""
  )
  const [error, setError] = useState<string | null>(null)

  const providerDefinition = useMemo(
    () =>
      provider
        ? (settings.providers.find((candidate) => candidate.key === provider) ??
          null)
        : null,
    [provider, settings.providers]
  )
  const providerChanged = provider !== (settings.provider ?? "")
  const apiKeyConfiguredForProvider =
    settings.api_key_configured && !providerChanged
  const formValid =
    !enabled ||
    (provider !== "" &&
      modelProviderBaseUrlSchema.safeParse(baseUrl).success &&
      Boolean(model.trim()) &&
      (!providerDefinition?.requires_api_version ||
        Boolean(apiVersion.trim())) &&
      (apiKeyConfiguredForProvider || Boolean(apiKey.trim())))

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/admin/voice-transcription-settings", {
        method: "PUT",
        body: {
          expected_revision: revision,
          enabled,
          provider: provider || null,
          provider_options: { api_version: apiVersion.trim() || null },
          base_url: baseUrl.trim() || null,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          model: model.trim() || null,
        },
        schema: voiceTranscriptionSettingsUpdateResultSchema,
      }),
    onSuccess: async (result) => {
      setError(null)
      setRevision(result.settings.revision)
      setEnabled(result.settings.enabled)
      setProvider(result.settings.provider ?? "")
      setBaseUrl(result.settings.base_url ?? "")
      setApiKey("")
      setModel(result.settings.model ?? "")
      setApiVersion(result.settings.provider_options.api_version ?? "")
      queryClient.setQueryData(
        ["admin", "voice-transcription-settings"],
        result.settings
      )
      notify.success(t("admin.voiceTranscription.saved"), {
        id: "voice-transcription-settings-saved",
      })
      await queryClient.invalidateQueries({
        queryKey: ["admin", "voice-transcription-settings"],
      })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const providerItems = settings.providers.map((candidate) => ({
    value: candidate.key,
    label: t(`admin.voiceTranscription.providers.${candidate.key}`),
  }))
  const selectedProviderItem = providerItems.find(
    (item) => item.value === provider
  )

  return (
    <section
      className="grid min-w-0 gap-3"
      aria-labelledby={`${idPrefix}-title`}
    >
      <SettingsSectionHeader
        id={`${idPrefix}-title`}
        title={t("admin.voiceTranscription.title")}
        description={t("admin.voiceTranscription.description")}
      />
      <form
        className="grid w-full gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (readOnly || !formValid) return
          setError(null)
          mutation.mutate()
        }}
      >
        <div
          data-slot="model-settings-card"
          className="grid min-w-0 gap-4 rounded-card border border-[color:var(--app-border)] bg-card p-4 sm:p-5"
        >
          {error && <StatusBanner variant="error">{error}</StatusBanner>}

          <SettingsFieldGroup>
            <FieldShell
              layout="settings"
              id={`${idPrefix}-provider`}
              controlWidth="medium"
              label={t("admin.voiceTranscription.provider")}
              hint={t("admin.voiceTranscription.providerHint")}
            >
              <Select
                name="voice-transcription-provider"
                items={providerItems}
                value={provider}
                disabled={readOnly}
                onValueChange={(value) => {
                  const nextProvider = (value ?? "") as ProviderOptionKey
                  const definition = settings.providers.find(
                    (candidate) => candidate.key === nextProvider
                  )
                  setProvider(nextProvider)
                  setBaseUrl(definition?.default_base_url ?? "")
                  setModel(definition?.default_model ?? "")
                  setApiVersion(
                    definition?.requires_api_version ? "preview" : ""
                  )
                  setApiKey("")
                }}
              >
                <SelectTrigger id={`${idPrefix}-provider`} className="w-full">
                  {provider && selectedProviderItem ? (
                    <SelectValue>
                      <VoiceTranscriptionProviderLogo provider={provider} />
                      {selectedProviderItem.label}
                    </SelectValue>
                  ) : (
                    <SelectValue
                      placeholder={t(
                        "admin.voiceTranscription.providerPlaceholder"
                      )}
                    />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {providerItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        <VoiceTranscriptionProviderLogo provider={item.value} />
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldShell>

            <FieldShell
              layout="settings"
              id={`${idPrefix}-base-url`}
              controlWidth="wide"
              label={t("admin.voiceTranscription.baseUrl")}
              hint={t("admin.voiceTranscription.baseUrlHint")}
            >
              <Input
                id={`${idPrefix}-base-url`}
                name="voice-transcription-base-url"
                value={baseUrl}
                disabled={readOnly}
                onChange={(event) => setBaseUrl(event.target.value)}
                required={enabled}
              />
            </FieldShell>
            {providerDefinition?.requires_api_version && (
              <FieldShell
                layout="settings"
                id={`${idPrefix}-api-version`}
                controlWidth="medium"
                label={t("admin.voiceTranscription.apiVersion")}
                hint={t("admin.voiceTranscription.apiVersionHint")}
              >
                <Input
                  id={`${idPrefix}-api-version`}
                  name="voice-transcription-api-version"
                  value={apiVersion}
                  disabled={readOnly}
                  onChange={(event) => setApiVersion(event.target.value)}
                  required={enabled}
                />
              </FieldShell>
            )}

            <FieldShell
              layout="settings"
              id={`${idPrefix}-api-key`}
              controlWidth="wide"
              label={t("admin.voiceTranscription.apiKey")}
              hint={
                apiKeyConfiguredForProvider
                  ? t("admin.voiceTranscription.apiKeyConfiguredHint")
                  : t("admin.voiceTranscription.apiKeyRequiredHint")
              }
            >
              <Input
                id={`${idPrefix}-api-key`}
                name="voice-transcription-api-key"
                className="placeholder:text-foreground placeholder:opacity-100"
                type="password"
                value={apiKey}
                disabled={readOnly}
                placeholder={apiKeyConfiguredForProvider ? MASKED_API_KEY : ""}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="new-password"
                required={enabled && !apiKeyConfiguredForProvider}
              />
            </FieldShell>
            <FieldShell
              layout="settings"
              id={`${idPrefix}-model`}
              controlWidth="medium"
              label={t("admin.voiceTranscription.model")}
              hint={t("admin.voiceTranscription.modelHint")}
            >
              <Input
                id={`${idPrefix}-model`}
                name="voice-transcription-model"
                value={model}
                disabled={
                  readOnly || providerDefinition?.model_editable === false
                }
                onChange={(event) => setModel(event.target.value)}
                required={enabled}
              />
            </FieldShell>
            <SettingsFieldRow
              id={`${idPrefix}-enabled`}
              label={t("admin.voiceTranscription.enabled")}
              controlWidth="compact"
            >
              <Switch
                id={`${idPrefix}-enabled`}
                name="voice-transcription-enabled"
                checked={enabled}
                disabled={readOnly}
                onCheckedChange={setEnabled}
              />
            </SettingsFieldRow>
          </SettingsFieldGroup>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="submit"
              disabled={readOnly || !formValid || mutation.isPending}
              aria-busy={mutation.isPending || undefined}
            >
              {mutation.isPending && <Spinner data-icon="inline-start" />}
              {mutation.isPending
                ? t("admin.voiceTranscription.saving")
                : t("admin.voiceTranscription.save")}
            </Button>
          </div>
        </div>
      </form>
    </section>
  )
}
