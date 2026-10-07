import { ModelServiceProviderLogo } from "./model-service-provider-logo"
import type { ModelSettingsDraft } from "./model-settings-draft"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  modelServiceProviderValues,
  modelProviderProtocolModeValues,
  modelProviderPresets,
  type DiscoveredProviderModel,
  type ModelProviderProbeInput,
  type ManagedPricedModel,
} from "@linksense/shared"
import type { ModelProviderSettings } from "@/api/contracts"
import { FieldShell } from "@/components/forms/form-field"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ModelAdvancedSettings } from "./model-advanced-settings"
import { ModelConnectionTest, ModelDiscovery } from "./model-provider-probe"
import { ModelSettingsEditor } from "./model-settings-editor"
import {
  ModelSettingsFields,
  ModelSettingsSelect,
} from "./model-settings-fields"
import {
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
  const [manual, setManual] = useState(initialModel !== null)
  const [discovered, setDiscovered] = useState<DiscoveredProviderModel | null>(
    null
  )
  const [contextInput, setContextInput] = useState(
    initial.kind === "chat" && initial.context_window !== null
      ? String(initial.context_window)
      : ""
  )
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
  const otherModels = actions.settings.providers.flatMap((provider) =>
    provider.models.filter(
      (saved) => !(provider.id === channel.id && saved.id === initialModel?.id)
    )
  )
  const modelIdConflict = otherModels.some(
    (saved) => saved.id === model.id.trim()
  )
  const modelNameConflict =
    Boolean(model.display_name.trim()) &&
    otherModels.some(
      (saved) => saved.display_name.trim() === model.display_name.trim()
    )
  const probe: ModelProviderProbeInput = {
    channel_id: channel.id,
    provider: channel.provider,
    provider_project: channel.provider_project,
    provider_location: channel.provider_location,
    base_url: channel.base_url,
    protocol_mode: channel.protocol_mode,
  }
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
      valid={
        !modelIdConflict &&
        context.valid &&
        isSettingsDraftValid(draft, actions.settings)
      }
      {...actions}
      onSave={() => actions.onSave(draft)}
    >
      {!initialModel && (
        <>
          <ModelDiscovery
            key={JSON.stringify(probe)}
            input={probe}
            credentialsReady={channel.api_key_configured}
            disabled={actions.pending}
            selectedId={model.id}
            onSelect={(selected) => {
              setManual(true)
              setDiscovered(selected)
              setModel({
                ...newModel(),
                id: selected.id,
                display_name: selected.display_name,
                context_window: selected.context_window,
                supports_image_input: selected.supports_image_input ?? false,
              })
              setContextInput(
                selected.context_window === null
                  ? ""
                  : String(selected.context_window)
              )
            }}
          />
          {!manual && !model.id && (
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() => setManual(true)}
            >
              {t("modelSetup.manual")}
            </Button>
          )}
          {discovered && discovered.id === model.id && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <p>
                {discovered.context_window === null
                  ? t("modelSetup.contextUnknown")
                  : t("modelSetup.contextKnown", {
                      count: discovered.context_window,
                    })}
              </p>
              <p>
                {discovered.supports_image_input === null
                  ? t("modelSetup.imagesUnknown")
                  : t("modelSetup.imagesKnown", {
                      value: t(
                        discovered.supports_image_input
                          ? "modelSetup.yes"
                          : "modelSetup.no"
                      ),
                    })}
              </p>
            </div>
          )}
        </>
      )}
      <ModelSettingsFields
        model={model}
        modelIdError={
          modelIdConflict ? t("admin.modelProvider.modelIdConflict") : undefined
        }
        modelNameHint={
          modelNameConflict
            ? t("admin.modelProvider.modelNameConflict")
            : undefined
        }
        onChange={setModel}
        contextInput={contextInput}
        onContextChange={setContextInput}
        showIdentity={manual || Boolean(model.id)}
      />
      <ModelConnectionTest
        key={JSON.stringify({ probe, value })}
        input={{ ...probe, model_id: model.id, kind: model.kind }}
        credentialsReady={channel.api_key_configured}
        disabled={actions.pending}
      />
    </ModelSettingsEditor>
  )
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
          protocol_mode: modelProviderPresets.openai_compatible.protocol_mode,
          models: [],
        }
  )
  const [value, setValue] = useState(initial)
  const [apiKey, setApiKey] = useState("")
  const [testModelId, setTestModelId] = useState(
    channel?.models.find((model) => model.kind === "chat")?.id ?? ""
  )
  const draft = replaceChannel(actions.settings, {
    ...value,
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
  })
  const dirty =
    JSON.stringify(initial) !== JSON.stringify(value) || apiKey !== ""
  const nameConflict =
    Boolean(value.name?.trim()) &&
    actions.settings.providers.some(
      (saved) =>
        saved.id !== channel?.id && saved.name?.trim() === value.name?.trim()
    )
  const savedTargetMatches =
    channel !== null &&
    channel.provider === value.provider &&
    channel.base_url === value.base_url &&
    channel.provider_project === value.provider_project &&
    channel.provider_location === value.provider_location
  const keyRequired =
    !channel ||
    (channel.api_key_configured && !savedTargetMatches) ||
    (!channel.api_key_configured &&
      value.models.some(
        (model) =>
          (model.kind === "chat" && model.enabled) ||
          model.id === actions.settings.title_model
      ))
  const credentialsReady =
    Boolean(apiKey.trim()) ||
    Boolean(channel?.api_key_configured && savedTargetMatches)
  const probe: ModelProviderProbeInput = {
    ...(channel ? { channel_id: channel.id } : {}),
    provider: value.provider,
    base_url: value.base_url,
    protocol_mode: value.protocol_mode ?? "native_responses",
    provider_project: value.provider_project,
    provider_location: value.provider_location,
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
  }
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
        <ModelSettingsSelect
          label={t("admin.modelProvider.serviceProvider")}
          value={value.provider}
          options={modelServiceProviderValues.map((provider) => ({
            value: provider,
            label: t(`admin.imageUnderstanding.providers.${provider}`),
            icon: <ModelServiceProviderLogo provider={provider} />,
          }))}
          onChange={(provider) => {
            const preset = modelProviderPresets[provider]
            setValue({
              ...value,
              provider,
              base_url: preset.base_url ?? "",
              protocol_mode: preset.protocol_mode,
              provider_project:
                provider === "google_vertex" ? value.provider_project : null,
              provider_location:
                provider === "google_vertex" ? value.provider_location : null,
            })
          }}
        />
        <FieldShell
          id={`${id}-name`}
          label={t("admin.modelProvider.providerName")}
          required
          hint={
            nameConflict ? (
              <span id={`${id}-name-hint`} className="text-destructive">
                {t("admin.modelProvider.channelNameConflict")}
              </span>
            ) : undefined
          }
        >
          <Input
            id={`${id}-name`}
            name={`${id}-name`}
            value={value.name ?? ""}
            className={
              nameConflict
                ? "border-destructive dark:border-destructive/50"
                : undefined
            }
            aria-describedby={nameConflict ? `${id}-name-hint` : undefined}
            maxLength={120}
            required
            onChange={(event) =>
              setValue({ ...value, name: event.target.value })
            }
          />
        </FieldShell>
        <FieldShell
          id={`${id}-url`}
          label={t("admin.modelProvider.baseUrl")}
          required
          hint={
            modelProviderPresets[value.provider].requires_compatible_endpoint
              ? t("modelSetup.compatibleEndpoint")
              : undefined
          }
        >
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
          required={keyRequired}
          hint={t(
            channel?.api_key_configured && savedTargetMatches
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
        {value.provider === "google_vertex" && (
          <>
            <FieldShell
              id={`${id}-project`}
              label={t("admin.imageUnderstanding.project")}
              required
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
              required
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
      <ModelAdvancedSettings>
        <ModelSettingsSelect
          label={t("admin.modelProvider.protocolMode")}
          value={value.protocol_mode ?? "native_responses"}
          options={modelProviderProtocolModeValues.map((mode) => ({
            value: mode,
            label: t(`admin.modelProvider.protocolModes.${mode}`),
          }))}
          onChange={(protocol_mode) => setValue({ ...value, protocol_mode })}
        />
        <p className="text-xs text-muted-foreground">
          {t(
            `admin.modelProvider.protocolModeHints.${value.protocol_mode ?? "native_responses"}`
          )}
        </p>
      </ModelAdvancedSettings>
      <ModelDiscovery
        key={JSON.stringify(probe)}
        input={probe}
        credentialsReady={credentialsReady}
        disabled={actions.pending}
        selectedId={testModelId}
        onSelect={(model) => setTestModelId(model.id)}
        manualEntry={{
          label: t("modelSetup.testModel"),
          onChange: setTestModelId,
        }}
      />
      <ModelConnectionTest
        key={JSON.stringify({ probe, value, testModelId })}
        input={{ ...probe, model_id: testModelId }}
        credentialsReady={credentialsReady}
        credentialsChanged={Boolean(
          channel?.api_key_configured && !savedTargetMatches && !apiKey.trim()
        )}
        disabled={actions.pending}
      />
    </ModelSettingsEditor>
  )
}
