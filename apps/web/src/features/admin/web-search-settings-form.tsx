import {
  updateWebSearchSettingsSchema,
  webSearchProviderDefinitions,
  webSearchProviderSchema,
  webSearchRequestSchema,
  type WebSearchSettings,
} from "@linksense/shared"
import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { NotificationToast } from "@/components/feedback/notification-toast"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell, SettingsFieldGroup } from "@/components/forms/form-field"
import { SettingsCard } from "@/components/settings/settings-card"
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
import { useWebSearchSettings } from "./use-web-search-settings"
import { WebSearchProviderLogo } from "./web-search-provider-logo"

const MASKED_API_KEY = "••••••••••••"

const providerNames = {
  deepseek: "DeepSeek",
  tavily: "Tavily",
  brave: "Brave Search",
  exa: "Exa",
  google: "Google Custom Search",
  serpapi: "SerpAPI",
  searxng: "SearXNG",
}

export function WebSearchSettingsForm() {
  const state = useWebSearchSettings()
  const { t } = useTranslation()
  if (state.query.isLoading) return <LoadingState />
  if (!state.query.data)
    return (
      <ErrorState
        message={getErrorMessage(state.query.error, t)}
        onRetry={() => void state.query.refetch()}
      />
    )
  return (
    <>
      <NotificationToast
        id="web-search-saved"
        message={state.save.isSuccess ? t("webSearch.saved") : null}
      />
      <WebSearchSettingsEditor
        key={state.query.data.revision}
        settings={state.query.data}
        state={state}
      />
    </>
  )
}

function WebSearchSettingsEditor({
  settings,
  state,
}: {
  settings: WebSearchSettings
  state: ReturnType<typeof useWebSearchSettings>
}) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(settings.enabled)
  const [provider, setProvider] = useState(settings.provider ?? "deepseek")
  const [endpoint, setEndpoint] = useState(
    settings.base_url ?? webSearchProviderDefinitions[0].endpoint
  )
  const [key, setKey] = useState("")
  const [engineId, setEngineId] = useState(settings.search_engine_id ?? "")
  const [maxResults, setMaxResults] = useState(
    String(settings.default_max_results)
  )
  const [timeout, setTimeout] = useState(String(settings.timeout_ms / 1_000))
  const [query, setQuery] = useState("LinkSense")
  const definition = webSearchProviderDefinitions.find(
    (value) => value.key === provider
  )
  const effectiveEndpoint = endpoint.trim() || definition?.endpoint || null
  const savedKey =
    settings.api_key_configured &&
    settings.provider === provider &&
    settings.base_url === effectiveEndpoint
  const payload = updateWebSearchSettingsSchema.safeParse({
    expected_revision: settings.revision,
    enabled,
    provider,
    base_url: effectiveEndpoint,
    search_engine_id: engineId.trim() || null,
    default_max_results: Number(maxResults),
    timeout_ms: Number(timeout) * 1_000,
    ...(key.trim() ? { api_key: key.trim() } : {}),
  })
  const ready = Boolean(
    definition &&
    effectiveEndpoint &&
    (!definition.requires_api_key || key.trim() || savedKey) &&
    (provider !== "google" || engineId.trim())
  )
  const busy = state.save.isPending || state.probe.isPending
  const error = state.save.error ?? state.probe.error
  const changed = () => {
    state.probe.reset()
    state.save.reset()
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (payload.success && (!enabled || ready)) state.save.mutate(payload.data)
  }

  return (
    <SettingsCard
      aria-labelledby="web-search-title"
      header={
        <SettingsSectionHeader
          id="web-search-title"
          title={t("webSearch.title")}
          description={t("webSearch.description")}
        />
      }
    >
      <form
        onSubmit={submit}
        onChange={changed}
        className="flex min-w-0 flex-col gap-6"
      >
        {error && (
          <StatusBanner variant="error">
            {getErrorMessage(error, t)}
          </StatusBanner>
        )}
        {state.probe.data && (
          <StatusBanner variant="success">
            {t("webSearch.testSuccess", {
              count: state.probe.data.results.length,
            })}
          </StatusBanner>
        )}
        <SettingsFieldGroup>
          <FieldShell
            id="web-search-enabled"
            label={t("webSearch.enabled")}
            hint={t("webSearch.enabledHint")}
            layout="settings"
          >
            <Switch
              id="web-search-enabled"
              checked={enabled}
              onCheckedChange={(value) => {
                changed()
                setEnabled(value)
              }}
              disabled={busy}
            />
          </FieldShell>
          <FieldShell
            id="web-search-provider"
            label={t("webSearch.provider")}
            required
            layout="settings"
          >
            <Select
              value={provider}
              disabled={busy}
              items={providerNames}
              onValueChange={(value) => {
                const parsed = webSearchProviderSchema.safeParse(value)
                if (!parsed.success) return
                changed()
                setProvider(parsed.data)
                setKey("")
                setEndpoint(
                  webSearchProviderDefinitions.find(
                    (item) => item.key === parsed.data
                  )?.endpoint ?? ""
                )
              }}
            >
              <SelectTrigger id="web-search-provider" className="w-full">
                <SelectValue>
                  <WebSearchProviderLogo provider={provider} />
                  {providerNames[provider]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {webSearchProviderDefinitions.map((value) => (
                    <SelectItem key={value.key} value={value.key}>
                      <WebSearchProviderLogo provider={value.key} />
                      {providerNames[value.key]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell
            id="web-search-endpoint"
            label={t("webSearch.endpoint")}
            hint={t("webSearch.endpointHint")}
            layout="settings"
            required
          >
            <Input
              id="web-search-endpoint"
              type="url"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </FieldShell>
          {definition?.requires_api_key && (
            <FieldShell
              id="web-search-key"
              label={t("webSearch.apiKey")}
              hint={t("webSearch.apiKeyHint")}
              required={enabled && !savedKey}
              layout="settings"
            >
              <Input
                id="web-search-key"
                className="placeholder:text-foreground placeholder:opacity-100"
                type="password"
                value={key}
                placeholder={savedKey ? MASKED_API_KEY : ""}
                onChange={(event) => setKey(event.target.value)}
                disabled={busy}
                autoComplete="new-password"
              />
            </FieldShell>
          )}
          {provider === "google" && (
            <FieldShell
              id="web-search-engine"
              label={t("webSearch.engineId")}
              required
              layout="settings"
            >
              <Input
                id="web-search-engine"
                value={engineId}
                onChange={(event) => setEngineId(event.target.value)}
                disabled={busy}
              />
            </FieldShell>
          )}
          <FieldShell
            id="web-search-max-results"
            label={t("webSearch.maxResults")}
            layout="settings"
          >
            <Input
              id="web-search-max-results"
              type="number"
              min={1}
              max={20}
              step={1}
              value={maxResults}
              onChange={(event) => setMaxResults(event.target.value)}
              disabled={busy}
            />
          </FieldShell>
          <FieldShell
            id="web-search-timeout"
            label={t("webSearch.timeoutSeconds")}
            layout="settings"
          >
            <Input
              id="web-search-timeout"
              type="number"
              min={1}
              max={60}
              step={1}
              value={timeout}
              onChange={(event) => setTimeout(event.target.value)}
              disabled={busy}
            />
          </FieldShell>
          <FieldShell
            id="web-search-test-query"
            label={t("webSearch.testQuery")}
            hint={t("webSearch.testHint")}
            layout="settings"
          >
            <Input
              id="web-search-test-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={128}
              disabled={busy}
            />
          </FieldShell>
        </SettingsFieldGroup>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={
              busy ||
              !payload.success ||
              !ready ||
              !webSearchRequestSchema.safeParse({ query }).success
            }
            onClick={() => {
              if (payload.success)
                state.probe.mutate({
                  settings: payload.data,
                  request: { query },
                })
            }}
          >
            {state.probe.isPending && <Spinner data-icon="inline-start" />}
            {t("webSearch.test")}
          </Button>
          <Button
            type="submit"
            disabled={busy || !payload.success || (enabled && !ready)}
          >
            {state.save.isPending && <Spinner data-icon="inline-start" />}
            {t("common.save")}
          </Button>
        </div>
      </form>
    </SettingsCard>
  )
}
