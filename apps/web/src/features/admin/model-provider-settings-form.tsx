import { useId, useState } from "react"
import { arrayMove } from "@dnd-kit/sortable"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ManagedPricedModel } from "@linksense/shared"
import { type ModelProviderSettings } from "@/api/contracts"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { StatusBanner } from "@/components/feedback/status-banner"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { SettingsFieldGroup } from "@/components/forms/form-field"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ModelEditor, ChannelEditor } from "./model-channel-editors"
import { ModelSettingsSelect } from "./model-settings-fields"
import { ModelSettingsTable } from "./model-settings-table"
import {
  isSettingsDraftValid,
  settingsDraft,
  type ModelChannel,
} from "./model-settings-draft"
import { useModelSettings } from "./use-model-settings"

type EditorSelection =
  | { kind: "channel"; channel: ModelChannel | null }
  | { kind: "model"; channel: ModelChannel; model: ManagedPricedModel | null }

export function ModelProviderSettingsForm({
  settings: initial,
}: {
  settings: ModelProviderSettings
}) {
  const { t } = useTranslation()
  const id = useId()
  const { settings, pending, error, execute, clearError } =
    useModelSettings(initial)
  const [selectedId, setSelectedId] = useState(initial.providers[0]?.id ?? "")
  const [editor, setEditor] = useState<EditorSelection | null>(null)
  const [deletion, setDeletion] = useState<
    | { kind: "model"; model: ManagedPricedModel }
    | { kind: "channel"; channel: ModelChannel }
    | null
  >(null)
  const channel =
    settings.providers.find((provider) => provider.id === selectedId) ??
    settings.providers[0]
  const channelIndex = settings.providers.findIndex(
    (provider) => provider.id === channel?.id
  )
  const disabled = initial.management_enabled === false || pending
  const modelCount = settings.providers.reduce(
    (count, provider) => count + provider.models.length,
    0
  )
  const providerName = (provider: ModelChannel, index: number) =>
    provider.name ??
    t("admin.modelProvider.providerTitle", { index: index + 1 })
  function openEditor(selection: EditorSelection): void {
    clearError()
    setEditor(selection)
  }
  function closeEditor(): void {
    setEditor(null)
    clearError()
  }
  function moveChannel(direction: -1 | 1): void {
    const target = channelIndex + direction
    if (
      disabled ||
      channelIndex < 0 ||
      target < 0 ||
      target >= settings.providers.length
    )
      return
    const draft = settingsDraft(settings)
    draft.providers = arrayMove(draft.providers, channelIndex, target)
    execute({ kind: "save", draft })
  }
  return (
    <section
      className="flex min-w-0 flex-col gap-8"
      aria-labelledby={`${id}-title`}
      aria-busy={pending || undefined}
    >
      {error && !editor && !deletion && (
        <StatusBanner variant="error">{error}</StatusBanner>
      )}
      <SettingsCard
        header={
          <SettingsSectionHeader
            id={`${id}-title`}
            title={t("admin.modelProvider.providers")}
            description={t("admin.modelProvider.catalogDescription")}
            action={
              <Button
                type="button"
                variant="secondary"
                size="default"
                disabled={disabled || settings.providers.length >= 20}
                onClick={() => openEditor({ kind: "channel", channel: null })}
              >
                <PlusIcon data-icon="inline-start" />
                {t("admin.modelProvider.addProvider")}
              </Button>
            }
          />
        }
      >
        {channel ? (
          <div
            className="flex min-w-0 flex-col gap-4"
            role="group"
            aria-label={providerName(channel, channelIndex)}
          >
            <SettingsFieldGroup>
              <ModelSettingsSelect
                layout="settings"
                label={t("admin.modelProvider.currentChannel")}
                value={channel.id}
                disabled={pending}
                options={settings.providers.map((provider, index) => ({
                  value: provider.id,
                  label: providerName(provider, index),
                }))}
                onChange={(value) => {
                  setSelectedId(value)
                  clearError()
                }}
                actions={
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="default"
                      disabled={disabled || modelCount >= 100}
                      onClick={() =>
                        openEditor({ kind: "model", channel, model: null })
                      }
                    >
                      <PlusIcon data-icon="inline-start" />
                      {t("admin.modelProvider.addModel")}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled}
                            aria-label={t("admin.modelProvider.channelActions")}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="whitespace-nowrap"
                            disabled={disabled}
                            onClick={() =>
                              openEditor({ kind: "channel", channel })
                            }
                          >
                            <PencilIcon className="mx-px size-3.5" />
                            {t("admin.modelProvider.editChannel")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={channelIndex === 0}
                            onClick={() => moveChannel(-1)}
                          >
                            <ArrowUpIcon />
                            {t("admin.modelProvider.moveChannelUp")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={
                              channelIndex === settings.providers.length - 1
                            }
                            onClick={() => moveChannel(1)}
                          >
                            <ArrowDownIcon />
                            {t("admin.modelProvider.moveChannelDown")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            className="whitespace-nowrap"
                            disabled={settings.providers.length === 1}
                            onClick={() =>
                              setDeletion({ kind: "channel", channel })
                            }
                          >
                            <Trash2Icon />
                            {t("admin.modelProvider.deleteProvider")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                }
              />
            </SettingsFieldGroup>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span>
                {t(
                  channel.api_key_configured
                    ? "admin.modelProvider.channelSummaryConfigured"
                    : "admin.modelProvider.channelSummaryNotConfigured",
                  {
                    provider: t(
                      `admin.imageUnderstanding.providers.${channel.provider}`
                    ),
                    count: channel.models.length,
                  }
                )}
              </span>
              {channel.models.length > 0 && (
                <span className="whitespace-nowrap">
                  {t("admin.modelProvider.priceUnitSummary", {
                    unit: t("admin.modelProvider.priceUnit"),
                  })}
                </span>
              )}
              {channel.models.length === 0 &&
                t("admin.modelProvider.channelSummaryEnd")}
            </p>
            {channel.models.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("admin.modelProvider.noModels")}</EmptyTitle>
                  <EmptyDescription>
                    {t("admin.modelProvider.noModelsDescription")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                <ModelSettingsTable
                  models={channel.models}
                  disabled={disabled}
                  onEdit={(model) =>
                    openEditor({ kind: "model", channel, model })
                  }
                  onDelete={(model) => setDeletion({ kind: "model", model })}
                  onAvailability={(model, enabled) =>
                    execute({
                      kind: "availability",
                      modelId: model.id,
                      enabled,
                    })
                  }
                  onReorder={(models) => {
                    const draft = settingsDraft(settings)
                    draft.providers = draft.providers.map((provider) =>
                      provider.id === channel.id
                        ? { ...provider, models }
                        : provider
                    )
                    execute({ kind: "save", draft })
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("admin.modelProvider.orderHint")}
                </p>
              </div>
            )}
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("admin.modelProvider.noChannels")}</EmptyTitle>
              <EmptyDescription>
                {t("admin.modelProvider.noChannelsDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </SettingsCard>
      {settings.providers.some((provider) =>
        provider.models.some((model) => model.kind === "chat")
      ) && (
        <ModelDefaultSelections
          key={`${settings.default_model}:${settings.title_model}:${settings.memory_extraction_model}`}
          settings={settings}
          disabled={disabled}
          onSave={(draft) => execute({ kind: "save", draft })}
        />
      )}
      {editor?.kind === "channel" && (
        <ChannelEditor
          channel={editor.channel}
          settings={settings}
          pending={pending}
          error={error}
          onClose={closeEditor}
          onSave={(draft) =>
            execute({
              kind: "save",
              draft,
              onSaved: () => {
                if (!editor.channel)
                  setSelectedId(draft.providers.at(-1)?.id ?? "")
                closeEditor()
              },
            })
          }
        />
      )}
      {editor?.kind === "model" && (
        <ModelEditor
          channel={editor.channel}
          initialModel={editor.model}
          settings={settings}
          pending={pending}
          error={error}
          onClose={closeEditor}
          onSave={(draft) =>
            execute({ kind: "save", draft, onSaved: closeEditor })
          }
        />
      )}
      <ConfirmDialog
        open={deletion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletion(null)
            clearError()
          }
        }}
        destructive
        destructiveNotice={error ?? undefined}
        pending={pending}
        confirmLabel={t("common.delete")}
        title={
          deletion?.kind === "model"
            ? t("admin.modelProvider.deleteModelTitle", {
                name: deletion.model.display_name,
              })
            : t("admin.modelProvider.deleteProviderTitle", {
                name:
                  deletion?.kind === "channel"
                    ? providerName(
                        deletion.channel,
                        settings.providers.findIndex(
                          (provider) => provider.id === deletion.channel.id
                        )
                      )
                    : "",
              })
        }
        description={t(
          deletion?.kind === "model"
            ? "admin.modelProvider.deleteModelDescription"
            : "admin.modelProvider.deleteProviderDescription"
        )}
        onConfirm={() => {
          if (deletion?.kind === "model")
            execute({
              kind: "deleteModel",
              modelId: deletion.model.id,
              onSaved: () => setDeletion(null),
            })
          else if (deletion)
            execute({
              kind: "deleteChannel",
              channelId: deletion.channel.id,
              onSaved: () => setDeletion(null),
            })
        }}
      />
    </section>
  )
}

function ModelDefaultSelections({
  settings,
  disabled,
  onSave,
}: {
  settings: ModelProviderSettings
  disabled: boolean
  onSave: (draft: ReturnType<typeof settingsDraft>) => void
}) {
  const { t } = useTranslation()
  const [defaultModel, setDefaultModel] = useState(settings.default_model)
  const [titleModel, setTitleModel] = useState(settings.title_model)
  const [memoryModel, setMemoryModel] = useState(
    settings.memory_extraction_model ?? null
  )
  const chats = settings.providers
    .flatMap((provider) => provider.models)
    .filter((model) => model.kind === "chat")
  const draft = {
    ...settingsDraft(settings),
    default_model: defaultModel,
    title_model: titleModel,
    memory_extraction_model: memoryModel,
  }
  const dirty =
    defaultModel !== settings.default_model ||
    titleModel !== settings.title_model ||
    memoryModel !== (settings.memory_extraction_model ?? null)
  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      aria-label={t("admin.modelProvider.modelSelections")}
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && isSettingsDraftValid(draft, settings)) onSave(draft)
      }}
    >
      <SettingsCard
        header={
          <SettingsSectionHeader
            id="model-default-selections-title"
            title={t("admin.modelProvider.modelSelections")}
          />
        }
      >
        <div className="flex min-w-0 flex-col gap-4">
          <SettingsFieldGroup>
            <ModelSettingsSelect
              layout="settings"
              label={t("admin.modelProvider.defaultModel")}
              value={defaultModel}
              disabled={disabled || !chats.length}
              options={chats
                .filter((model) => model.enabled)
                .map((model) => ({
                  value: model.id,
                  label: model.display_name,
                }))}
              onChange={setDefaultModel}
            />
            <ModelSettingsSelect
              layout="settings"
              label={t("admin.modelProvider.titleModel")}
              value={titleModel}
              disabled={disabled || !chats.length}
              options={chats.map((model) => ({
                value: model.id,
                label: model.display_name,
              }))}
              onChange={setTitleModel}
            />
            <ModelSettingsSelect
              layout="settings"
              label={t("admin.modelProvider.memoryExtractionModel")}
              value={memoryModel ?? "__task_model__"}
              disabled={disabled}
              options={[
                {
                  value: "__task_model__",
                  label: t("admin.modelProvider.memoryUseTaskModel"),
                },
                ...chats.map((model) => ({
                  value: model.id,
                  label: model.display_name,
                })),
              ]}
              onChange={(value) =>
                setMemoryModel(value === "__task_model__" ? null : value)
              }
            />
          </SettingsFieldGroup>
          <p className="text-xs text-muted-foreground">
            {t("admin.modelProvider.memoryExtractionHint")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("admin.modelProvider.selectionsHint")}
          </p>
          <Button
            type="submit"
            size="default"
            className="self-end"
            disabled={
              disabled || !dirty || !isSettingsDraftValid(draft, settings)
            }
            aria-label={t("admin.modelProvider.saveModelSelections")}
          >
            {t("common.save")}
          </Button>
        </div>
      </SettingsCard>
    </form>
  )
}
