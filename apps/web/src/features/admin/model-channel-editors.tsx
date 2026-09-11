import { ModelServiceProviderLogo } from "./model-service-provider-logo"
import type { ModelSettingsDraft } from "./model-settings-draft"
import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RefreshCwIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  modelCatalogDiscoveryProviderValues,
  modelServiceProviderValues,
  modelProviderProtocolModeValues,
  type DiscoveredModel,
  type ManagedPricedModel,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import {
  discoveredModelCatalogSchema,
  type ModelProviderSettings,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ModelSettingsEditor } from "./model-settings-editor"
import {
  ModelSettingsFields,
  ModelSettingsSelect,
} from "./model-settings-fields"
import {
  changeModelKind,
  isSettingsDraftValid,
  newModel,
  parseContextWindow,
  replaceChannel,
  replaceModel,
  toSettingsProviderUpdate,
  type ModelChannel,
  type ModelChannelUpdate,
} from "./model-settings-draft"

type EditorActions = {
  settings: ModelProviderSettings
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (draft: ModelSettingsDraft) => void
}

export function ModelEditor({
  channel,
  initialModel,
  ...actions
}: EditorActions & {
  channel: ModelChannel
  initialModel: ManagedPricedModel | null
}) {
  const { t } = useTranslation()
  const [initial] = useState(() => initialModel ?? newModel())
  const [model, setModel] = useState(initial)
  const [contextInput, setContextInput] = useState(
    initial.kind === "chat" && initial.context_window !== null
      ? String(initial.context_window)
      : ""
  )
  const discoverySupported = modelCatalogDiscoveryProviderValues.some(
    (provider) => provider === channel.provider
  )
  const catalog = useQuery({
    queryKey: [
      "admin",
      "model-provider-settings",
      "providers",
      channel.id,
      "discoverable-models",
      actions.settings.revision,
    ],
    queryFn: ({ signal }) =>
      apiRequest(
        `/admin/model-provider-settings/providers/${encodeURIComponent(channel.id)}/discoverable-models`,
        { schema: discoveredModelCatalogSchema, signal }
      ),
    enabled:
      initialModel === null && discoverySupported && channel.api_key_configured,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  })
  const context = parseContextWindow(contextInput)
  const value =
    model.kind === "chat" ? { ...model, context_window: context.value } : model
  const draft = replaceModel(
    actions.settings,
    channel,
    value,
    initialModel?.id ?? null
  )
  const dirty =
    JSON.stringify(value) !== JSON.stringify(initial) || !context.valid
  return (
    <ModelSettingsEditor
      title={
        initialModel
          ? t("admin.modelProvider.editModel", {
              name: initialModel.display_name,
            })
          : t("admin.modelProvider.addModel")
      }
      description={t("admin.modelProvider.modelEditorDescription", {
        name:
          channel.name ??
          t("admin.modelProvider.providerTitle", {
            index:
              actions.settings.providers.findIndex(
                (provider) => provider.id === channel.id
              ) + 1,
          }),
      })}
      saveLabel={t("admin.modelProvider.saveModel", {
        name: model.display_name,
      })}
      dirty={dirty}
      valid={context.valid && isSettingsDraftValid(draft, actions.settings)}
      {...actions}
      onSave={() => actions.onSave(draft)}
    >
      {!initialModel && (
        <RemoteModelCatalog
          channel={channel}
          settings={actions.settings}
          models={catalog.data?.models ?? []}
          loading={catalog.isFetching}
          error={catalog.error}
          discoverySupported={discoverySupported}
          onRefresh={() => void catalog.refetch()}
          onSelect={(discovered) => {
            const next = applyDiscoveredModel(model, discovered)
            setModel(next)
            setContextInput(
              next.kind === "chat" && next.context_window !== null
                ? String(next.context_window)
                : ""
            )
          }}
        />
      )}
      <ModelSettingsFields
        model={model}
        onChange={setModel}
        contextInput={contextInput}
        onContextChange={setContextInput}
      />
    </ModelSettingsEditor>
  )
}

function RemoteModelCatalog({
  channel,
  settings,
  models,
  loading,
  error,
  discoverySupported,
  onRefresh,
  onSelect,
}: {
  channel: ModelChannel
  settings: ModelProviderSettings
  models: readonly DiscoveredModel[]
  loading: boolean
  error: unknown
  discoverySupported: boolean
  onRefresh: () => void
  onSelect: (model: DiscoveredModel) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [selectedCatalogModel, setSelectedCatalogModel] =
    useState<DiscoveredModel | null>(null)
  const configuredIds = new Set(
    settings.providers.flatMap((provider) =>
      provider.models.map((model) => model.id)
    )
  )
  const canDiscover = discoverySupported && channel.api_key_configured
  return (
    <FieldSet className="gap-3">
      <FieldLegend className="text-sm font-medium">
        {t("admin.modelProvider.remoteCatalog")}
      </FieldLegend>
      <p className="text-xs text-muted-foreground">
        {t("admin.modelProvider.remoteCatalogDescription")}
      </p>
      {canDiscover ? (
        <FieldShell id={id} label={t("admin.modelProvider.remoteCatalogLabel")}>
          <div className="flex items-center gap-2">
            <Combobox
              items={[...models]}
              value={selectedCatalogModel}
              itemToStringLabel={(model) => model.display_name}
              itemToStringValue={(model) => model.id}
              isItemEqualToValue={(model, value) => model.id === value.id}
              onValueChange={(model) => {
                setSelectedCatalogModel(model)
                if (model && !configuredIds.has(model.id)) onSelect(model)
              }}
            >
              <ComboboxInput
                id={id}
                className="min-w-0 flex-1"
                disabled={loading && models.length === 0}
                placeholder={
                  loading
                    ? t("common.loading")
                    : t("admin.modelProvider.remoteCatalogPlaceholder")
                }
              />
              <ComboboxContent>
                <ComboboxEmpty>
                  {loading
                    ? t("common.loading")
                    : t("admin.modelProvider.remoteCatalogEmpty")}
                </ComboboxEmpty>
                <ComboboxList>
                  {(model: DiscoveredModel) => {
                    const configured = configuredIds.has(model.id)
                    return (
                      <ComboboxItem
                        key={model.id}
                        value={model}
                        disabled={configured}
                      >
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {model.display_name}
                            </span>
                            <span className="block truncate text-muted-foreground">
                              {model.id}
                            </span>
                          </span>
                          {configured && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {t(
                                "admin.modelProvider.remoteCatalogAlreadyAdded"
                              )}
                            </span>
                          )}
                        </span>
                      </ComboboxItem>
                    )
                  }}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              disabled={loading}
              aria-label={t("admin.modelProvider.refreshRemoteCatalog")}
              onClick={onRefresh}
            >
              {loading ? <Spinner /> : <RefreshCwIcon aria-hidden="true" />}
            </Button>
          </div>
        </FieldShell>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t(
            discoverySupported
              ? "admin.modelProvider.remoteCatalogCredentialRequired"
              : "admin.modelProvider.remoteCatalogNotSupported"
          )}
        </p>
      )}
      {error ? (
        <StatusBanner variant="error">{getErrorMessage(error, t)}</StatusBanner>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t("admin.modelProvider.remoteCatalogManualHint")}
      </p>
    </FieldSet>
  )
}

function applyDiscoveredModel(
  current: ManagedPricedModel,
  discovered: DiscoveredModel
): ManagedPricedModel {
  const selectedKind = discovered.kind ?? current.kind
  const selected = changeModelKind(current, selectedKind)
  const identity = {
    id: discovered.id,
    display_name: discovered.display_name,
  }
  if (selected.kind !== "chat") return { ...selected, ...identity }
  return {
    ...selected,
    ...identity,
    context_window: discovered.context_window,
    supports_image_input:
      discovered.supports_image_input ?? selected.supports_image_input,
    ...(discovered.supported_reasoning_efforts &&
    discovered.default_reasoning_effort
      ? {
          supported_reasoning_efforts: discovered.supported_reasoning_efforts,
          default_reasoning_effort: discovered.default_reasoning_effort,
        }
      : {}),
  }
}

export function ChannelEditor({
  channel,
  ...actions
}: EditorActions & { channel: ModelChannel | null }) {
  const { t } = useTranslation()
  const id = useId()
  const [initial] = useState<ModelChannelUpdate>(() =>
    channel
      ? {
          ...toSettingsProviderUpdate(channel),
          name:
            channel.name ??
            t("admin.modelProvider.providerTitle", {
              index:
                actions.settings.providers.findIndex(
                  (provider) => provider.id === channel.id
                ) + 1,
            }),
        }
      : {
          id: `provider-${crypto.randomUUID()}`,
          name: "",
          provider: "openai_compatible",
          provider_project: null,
          provider_location: null,
          base_url: "",
          protocol_mode: "native_responses",
          models: [],
        }
  )
  const [value, setValue] = useState(initial)
  const [apiKey, setApiKey] = useState("")
  const draft = replaceChannel(actions.settings, {
    ...value,
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
  })
  const dirty =
    JSON.stringify(initial) !== JSON.stringify(value) || apiKey !== ""
  const keyRequired =
    !channel ||
    (!channel.api_key_configured &&
      value.models.some(
        (model) =>
          (model.kind === "chat" && model.enabled) ||
          model.id === actions.settings.title_model
      ))
  return (
    <ModelSettingsEditor
      title={
        channel
          ? t("admin.modelProvider.editChannel")
          : t("admin.modelProvider.addProvider")
      }
      description={t("admin.modelProvider.connectionDescription")}
      saveLabel={t("admin.modelProvider.saveProvider", { name: value.name })}
      dirty={dirty}
      valid={
        (!keyRequired || Boolean(apiKey.trim())) &&
        isSettingsDraftValid(draft, actions.settings)
      }
      {...actions}
      onSave={() => actions.onSave(draft)}
    >
      <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldShell
          id={`${id}-name`}
          label={t("admin.modelProvider.providerName")}
        >
          <Input
            id={`${id}-name`}
            name={`${id}-name`}
            value={value.name ?? ""}
            maxLength={120}
            required
            onChange={(event) =>
              setValue({ ...value, name: event.target.value })
            }
          />
        </FieldShell>
        <ModelSettingsSelect
          label={t("admin.modelProvider.serviceProvider")}
          value={value.provider}
          options={modelServiceProviderValues.map((provider) => ({
            value: provider,
            label: t(`admin.imageUnderstanding.providers.${provider}`),
            icon: <ModelServiceProviderLogo provider={provider} />,
          }))}
          onChange={(provider) =>
            setValue({
              ...value,
              provider,
              provider_project:
                provider === "google_vertex" ? value.provider_project : null,
              provider_location:
                provider === "google_vertex" ? value.provider_location : null,
            })
          }
        />
        <FieldShell id={`${id}-url`} label={t("admin.modelProvider.baseUrl")}>
          <Input
            id={`${id}-url`}
            name={`${id}-url`}
            value={value.base_url}
            type="url"
            maxLength={2048}
            required
            onChange={(event) =>
              setValue({ ...value, base_url: event.target.value })
            }
          />
        </FieldShell>
        <FieldShell
          id={`${id}-key`}
          label={t("admin.modelProvider.apiKey")}
          hint={t(
            channel?.api_key_configured
              ? "admin.modelProvider.apiKeyConfiguredHint"
              : keyRequired
                ? "admin.modelProvider.apiKeyRequiredHint"
                : "admin.modelProvider.apiKeyOptionalHint"
          )}
        >
          <Input
            id={`${id}-key`}
            name={`${id}-key`}
            type="password"
            required={keyRequired}
            autoComplete="new-password"
            value={apiKey}
            maxLength={16384}
            placeholder={
              channel?.api_key_configured ? "••••••••••••" : undefined
            }
            onChange={(event) => setApiKey(event.target.value)}
          />
        </FieldShell>
        <ModelSettingsSelect
          label={t("admin.modelProvider.protocolMode")}
          value={value.protocol_mode ?? "native_responses"}
          options={modelProviderProtocolModeValues.map((mode) => ({
            value: mode,
            label: t(`admin.modelProvider.protocolModes.${mode}`),
          }))}
          onChange={(protocol_mode) => setValue({ ...value, protocol_mode })}
        />
        {value.provider === "google_vertex" && (
          <>
            <FieldShell
              id={`${id}-project`}
              label={t("admin.imageUnderstanding.project")}
            >
              <Input
                id={`${id}-project`}
                name={`${id}-project`}
                required
                value={value.provider_project ?? ""}
                onChange={(event) =>
                  setValue({ ...value, provider_project: event.target.value })
                }
              />
            </FieldShell>
            <FieldShell
              id={`${id}-location`}
              label={t("admin.imageUnderstanding.location")}
            >
              <Input
                id={`${id}-location`}
                name={`${id}-location`}
                required
                value={value.provider_location ?? ""}
                onChange={(event) =>
                  setValue({ ...value, provider_location: event.target.value })
                }
              />
            </FieldShell>
          </>
        )}
      </FieldGroup>
      <p className="text-xs text-muted-foreground">
        {t(
          `admin.modelProvider.protocolModeHints.${value.protocol_mode ?? "native_responses"}`
        )}
      </p>
    </ModelSettingsEditor>
  )
}
